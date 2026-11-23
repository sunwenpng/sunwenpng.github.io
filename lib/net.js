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
 *
 * 两种服务器：
 *   'wss://…'                自己部署的 Cloudflare Worker（server/worker.js）
 *   'mqtt:wss://…/mqtt'      公共 MQTT 消息中转（不用注册账号）。房间、房主、满员、开局锁定、快速匹配
 *                            都由客户端按同一套规则自己算出来，效果和 Worker 一样。
 */
(function (root) {
  'use strict';
  var qs = new URLSearchParams(location.search);
  var override = qs.get('server');
  if (override) { try { sessionStorage.setItem('net-server', override); } catch (e) {} }
  var SERVER = (override || (function () { try { return sessionStorage.getItem('net-server'); } catch (e) { return null; } })() || root.NET_SERVER || '').replace(/\/$/, '');
  var MQTT = /^mqtt:/.test(SERVER);
  if (MQTT) SERVER = SERVER.replace(/^mqtt:/, '');
  if (SERVER && !/^wss?:\/\//.test(SERVER)) SERVER = SERVER.replace(/^http/, 'ws');
  var LIBDIR = (function () { try { return document.currentScript.src.replace(/[^\/]*$/, ''); } catch (e) { return '../lib/'; } })();
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

  function wsRoom(code, opt) {
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

  function wsMatch(game, opt) {
    opt = opt || {};
    var ev = emitter(), ws = new WebSocket(url('/match', { game: game, max: opt.max || 2, min: opt.min || opt.max || 2 })), done = false;
    var ping = setInterval(function () { try { ws.send('{"t":"ping"}'); } catch (e) {} }, 20000);
    ws.onmessage = function (e) { var m; try { m = JSON.parse(e.data); } catch (err) { return; } if (m.t === 'waiting') ev.emit('waiting', m.n, m.max); if (m.t === 'matched') { done = true; ev.emit('matched', m.code, m.players); } };
    ws.onclose = function () { clearInterval(ping); if (!done) ev.emit('error', '匹配连接断开了'); };
    ws.onerror = function () {};
    return { on: function (e, f) { ev.on(e, f); return this; }, cancel: function () { done = true; clearInterval(ping); try { ws.close(); } catch (e) {} } };
  }

  /* ================= MQTT 中转 ================= */
  var NS = 'dango-games-7f3k/v1/', mqttWait = null;
  function loadMqtt(cb) {
    if (root.mqtt) return cb();
    if (!mqttWait) {
      mqttWait = [];
      var sc = document.createElement('script'); sc.src = LIBDIR + 'mqtt.min.js';
      sc.onload = function () { var w = mqttWait; mqttWait = null; w.forEach(function (f) { f(); }); };
      sc.onerror = function () { var w = mqttWait; mqttWait = null; w.forEach(function (f) { f('load'); }); };
      document.head.appendChild(sc);
    }
    mqttWait.push(cb);
  }
  function connect(will) {
    return root.mqtt.connect(SERVER, { clientId: 'dg_' + cid + '_' + Math.random().toString(36).slice(2, 7), keepalive: 20, clean: true, reconnectPeriod: 2000, connectTimeout: 10000, will: will, protocolVersion: 4 });
  }
  function J(buf) { var t = buf && buf.toString(); if (!t) return null; try { return JSON.parse(t); } catch (e) { return null; } }
  var LOCK_TTL = 6 * 3600 * 1000;

  function mqttRoom(code, opt) {
    opt = opt || {};
    var ev = emitter(), cli = null, closed = false, joined = false, info = null, queue = [], fails = 0;
    var base = NS + (opt.game || 'x') + '/r/' + code + '/', max = opt.max || 2;
    var pres = {}, lockM = null, myT = Date.now(), emitT = null;
    function players() {
      return Object.keys(pres).map(function (k) { return { cid: k, name: pres[k].name, t: pres[k].t }; })
        .sort(function (a, b) { return a.t - b.t || (a.cid < b.cid ? -1 : 1); });
    }
    function update() {
      if (!joined) return;
      clearTimeout(emitT);
      emitT = setTimeout(function () {
        var pl = players().map(function (p) { return { cid: p.cid, name: p.name }; });
        if (!pl.length) return;
        info = { t: 'room', code: code, game: opt.game, max: max, locked: !!lockM, host: pl[0].cid, players: pl, me: cid, isHost: pl[0].cid === cid };
        ev.emit('room', info);
      }, 60);
    }
    function fail(msg) { closed = true; ev.emit('error', msg); try { cli.end(true); } catch (e) {} ev.emit('close'); }
    function announce() { cli.publish(base + 'p/' + cid, JSON.stringify({ name: getName(), t: myT }), { retain: true, qos: 1 }); }
    function admit() {
      if (closed) return;
      var others = players().filter(function (p) { return p.cid !== cid; });
      if (lockM && lockM.indexOf(cid) < 0) return fail('这局已经开始了，换个房间吧');
      if (others.length >= max) return fail('房间已满');
      joined = true; pres[cid] = { name: getName(), t: myT }; announce();
      while (queue.length) queue.shift()();
      update();
    }
    loadMqtt(function (err) {
      if (closed) return;
      if (err) return fail('联机组件加载失败，请检查网络');
      cli = connect({ topic: base + 'p/' + cid, payload: '', retain: true, qos: 1 });
      cli.on('connect', function () {
        fails = 0; ev.emit('open');
        cli.subscribe([base + 'p/+', base + 'm', base + 'lock'], { qos: 1 }, function () {
          if (!joined) setTimeout(admit, 900);           // 等保留消息（现有玩家 / 是否已开局）到齐再进
          else { myT = Date.now(); pres[cid] = { name: getName(), t: myT }; announce(); update(); }
        });
      });
      cli.on('message', function (topic, buf) {
        var rest = topic.slice(base.length);
        if (rest.indexOf('p/') === 0) {
          var who = rest.slice(2), v = J(buf);
          if (v) pres[who] = { name: String(v.name || '玩家').slice(0, 12), t: +v.t || 0 }; else if (who !== cid || !joined) delete pres[who];
          if (who === cid && !v && joined && !closed) announce();   // 自己被误清掉（旧连接的遗嘱）→ 再报一次到
          update();
        } else if (rest === 'lock') {
          var l = J(buf); lockM = l && l.m && (Date.now() - (l.at || 0) < LOCK_TTL) ? l.m : null; update();
        } else if (rest === 'm' && joined) {
          var m = J(buf); if (!m || m.f === cid || (m.to && m.to !== cid)) return;
          ev.emit('msg', m.d, m.f);
        }
      });
      cli.on('offline', function () { if (!closed) { fails++; ev.emit('reconnecting', fails); } });
      cli.on('error', function () {});
    });
    function later(f) { if (joined && cli && cli.connected) f(); else queue.push(f); }
    return {
      code: code, on: function (e, f) { ev.on(e, f); return this; },
      send: function (data, to) { later(function () { cli.publish(base + 'm', JSON.stringify(to ? { f: cid, to: to, d: data } : { f: cid, d: data }), { qos: 1 }); }); },
      lock: function (v) { later(function () { cli.publish(base + 'lock', v ? JSON.stringify({ m: players().map(function (p) { return p.cid; }), at: Date.now() }) : '', { retain: true, qos: 1 }); }); },
      leave: function () {
        if (closed) return; closed = true;
        if (!cli) return;
        try {
          var alone = players().filter(function (p) { return p.cid !== cid; }).length === 0;
          if (alone && lockM) cli.publish(base + 'lock', '', { retain: true, qos: 1 });
          cli.publish(base + 'p/' + cid, '', { retain: true, qos: 1 }, function () { cli.end(); });
          setTimeout(function () { try { cli.end(true); } catch (e) {} }, 1500);
        } catch (e) {}
      },
      get info() { return info; }, get me() { return cid; },
    };
  }

  function mqttMatch(game, opt) {
    opt = opt || {};
    var ev = emitter(), cli = null, done = false, max = opt.max || 2, min = opt.min || max;
    var base = NS + game + '/q' + max + '/', pres = {}, myT = Date.now(), lastChange = Date.now(), tick = null;
    function list() {
      return Object.keys(pres).map(function (k) { return { cid: k, name: pres[k].name, t: pres[k].t }; })
        .sort(function (a, b) { return a.t - b.t || (a.cid < b.cid ? -1 : 1); });
    }
    function finish(code, pl) {
      if (done) return; done = true; clearInterval(tick);
      try { cli.publish(base + 'p/' + cid, '', { retain: true, qos: 1 }, function () { cli.end(); }); } catch (e) {}
      ev.emit('matched', code, pl);
    }
    loadMqtt(function (err) {
      if (done) return;
      if (err) { ev.emit('error', '联机组件加载失败，请检查网络'); return; }
      cli = connect({ topic: base + 'p/' + cid, payload: '', retain: true, qos: 1 });
      cli.on('connect', function () {
        cli.subscribe([base + 'p/+', base + 'go'], { qos: 1 }, function () {
          pres[cid] = { name: getName(), t: myT };
          cli.publish(base + 'p/' + cid, JSON.stringify({ name: getName(), t: myT }), { retain: true, qos: 1 });
        });
      });
      cli.on('message', function (topic, buf) {
        var rest = topic.slice(base.length), v = J(buf);
        if (rest.indexOf('p/') === 0) {
          var who = rest.slice(2);
          if (v && Date.now() - (+v.t || 0) < 10 * 60 * 1000) pres[who] = { name: String(v.name || '玩家').slice(0, 12), t: +v.t || 0 }; else delete pres[who];
          lastChange = Date.now();
        } else if (rest === 'go' && v && v.players) {
          var ids = v.players.map(function (p) { return p.cid; });
          ids.forEach(function (k) { delete pres[k]; });
          if (ids.indexOf(cid) >= 0) finish(v.code, v.players);
        }
      });
      cli.on('error', function () {});
      tick = setInterval(function () {
        if (done || !cli.connected) return;
        var l = list(); if (!pres[cid]) return;
        ev.emit('waiting', l.length, max);
        if (l[0].cid !== cid) return;                     // 等得最久的人负责凑桌
        var now = Date.now(), pick = null;
        if (l.length >= max) pick = l.slice(0, max);
        else if (l.length >= min && now - myT > 8000 && now - lastChange > 2500) pick = l;
        if (pick) cli.publish(base + 'go', JSON.stringify({ code: String(100000 + Math.floor(Math.random() * 900000)), players: pick.map(function (p) { return { cid: p.cid, name: p.name }; }) }), { qos: 1 });
      }, 1000);
    });
    return { on: function (e, f) { ev.on(e, f); return this; }, cancel: function () { if (done) return; done = true; clearInterval(tick); if (cli) try { cli.publish(base + 'p/' + cid, '', { retain: true, qos: 1 }, function () { cli.end(); }); setTimeout(function () { try { cli.end(true); } catch (e) {} }, 1500); } catch (e) {} } };
  }
  function room(code, opt) { return MQTT ? mqttRoom(code, opt) : wsRoom(code, opt); }
  function match(game, opt) { return MQTT ? mqttMatch(game, opt) : wsMatch(game, opt); }

  root.Net = {
    available: function () { return !!SERVER; }, get server() { return SERVER; }, cid: cid,
    getName: getName, setName: setName, room: room, match: match,
    newCode: function () { return String(100000 + Math.floor(Math.random() * 900000)); },
    get relay() { return MQTT; },
    shareLink: function (code) { var u = new URL(location.href); u.search = ''; u.hash = ''; u.searchParams.set('room', code); if (override) u.searchParams.set('server', override); return u.toString(); },
    roomFromUrl: function () { var c = qs.get('room'); return /^\d{6}$/.test(c || '') ? c : null; },
  };
})(window);
