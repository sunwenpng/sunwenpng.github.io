/*
 * 团子游戏 · 联机服务器
 *
 * 只负责“房间”和“匹配”，不跑游戏逻辑：
 *   - 房间（Room）：同一个 6 位房间号的玩家连到同一个 Durable Object，服务器把消息转发给房间里其他人。
 *     最早进房的人是房主；房主离开时自动换人。游戏开始后（lock）不再接受新玩家，只允许原玩家断线重连。
 *   - 匹配（Lobby）：每个游戏一个匹配队列，人够了就分配一个新房间号。斗地主等允许“人不满也开”的游戏，
 *     等待超过 8 秒且人数达到 min 时也会开局（空位由房主那边的电脑补上）。
 *
 * 连接方式（WebSocket）：
 *   wss://<域名>/room/123456?game=doudizhu&max=3&name=昵称&cid=客户端ID
 *   wss://<域名>/match?game=doudizhu&max=3&min=2&name=昵称&cid=客户端ID
 * 客户端 → 服务器：{t:'msg', data, to?, self?}  {t:'lock', v:true|false}  {t:'ping'}
 * 服务器 → 客户端：{t:'room', code, game, max, locked, host, players:[{cid,name}]}  {t:'msg', from, data}
 *                  {t:'waiting', n}  {t:'matched', code}  {t:'error', msg}  {t:'pong'}
 */

const json = (o) => JSON.stringify(o);
const clean = (s, n) => String(s || '').replace(/[\u0000-\u001f<>]/g, '').slice(0, n);

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const cors = { 'access-control-allow-origin': '*' };
    if (url.pathname === '/health') return new Response('ok', { headers: cors });
    if (req.headers.get('Upgrade') !== 'websocket') {
      return new Response('团子游戏联机服务器运行中', { headers: { ...cors, 'content-type': 'text/plain; charset=utf-8' } });
    }
    let m = url.pathname.match(/^\/room\/(\d{6})$/);
    if (m) return env.ROOM.get(env.ROOM.idFromName(m[1])).fetch(req);
    if (url.pathname === '/match') {
      const game = clean(url.searchParams.get('game'), 20) || 'game';
      const max = clean(url.searchParams.get('max'), 2) || '2';
      return env.LOBBY.get(env.LOBBY.idFromName('lobby:' + game + ':' + max)).fetch(req);
    }
    return new Response('not found', { status: 404, headers: cors });
  },
};

function accept(state, attach) {
  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);
  state.acceptWebSocket(server);
  server.serializeAttachment(attach);
  return { client, server };
}

export class Room {
  constructor(state, env) { this.state = state; this.env = env; }

  players() {
    const out = [];
    for (const w of this.state.getWebSockets()) {
      let a = null; try { a = w.deserializeAttachment(); } catch (e) {}
      if (a && a.cid) out.push({ w, a });
    }
    return out.sort((x, y) => x.a.at - y.a.at);
  }

  async meta() { return (await this.state.storage.get('meta')) || null; }

  async broadcastRoom() {
    const meta = await this.meta(); if (!meta) return;
    const ps = this.players();
    if (!ps.length && meta.locked) { meta.locked = false; await this.state.storage.put('meta', meta); }
    const msg = json({ t: 'room', code: meta.code, game: meta.game, max: meta.max, locked: meta.locked, host: ps[0] ? ps[0].a.cid : null, players: ps.map((p) => ({ cid: p.a.cid, name: p.a.name })) });
    for (const p of ps) { try { p.w.send(msg); } catch (e) {} }
  }

  async fetch(req) {
    const url = new URL(req.url);
    const code = url.pathname.split('/').pop();
    const cid = clean(url.searchParams.get('cid'), 40) || crypto.randomUUID();
    const name = clean(url.searchParams.get('name'), 16) || '玩家';
    const game = clean(url.searchParams.get('game'), 20);
    const max = Math.min(8, Math.max(2, parseInt(url.searchParams.get('max'), 10) || 2));
    let meta = await this.meta();
    if (!meta || (!this.players().length && !meta.locked)) { meta = { code, game, max, locked: false }; await this.state.storage.put('meta', meta); }
    const ps = this.players();
    const old = ps.filter((p) => p.a.cid === cid);
    const { client, server } = accept(this.state, null);
    const reject = (msg) => { server.send(json({ t: 'error', msg })); server.close(4000, 'rejected'); return new Response(null, { status: 101, webSocket: client }); };
    if (meta.game && game && meta.game !== game) return reject('这个房间号是别的游戏的');
    if (!old.length) {
      if (meta.locked && !(meta.members || []).includes(cid)) return reject('这局已经开始了，换个房间吧');
      if (ps.length >= meta.max) return reject('房间已满');
    }
    for (const o of old) { try { o.w.serializeAttachment(null); o.w.close(4001, 'replaced'); } catch (e) {} }
    server.serializeAttachment({ cid, name, at: old.length ? old[0].a.at : Date.now() });
    await this.broadcastRoom();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== 'string' || raw.length > 32000) return;
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    let me = null; try { me = ws.deserializeAttachment(); } catch (e) {}
    if (!me) return;
    if (m.t === 'ping') { ws.send('{"t":"pong"}'); return; }
    if (m.t === 'lock') {
      const meta = await this.meta(); if (!meta) return;
      meta.locked = !!m.v; meta.members = meta.locked ? this.players().map((p) => p.a.cid) : []; await this.state.storage.put('meta', meta);
      await this.broadcastRoom(); return;
    }
    if (m.t === 'msg') {
      const out = json({ t: 'msg', from: me.cid, data: m.data });
      for (const p of this.players()) {
        if (m.to && p.a.cid !== m.to) continue;
        if (!m.to && p.w === ws && !m.self) continue;
        try { p.w.send(out); } catch (e) {}
      }
    }
  }

  async webSocketClose(ws) { try { ws.serializeAttachment(null); } catch (e) {} await this.broadcastRoom(); }
  async webSocketError(ws) { try { ws.serializeAttachment(null); } catch (e) {} await this.broadcastRoom(); }
}

export class Lobby {
  constructor(state, env) { this.state = state; this.env = env; }

  waiting() {
    const seen = new Map();
    for (const w of this.state.getWebSockets()) {
      let a = null; try { a = w.deserializeAttachment(); } catch (e) {}
      if (!a || a.done) continue;
      const prev = seen.get(a.cid);
      if (prev) { try { prev.w.serializeAttachment(null); prev.w.close(4001, 'replaced'); } catch (e) {} }
      seen.set(a.cid, { w, a });
    }
    return [...seen.values()].sort((x, y) => x.a.at - y.a.at);
  }

  async fetch(req) {
    const url = new URL(req.url);
    const cid = clean(url.searchParams.get('cid'), 40) || crypto.randomUUID();
    const name = clean(url.searchParams.get('name'), 16) || '玩家';
    const max = Math.min(8, Math.max(2, parseInt(url.searchParams.get('max'), 10) || 2));
    const min = Math.min(max, Math.max(2, parseInt(url.searchParams.get('min'), 10) || max));
    const { client } = accept(this.state, { cid, name, max, min, at: Date.now() });
    await this.tryMatch();
    return new Response(null, { status: 101, webSocket: client });
  }

  match(group) {
    const code = String(100000 + Math.floor(Math.random() * 900000));
    const names = group.map((g) => g.a.name);
    for (const g of group) {
      g.a.done = true;
      try { g.w.serializeAttachment(g.a); g.w.send(json({ t: 'matched', code, players: names })); g.w.close(1000, 'matched'); } catch (e) {}
    }
  }

  async tryMatch() {
    let ws = this.waiting();
    while (ws.length && ws.length >= ws[0].a.max) { this.match(ws.slice(0, ws[0].a.max)); ws = this.waiting(); }
    if (ws.length && ws.length >= ws[0].a.min && ws[0].a.min < ws[0].a.max && Date.now() - ws[0].a.at > 8000) { this.match(ws); ws = this.waiting(); }
    for (const g of ws) { try { g.w.send(json({ t: 'waiting', n: ws.length, max: g.a.max })); } catch (e) {} }
    if (ws.length) await this.state.storage.setAlarm(Date.now() + 2000);
  }

  async alarm() { await this.tryMatch(); }
  async webSocketMessage(ws, raw) { if (raw === '{"t":"ping"}') { try { ws.send('{"t":"pong"}'); } catch (e) {} } }
  async webSocketClose(ws) { try { ws.serializeAttachment(null); } catch (e) {} }
  async webSocketError(ws) { try { ws.serializeAttachment(null); } catch (e) {} }
}
