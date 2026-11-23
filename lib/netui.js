/*
 * NetUI：所有游戏共用的“联机大厅”弹窗（依赖 lib/net.js）
 *
 *   NetUI.open({ game:'doudizhu', title:'斗地主', max:3, min:2, fillNote:'空位由电脑补上',
 *                onStart(ctx) { ctx.room, ctx.isHost, ctx.players(按座位顺序 [{cid,name}]), ctx.me, ctx.extra } })
 *   NetUI.autoJoin(opts)   // 网址带 ?room=123456 时直接进房
 * 房主点“开始”后，房间里所有人都会收到 onStart（房主传入的 extra 也会带给大家）。
 */
(function (root) {
  'use strict';
  var css = '\
.nu-mask{position:fixed;inset:0;z-index:50;display:flex;padding:calc(env(safe-area-inset-top,0px) + 14px) 16px calc(env(safe-area-inset-bottom,0px) + 14px);background:rgba(5,10,20,.66);backdrop-filter:blur(4px);overflow:auto;font-family:"PingFang SC","Microsoft YaHei",system-ui,sans-serif;color:#fff}\
.nu-box{margin:auto;width:100%;max-width:420px;background:linear-gradient(180deg,#26324f,#141b2e);border:1px solid rgba(255,255,255,.2);border-radius:22px;padding:20px;box-shadow:0 20px 60px rgba(0,0,0,.5);text-align:center}\
.nu-box h2{margin:0 0 4px;font-size:24px}.nu-sub{color:#b9c6e4;font-size:13px;line-height:1.6;margin:4px 0 12px}\
.nu-row{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin:10px 0}\
.nu-b{border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.1);color:#fff;border-radius:14px;padding:11px 16px;font-size:16px;font-weight:800;min-height:46px;cursor:pointer;font-family:inherit}\
.nu-b.y{background:linear-gradient(180deg,#ffdd4a,#f29a1a);color:#3a2200;border-color:#fff0a8}.nu-b.g{background:linear-gradient(180deg,#5fe08a,#21a457);border-color:#bff5cf}\
.nu-b:disabled{opacity:.45;cursor:default}\
.nu-in{width:100%;border:1px solid rgba(255,255,255,.3);background:rgba(0,0,0,.25);color:#fff;border-radius:12px;padding:10px 12px;font-size:18px;text-align:center;font-family:inherit;letter-spacing:.06em}\
.nu-code{font-size:44px;font-weight:900;letter-spacing:.18em;color:#ffdd4a;margin:4px 0;font-variant-numeric:tabular-nums}\
.nu-seats{display:grid;grid-template-columns:repeat(auto-fit,minmax(90px,1fr));gap:8px;margin:12px 0}\
.nu-seat{background:rgba(255,255,255,.08);border:1px dashed rgba(255,255,255,.3);border-radius:14px;padding:10px 6px;font-size:14px;font-weight:800;min-height:62px}\
.nu-seat.on{border-style:solid;background:rgba(95,224,138,.18);border-color:#5fe08a}\
.nu-seat small{display:block;color:#b9c6e4;font-weight:600;font-size:11px;margin-top:3px}\
.nu-err{color:#ff8a8a;font-size:13px;min-height:18px;margin-top:6px}\
.nu-x{position:absolute;right:14px;top:10px;background:none;border:none;color:#b9c6e4;font-size:24px;cursor:pointer}\
.nu-spin{display:inline-block;width:16px;height:16px;border:3px solid #fff;border-top-color:transparent;border-radius:50%;animation:nuspin .8s linear infinite;vertical-align:-3px;margin-right:6px}@keyframes nuspin{to{transform:rotate(360deg)}}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  var mask = null, opts = null, room = null, matcher = null, started = false;
  function el(h) { var d = document.createElement('div'); d.innerHTML = h; return d.firstElementChild; }
  function show(html) {
    if (!mask) { mask = el('<div class="nu-mask"></div>'); document.body.appendChild(mask); }
    mask.innerHTML = '<div class="nu-box" style="position:relative"><button class="nu-x" aria-label="关闭">×</button>' + html + '</div>';
    mask.querySelector('.nu-x').onclick = close;
    mask.style.display = 'flex';
    return mask.querySelector('.nu-box');
  }
  function hide() { if (mask) mask.style.display = 'none'; }
  function close() { if (matcher) { matcher.cancel(); matcher = null; } if (room && !started) { room.leave(); room = null; } hide(); if (opts && opts.onClose) opts.onClose(); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function home() {
    if (!Net.available()) {
      show('<h2>联机对战</h2><p class="nu-sub">联机服务器还没上线。<br>部署好 Cloudflare 联机服务器后，就能和朋友开房间、快速匹配了。</p><div class="nu-row"><button class="nu-b" id="nuBack">知道了</button></div>');
      mask.querySelector('#nuBack').onclick = close; return;
    }
    var b = show('<h2>' + esc(opts.title || '联机对战') + '</h2><p class="nu-sub">' + (opts.max > 2 ? opts.max + ' 人一桌' : '两人对战') + (opts.fillNote ? '，' + esc(opts.fillNote) : '') + '</p>\
<input class="nu-in" id="nuName" maxlength="12" placeholder="你的昵称">\
<div class="nu-row"><button class="nu-b y" id="nuMatch">⚡ 快速匹配</button><button class="nu-b g" id="nuCreate">🏠 创建房间</button></div>\
<div class="nu-row" style="flex-wrap:nowrap"><input class="nu-in" id="nuCode" inputmode="numeric" maxlength="6" placeholder="输入 6 位房间号"><button class="nu-b" id="nuJoin" style="flex:0 0 auto">加入</button></div><div class="nu-err" id="nuErr"></div>');
    var nm = b.querySelector('#nuName'); nm.value = Net.getName();
    var save = function () { Net.setName(nm.value.trim() || Net.getName()); };
    b.querySelector('#nuMatch').onclick = function () { save(); quick(); };
    b.querySelector('#nuCreate').onclick = function () { save(); enter(Net.newCode()); };
    b.querySelector('#nuJoin').onclick = function () { save(); var c = b.querySelector('#nuCode').value.trim(); if (!/^\d{6}$/.test(c)) { b.querySelector('#nuErr').textContent = '房间号是 6 位数字'; return; } enter(c); };
  }
  function quick() {
    var t0 = Date.now(), b = show('<h2>快速匹配</h2><p class="nu-sub" id="nuWait"><span class="nu-spin"></span>正在寻找对手…</p><p class="nu-sub" id="nuT">0 秒</p><div class="nu-row"><button class="nu-b" id="nuCancel">取消</button>' + (opts.solo ? '<button class="nu-b g" id="nuSolo">不等了，和电脑玩</button>' : '') + '</div>');
    var timer = setInterval(function () { var e = b.querySelector('#nuT'); if (e) e.textContent = Math.floor((Date.now() - t0) / 1000) + ' 秒'; else clearInterval(timer); }, 500);
    matcher = Net.match(opts.game, { max: opts.max, min: opts.min || opts.max });
    matcher.on('waiting', function (n, max) { var e = b.querySelector('#nuWait'); if (e) e.innerHTML = '<span class="nu-spin"></span>已找到 ' + n + ' / ' + max + ' 人…' + (opts.min && opts.min < max && n >= opts.min ? '<br>人不满也会很快开局，空位由电脑补上' : ''); });
    matcher.on('matched', function (code) { clearInterval(timer); matcher = null; enter(code, true); });
    matcher.on('error', function (m) { clearInterval(timer); var e = b.querySelector('#nuWait'); if (e) e.textContent = m; });
    b.querySelector('#nuCancel').onclick = function () { clearInterval(timer); if (matcher) matcher.cancel(); matcher = null; home(); };
    if (opts.solo) b.querySelector('#nuSolo').onclick = function () { clearInterval(timer); if (matcher) matcher.cancel(); matcher = null; hide(); opts.solo(); };
  }
  function enter(code, auto) {
    started = false;
    if (room) room.leave();
    room = Net.room(code, { game: opts.game, max: opts.max });
    var b = show('<h2>房间</h2><div class="nu-code">' + code + '</div><p class="nu-sub">把房间号或链接发给朋友，一起来玩</p>\
<div class="nu-row"><button class="nu-b" id="nuCopy">📋 复制邀请链接</button></div><div class="nu-seats" id="nuSeats"></div><div class="nu-err" id="nuErr"></div>\
<div class="nu-row"><button class="nu-b" id="nuLeave">离开</button><button class="nu-b y" id="nuStart" disabled>开始游戏</button></div><p class="nu-sub" id="nuHint"><span class="nu-spin"></span>连接中…</p>');
    b.querySelector('#nuCopy').onclick = function () { var link = Net.shareLink(code), btn = b.querySelector('#nuCopy'); var ok = function () { btn.textContent = '✅ 已复制'; }; if (navigator.clipboard) navigator.clipboard.writeText('来玩' + (opts.title || '') + '！房间号 ' + code + '：' + link).then(ok, function () { prompt('复制这个链接发给朋友', link); }); else prompt('复制这个链接发给朋友', link); };
    b.querySelector('#nuLeave').onclick = function () { room.leave(); room = null; home(); };
    b.querySelector('#nuStart').onclick = function () {
      var info = room.info; if (!info || !info.isHost) return;
      var extra = opts.hostExtra ? opts.hostExtra() : null;
      room.send({ k: '__start', players: info.players, extra: extra });
      room.lock(true); begin(info.players, extra);
    };
    room.on('room', function (info) {
      if (started) return;
      var seats = b.querySelector('#nuSeats'); if (!seats) return;
      var h = '';
      for (var i = 0; i < opts.max; i++) { var p = info.players[i]; h += '<div class="nu-seat' + (p ? ' on' : '') + '">' + (p ? esc(p.name) + (p.cid === info.host ? ' 👑' : '') + (p.cid === info.me ? '<small>（你）</small>' : '') : '等待加入…' + (opts.min && i >= opts.min ? '<small>可由电脑补位</small>' : '')) + '</div>'; }
      seats.innerHTML = h;
      var can = info.isHost && info.players.length >= (opts.min || opts.max);
      var sb = b.querySelector('#nuStart'); sb.disabled = !can; sb.style.display = info.isHost ? '' : 'none';
      b.querySelector('#nuHint').innerHTML = info.isHost ? (can ? (info.players.length < opts.max ? '人不满也能开，空位电脑补' : '人齐了，点「开始游戏」') : '还差 ' + ((opts.min || opts.max) - info.players.length) + ' 人才能开始') : '<span class="nu-spin"></span>等待房主开始';
      if (auto && info.isHost && info.players.length >= (opts.min || opts.max)) { auto = false; setTimeout(function () { if (!started && room && room.info && room.info.isHost) b.querySelector('#nuStart').click(); }, info.players.length >= opts.max ? 600 : 1500); }
    });
    room.on('msg', function (d) {
      if (!d || d.k !== '__start' || started) return;
      if (!(d.players || []).some(function (p) { return p.cid === Net.cid; })) {   // 刚进来时这局已经开了
        var r = room; room = null; try { r.leave(); } catch (e) {}
        var e = b.querySelector('#nuErr'); if (e) e.textContent = '这局已经开始了，换个房间吧'; var h = b.querySelector('#nuHint'); if (h) h.textContent = ''; return;
      }
      begin(d.players, d.extra);
    });
    room.on('error', function (m) { var e = b.querySelector('#nuErr'); if (e) e.textContent = m; var h = b.querySelector('#nuHint'); if (h) h.textContent = ''; });
    room.on('reconnecting', function () { var h = b.querySelector('#nuHint'); if (h && !started) h.innerHTML = '<span class="nu-spin"></span>网络不稳，重连中…'; });
  }
  function begin(players, extra) {
    started = true; hide();
    var info = room.info || {};
    opts.onStart({ room: room, isHost: info.host === Net.cid, players: players, me: Net.cid, extra: extra });
  }
  root.NetUI = {
    open: function (o) { opts = o; started = false; home(); },
    join: function (o, code) { opts = o; enter(code); },
    autoJoin: function (o) { var c = Net.roomFromUrl(); if (c) { if (!Net.available()) return false; opts = o; enter(c); return true; } return false; },
    close: close,
    leave: function () { if (room) room.leave(); room = null; started = false; },
  };
})(window);
