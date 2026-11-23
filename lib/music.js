/*
 * GameMusic：游戏背景音乐播放器（所有游戏共用）
 *
 * 为什么用 <audio> 而不是 Web Audio：iPhone 打开静音开关时，Web Audio 会被静音，
 * 而 <audio> 媒体播放不受影响。播放 <audio> 之后，同一页面的 Web Audio 音效通常也能听到。
 * iOS 17+ 还会把 navigator.audioSession 设为 playback，进一步保证静音模式下有声音。
 *
 * 用法：
 *   GameMusic.play('music/menu.m4a')          循环播放（同一首重复调用不会重头开始）
 *   GameMusic.play('music/a.m4a',{fade:0.6})  淡入切换
 *   GameMusic.jingle('music/win.m4a')          播一次短音乐（不打断/或配合 stop 使用）
 *   GameMusic.stop() / pause() / resume() / setEnabled(bool) / setVolume(0..1)
 *
 * 我的歌单：GameMusic.openPlaylist() 打开面板，玩家可以从手机里选歌（mp3/m4a/…），
 * 歌曲存在本机浏览器（IndexedDB，所有游戏共用，不会上传）。开启后所有游戏都放玩家自己的歌，
 * 换游戏时接着上一首继续放。
 */
(function (root) {
  'use strict';
  var cache = {}, cur = null, curSrc = '', enabled = true, vol = 0.6, unlocked = false, fadeTimer = null, keeper = null;
  var SILENT = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAAAA';
  var isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  function get(src) {
    var a = cache[src];
    if (!a) { a = new Audio(); a.preload = 'auto'; a.src = src; a.setAttribute('playsinline', ''); cache[src] = a; }
    return a;
  }
  function safePlay(a) { try { var p = a.play(); if (p && p.catch) p.catch(function () {}); } catch (e) {} }
  function unlock() {
    if (unlocked) return; unlocked = true;
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
    if (isIOS && !keeper) { keeper = new Audio(SILENT); keeper.loop = true; keeper.volume = 0; keeper.setAttribute('playsinline', ''); safePlay(keeper); }
    if (cur && enabled && cur.paused) safePlay(cur);
  }
  ['pointerdown', 'touchend', 'keydown', 'click'].forEach(function (ev) { addEventListener(ev, unlock, { capture: true, passive: true }); });

  function setVol(a, v) { try { a.volume = Math.max(0, Math.min(1, v)); } catch (e) {} }
  function playGame(src, opt) {
    opt = opt || {};
    if (curSrc === src && cur) { if (opt.restart) { try { var at2 = opt.at || 0; if (at2 && isFinite(cur.duration) && cur.duration > 0) at2 = at2 % cur.duration; cur.currentTime = at2; } catch (e) {} } if (enabled && cur.paused) safePlay(cur); return; }
    var old = cur, a = get(src);
    curSrc = src; cur = a;
    a.loop = opt.loop !== false;
    try { var at = opt.at || 0; if (at && isFinite(a.duration) && a.duration > 0) at = at % a.duration; a.currentTime = at; } catch (e) {}
    clearInterval(fadeTimer);
    var fade = opt.fade || 0;
    if (old && old !== a) {
      if (fade > 0) {
        var t = 0, ov = old.volume;
        setVol(a, 0);
        fadeTimer = setInterval(function () {
          t += 0.05; var k = Math.min(1, t / fade);
          setVol(old, ov * (1 - k)); setVol(a, vol * k);
          if (k >= 1) { clearInterval(fadeTimer); old.pause(); setVol(old, vol); }
        }, 50);
      } else { old.pause(); setVol(a, vol); }
    } else setVol(a, vol);
    if (enabled) safePlay(a);
  }
  function jingle(src, v) {
    if (!enabled) return;
    var a = new Audio(src); a.setAttribute('playsinline', ''); setVol(a, v === undefined ? Math.min(1, vol + 0.2) : v); safePlay(a);
  }
  function stop() { if (mineActive() && cur === mineEl) return; clearInterval(fadeTimer); if (cur) cur.pause(); cur = null; curSrc = ''; }

  /* ================= 我的歌单 ================= */
  var songs = [], urls = {}, mineOn = false, mineIdx = 0, mineEl = null, gameSrc = '', gameOpt = null, loaded = false, panel = null;
  try { mineOn = localStorage.getItem('gm-mine') === '1'; } catch (e) {}
  function mineActive() { return mineOn && songs.length > 0; }
  function db(fn) {
    return new Promise(function (res, rej) {
      if (!root.indexedDB) return rej('no idb');
      var r = indexedDB.open('game-music', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('songs', { keyPath: 'id' }); };
      r.onsuccess = function () { var d = r.result; try { fn(d, res, rej); } catch (e) { rej(e); } };
      r.onerror = function () { rej(r.error); };
    });
  }
  function loadSongs() {
    return db(function (d, res) { var out = []; var q = d.transaction('songs').objectStore('songs').openCursor();
      q.onsuccess = function () { var c = q.result; if (c) { out.push(c.value); c.continue(); } else res(out); }; q.onerror = function () { res(out); }; })
      .then(function (l) { songs = l.sort(function (a, b) { return a.added - b.added; }); }, function () { songs = []; });
  }
  function urlOf(sg) { if (!urls[sg.id]) urls[sg.id] = URL.createObjectURL(sg.blob); return urls[sg.id]; }
  function saveSpot() { try { if (mineEl && songs[mineIdx]) localStorage.setItem('gm-spot', JSON.stringify({ id: songs[mineIdx].id, t: mineEl.currentTime })); } catch (e) {} }
  function playMine(i, at) {
    if (!songs.length) return;
    mineIdx = ((i % songs.length) + songs.length) % songs.length;
    if (!mineEl) { mineEl = new Audio(); mineEl.setAttribute('playsinline', ''); mineEl.onended = function () { playMine(mineIdx + 1); }; mineEl.onerror = function () { if (songs.length > 1) setTimeout(function () { playMine(mineIdx + 1); }, 300); }; }
    clearInterval(fadeTimer);
    if (cur && cur !== mineEl) cur.pause();
    cur = mineEl; curSrc = 'mine:' + songs[mineIdx].id;
    mineEl.loop = songs.length === 1;
    mineEl.src = urlOf(songs[mineIdx]);
    try { if (at) mineEl.currentTime = at; } catch (e) {}
    if (at) mineEl.addEventListener('loadedmetadata', function f() { mineEl.removeEventListener('loadedmetadata', f); try { mineEl.currentTime = at; } catch (e) {} });
    setVol(mineEl, vol);
    if (enabled) safePlay(mineEl);
    renderPanel();
  }
  function startMine() {
    var at = 0, i = 0;
    try { var sp = JSON.parse(localStorage.getItem('gm-spot') || 'null'); if (sp) { var k = songs.findIndex(function (x) { return x.id === sp.id; }); if (k >= 0) { i = k; at = sp.t || 0; } } } catch (e) {}
    playMine(i, at);
  }
  function play(src, opt) {
    gameSrc = src; gameOpt = opt;
    if (opt && opt.force) {                 // 节奏关卡等必须用游戏自带音乐（要卡拍子）
      if (mineEl && cur === mineEl) { saveSpot(); mineEl.pause(); cur = null; curSrc = ''; }
      playGame(src, opt); return;
    }
    if (mineOn && !loaded) return;          // 歌单还在读取，读完再决定放什么
    if (mineActive()) { if (!cur || cur !== mineEl) startMine(); else if (enabled && cur.paused) safePlay(cur); return; }
    playGame(src, opt);
  }
  function setMine(v) {
    mineOn = !!v; try { localStorage.setItem('gm-mine', mineOn ? '1' : '0'); } catch (e) {}
    if (mineActive()) startMine();
    else { if (mineEl) { saveSpot(); mineEl.pause(); } if (cur === mineEl) { cur = null; curSrc = ''; } if (gameSrc) playGame(gameSrc, gameOpt); }
    renderPanel();
  }
  function addFiles(files) {
    var list = [].slice.call(files || []).filter(function (f) { return /^audio\//.test(f.type) || /\.(mp3|m4a|aac|wav|ogg|flac|opus|webm)$/i.test(f.name); });
    if (!list.length) return Promise.resolve(0);
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
    var now = Date.now();
    var recs = list.map(function (f, k) { return { id: now.toString(36) + '-' + k + '-' + Math.random().toString(36).slice(2, 6), name: f.name.replace(/\.[^.]+$/, ''), blob: f, added: now + k }; });
    return db(function (d, res, rej) { var tx = d.transaction('songs', 'readwrite'); recs.forEach(function (r) { tx.objectStore('songs').put(r); }); tx.oncomplete = function () { res(); }; tx.onerror = function () { rej(tx.error); }; })
      .then(loadSongs).then(function () { if (!mineOn) { setMine(true); } else if (!cur || cur !== mineEl) startMine(); renderPanel(); return recs.length; });
  }
  function removeSong(id) {
    return db(function (d, res) { var tx = d.transaction('songs', 'readwrite'); tx.objectStore('songs').delete(id); tx.oncomplete = function () { res(); }; tx.onerror = function () { res(); }; })
      .then(function () {
        var playingId = cur === mineEl && songs[mineIdx] ? songs[mineIdx].id : null;
        if (urls[id]) { URL.revokeObjectURL(urls[id]); delete urls[id]; }
        return loadSongs().then(function () {
          if (playingId === id) { if (songs.length) playMine(mineIdx); else setMine(mineOn); }
          else if (playingId) mineIdx = Math.max(0, songs.findIndex(function (x) { return x.id === playingId; }));
          renderPanel();
        });
      });
  }
  addEventListener('pagehide', saveSpot);
  setInterval(function () { if (cur && cur === mineEl && !cur.paused) saveSpot(); }, 3000);
  loadSongs().then(function () { loaded = true; if (gameSrc) play(gameSrc, gameOpt); });

  function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function renderPanel() {
    if (!panel || panel.hidden) return;
    var playingId = cur && cur === mineEl && songs[mineIdx] ? songs[mineIdx].id : null;
    var h = '<div class="gmp-h"><b>🎵 我的歌单</b><button class="gmp-x" data-a="close">✕</button></div>' +
      '<label class="gmp-sw"><input type="checkbox" data-a="toggle"' + (mineOn ? ' checked' : '') + '> 用我的歌代替游戏音乐（所有游戏通用）</label>' +
      '<div class="gmp-list">' + (songs.length ? songs.map(function (sg, i) {
        return '<div class="gmp-it' + (sg.id === playingId ? ' on' : '') + '"><button class="gmp-n" data-a="play" data-i="' + i + '">' + (sg.id === playingId ? '🔊 ' : '') + esc(sg.name) + '</button><button class="gmp-d" data-a="del" data-id="' + sg.id + '">删除</button></div>';
      }).join('') : '<p class="gmp-empty">还没有歌。点下面的按钮，从手机里选几首歌加进来吧！</p>') + '</div>' +
      (songs.length > 1 ? '<div class="gmp-row"><button data-a="prev">⏮ 上一首</button><button data-a="next">下一首 ⏭</button></div>' : '') +
      '<div class="gmp-row"><button class="gmp-add" data-a="add">＋ 从手机里选歌</button></div>' +
      '<p class="gmp-tip">歌只存在这台手机的浏览器里，不会上传。支持 mp3 / m4a / aac / wav 等文件；音乐 App 里下载的会员歌曲是加密的，读不到。苹果手机请先把歌存到「文件」里再选。</p>';
    panel.querySelector('.gmp-box').innerHTML = h;
  }
  function openPlaylist() {
    unlock();
    if (!panel) {
      var st = document.createElement('style');
      st.textContent = '#gmPanel{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:16px;font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}#gmPanel[hidden]{display:none}' +
        '.gmp-box{background:#1d1f33;color:#fff;border-radius:18px;padding:14px 16px;width:min(420px,100%);max-height:min(560px,calc(100vh - 32px));display:flex;flex-direction:column;gap:10px;box-shadow:0 12px 40px rgba(0,0,0,.5);border:1px solid rgba(255,255,255,.12)}' +
        '.gmp-h{display:flex;align-items:center;justify-content:space-between;font-size:18px}.gmp-x{background:none;border:0;color:#fff;font-size:20px;padding:4px 8px;cursor:pointer}' +
        '.gmp-sw{display:flex;gap:8px;align-items:center;font-size:14px;background:rgba(255,255,255,.07);padding:8px 10px;border-radius:10px}.gmp-sw input{width:20px;height:20px;accent-color:#ffcf33}' +
        '.gmp-list{overflow:auto;flex:1;min-height:60px;display:flex;flex-direction:column;gap:6px}.gmp-it{display:flex;gap:6px}.gmp-n{flex:1;text-align:left;background:rgba(255,255,255,.08);color:#fff;border:0;border-radius:10px;padding:10px;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer}.gmp-it.on .gmp-n{background:rgba(255,207,51,.25);color:#ffe27a;font-weight:700}' +
        '.gmp-d{background:rgba(255,80,80,.18);color:#ff9d9d;border:0;border-radius:10px;padding:0 10px;font-size:13px;cursor:pointer}.gmp-empty{opacity:.7;font-size:14px;text-align:center;padding:16px 0}' +
        '.gmp-row{display:flex;gap:8px}.gmp-row button{flex:1;border:0;border-radius:12px;padding:11px;font-size:15px;font-weight:800;background:rgba(255,255,255,.12);color:#fff;cursor:pointer}.gmp-row .gmp-add{background:linear-gradient(180deg,#ffe066,#f0a01a);color:#3a2000}.gmp-tip{font-size:12px;opacity:.6;margin:0;line-height:1.5}';
      document.head.appendChild(st);
      panel = document.createElement('div'); panel.id = 'gmPanel'; panel.innerHTML = '<div class="gmp-box"></div><input type="file" accept="audio/*,.mp3,.m4a,.aac,.wav,.ogg,.flac" multiple hidden>';
      document.body.appendChild(panel);
      var inp = panel.querySelector('input[type=file]');
      inp.onchange = function () { var fs = inp.files; addFiles(fs).then(function (n) { if (!n) alert('没有识别到音频文件'); }, function () { alert('保存失败：可能是手机空间不足或浏览器禁止了存储（无痕模式）'); }); inp.value = ''; };
      panel.addEventListener('click', function (e) {
        if (e.target === panel) { closePlaylist(); return; }
        var b = e.target.closest('[data-a]'); if (!b) return; var a = b.dataset.a;
        if (a === 'close') closePlaylist();
        else if (a === 'add') inp.click();
        else if (a === 'play') { if (!mineOn) setMine(true); playMine(+b.dataset.i); }
        else if (a === 'del') removeSong(b.dataset.id);
        else if (a === 'prev') playMine(mineIdx - 1);
        else if (a === 'next') playMine(mineIdx + 1);
      });
      panel.addEventListener('change', function (e) { if (e.target.dataset && e.target.dataset.a === 'toggle') setMine(e.target.checked); });
      ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'keydown'].forEach(function (ev) { panel.addEventListener(ev, function (e) { e.stopPropagation(); }); });
    }
    panel.hidden = false; renderPanel();
  }
  function closePlaylist() { if (panel) panel.hidden = true; if (root.GameMusic.onPlaylistClose) root.GameMusic.onPlaylistClose(); }
  function pause() { if (cur) cur.pause(); }
  function resume() { if (cur && enabled) safePlay(cur); }
  function setEnabled(v) { enabled = !!v; if (!enabled) pause(); else resume(); }
  function setVolume(v) { vol = v; if (cur) setVol(cur, v); }
  function preload(list) { (list || []).forEach(get); }
  document.addEventListener('visibilitychange', function () { if (document.hidden) pause(); });

  root.GameMusic = { openPlaylist: openPlaylist, closePlaylist: closePlaylist, next: function () { if (mineActive()) playMine(mineIdx + 1); }, get mine() { return mineActive(); }, get songs() { return songs.map(function (x) { return x.name; }); }, play: play, jingle: jingle, stop: stop, pause: pause, resume: resume, setEnabled: setEnabled, setVolume: setVolume, preload: preload, unlock: unlock, get current() { return curSrc; }, get playing() { return !!cur && !cur.paused; }, get time() { return cur ? cur.currentTime : 0; } };
})(window);
