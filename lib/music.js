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
  function play(src, opt) {
    opt = opt || {};
    if (curSrc === src && cur) { if (enabled && cur.paused) safePlay(cur); return; }
    var old = cur, a = get(src);
    curSrc = src; cur = a;
    a.loop = opt.loop !== false;
    try { a.currentTime = opt.at || 0; } catch (e) {}
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
  function stop() { clearInterval(fadeTimer); if (cur) cur.pause(); cur = null; curSrc = ''; }
  function pause() { if (cur) cur.pause(); }
  function resume() { if (cur && enabled) safePlay(cur); }
  function setEnabled(v) { enabled = !!v; if (!enabled) pause(); else resume(); }
  function setVolume(v) { vol = v; if (cur) setVol(cur, v); }
  function preload(list) { (list || []).forEach(get); }
  document.addEventListener('visibilitychange', function () { if (document.hidden) pause(); });

  root.GameMusic = { play: play, jingle: jingle, stop: stop, pause: pause, resume: resume, setEnabled: setEnabled, setVolume: setVolume, preload: preload, unlock: unlock, get current() { return curSrc; }, get playing() { return !!cur && !cur.paused; } };
})(window);
