/*
 * Net：联机客户端（配合 server/worker.js）
 *
 * 服务器地址写在 lib/net-config.js 里（window.NET_SERVER = 'wss://xxx'）。
 * 测试时可以在网址后加 ?server=ws://localhost:8787 临时指定。
 *
 *   const r = Net.room('123456', {game:'doudizhu', max:3});
 *   r.on('room', info => ...)       // 玩家列表 / 房主变化
 *   r.on('msg',  (data, from) => ...)
 *   r.on('error', msg => ...)  r.on('close', () => ...)
 *   r.send(data[, toCid])  r.lock(true)  r.leave()
 *   const m = Net.match('doudizhu', {max:3, min:2}); m.on('waiting', n=>...); m.on('matched', code=>...); m.cancel()
 */
(function (root) {
  'use strict';
  var qs = new URLSearchParams(location.search);
  var override = qs.get('server');
  if (override) { try { sessionStorage.setItem('net-server', override); } catch (e) {} }
  var SERVER = (override || (function () { try { return sessionStorage.getItem('net-server'); } catch (e) { return null; } })() || root.NET_SERVER || '').replace(/\/$/, '');
  if (SERVER && !/^wss?:\/\//.test(SERVER)) SERVER = SERVER.replace(/^http/, 'ws');
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }
  var cid = store('net-cid');
  if (!cid) { cid = (Date.now().toString(36) + Math.random().toString(36).slice(2, 10)); store('net-cid', cid); }
  // 同一台设备多开标签页时用不同身份（方便自己测试）
  try { var tab = sessionStorage.getItem('net-tab'); if (!tab) { tab = Math.random().toString(36).slice(2, 6); sessionStorage.setItem('net-tab', tab); } cid = cid + '-' + tab; } catch (e) {}
  var ANIMALS = ['小熊', '小狐', '小兔', '团子', '企鹅', '小龙', '橘猫', '青蛙', '熊猫', '海豚'];
  function getName() { return store('net-name') || (ANIMALS[Math.floor(Math.random() * ANIMALS.length)] + Math.floor(10 + Math.random() * 89)); }
  function setName(n) { store('net-name', String(n || '').slice(0, 12)); }

  function emitter() {
    var h = {};
    return { on: function (e, f) { (h[e] = h[e] || []).push(f); return this; }, emit: function (e, a, b) { (h[e] || []).forEach(function (f) { try { f(a, b); } catch (err) { console.error(err); } }); } };
  }
  function url(path, p) {
    var q = new URLSearchParams(Object.assign({ cid: cid, name: getName() }, p));
    return SERVER + path + '?' + q.toString();
  }

  function room(code, opt) {
    opt = opt || {};
    var ev = emitter(), ws = null, closed = false, tries = 0, ping = null, queue = [], info = null;
    function open() {
      ws = new WebSocket(url('/room/' + code, { game: opt.game || '', max: opt.max || 2 }));
      ws.onopen = function () { tries = 0; ev.emit('open'); while (queue.length) ws.send(queue.shift()); clearInterval(ping); ping = setInterval(function () { try { ws.send('{"t":"ping"}'); } catch (e) {} }, 25000); };
      ws.onmessage = function (e) {
        var m; try { m = JSON.parse(e.data); } catch (err) { return; }
        if (m.t === 'room') { info = m; info.me = cid; info.isHost = m.host === cid; ev.emit('room', info); }
        else if (m.t === 'msg') ev.emit('msg', m.data, m.from);
        else if (m.t === 'error') { closed = true; ev.emit('error', m.msg); }
      };
      ws.onclose = function () {
        clearInterval(ping);
        if (closed) { ev.emit('close'); return; }
        if (tries++ < 8) { ev.emit('reconnecting', tries); setTimeout(open, Math.min(6000, 800 * tries)); }
        else { closed = true; ev.emit('error', '连接断开了'); ev.emit('close'); }
      };
      ws.onerror = function () {};
    }
    function raw(o) { var s = JSON.stringify(o); if (ws && ws.readyState === 1) ws.send(s); else queue.push(s); }
    open();
    return {
      code: code, on: function (e, f) { ev.on(e, f); return this; },
      send: function (data, to) { raw(to ? { t: 'msg', data: data, to: to } : { t: 'msg', data: data }); },
      lock: function (v) { raw({ t: 'lock', v: !!v }); },
      leave: function () { closed = true; clearInterval(ping); try { ws.close(); } catch (e) {} },
      get info() { return info; }, get me() { return cid; },
    };
  }

  function match(game, opt) {
    opt = opt || {};
    var ev = emitter(), ws = new WebSocket(url('/match', { game: game, max: opt.max || 2, min: opt.min || opt.max || 2 })), done = false;
    var ping = setInterval(function () { try { ws.send('{"t":"ping"}'); } catch (e) {} }, 20000);
    ws.onmessage = function (e) { var m; try { m = JSON.parse(e.data); } catch (err) { return; } if (m.t === 'waiting') ev.emit('waiting', m.n, m.max); if (m.t === 'matched') { done = true; ev.emit('matched', m.code, m.players); } };
    ws.onclose = function () { clearInterval(ping); if (!done) ev.emit('error', '匹配连接断开了'); };
    ws.onerror = function () {};
    return { on: function (e, f) { ev.on(e, f); return this; }, cancel: function () { done = true; clearInterval(ping); try { ws.close(); } catch (e) {} } };
  }

  root.Net = {
    available: function () { return !!SERVER; }, get server() { return SERVER; }, cid: cid,
    getName: getName, setName: setName, room: room, match: match,
    newCode: function () { return String(100000 + Math.floor(Math.random() * 900000)); },
    shareLink: function (code) { var u = new URL(location.href); u.search = ''; u.hash = ''; u.searchParams.set('room', code); if (override) u.searchParams.set('server', override); return u.toString(); },
    roomFromUrl: function () { var c = qs.get('room'); return /^\d{6}$/.test(c || '') ? c : null; },
  };
})(window);
