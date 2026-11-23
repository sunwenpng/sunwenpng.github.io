/*
 * BoardKit：棋类游戏共用的 3D 场景（three.js r128）
 * - 木纹桌面 + 立体棋盘 + 灯光阴影
 * - 两种视角：3D 斜视 / 俯视（方便精确落子）
 * - pick(clientX, clientY) 把屏幕点击换算成棋盘平面坐标
 * - stone()/disc() 生成棋子；tween() 做落子动画
 */
(function (root) {
  'use strict';
  var T = root.THREE;
  function canvasTex(w, h, fn) { var c = document.createElement('canvas'); c.width = w; c.height = h; fn(c.getContext('2d'), w, h); var t = new T.CanvasTexture(c); t.anisotropy = 8; return t; }
  function wood(g, w, h, base, dark, seed) {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    var s = seed || 7, r = function () { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (var i = 0; i < 90; i++) {
      var y = r() * h, amp = 2 + r() * 6, fr = 0.004 + r() * 0.01, ph = r() * 6;
      g.strokeStyle = dark; g.globalAlpha = 0.05 + r() * 0.12; g.lineWidth = 1 + r() * 3; g.beginPath();
      for (var x = 0; x <= w; x += 8) { var yy = y + Math.sin(x * fr + ph) * amp; x ? g.lineTo(x, yy) : g.moveTo(x, yy); }
      g.stroke();
    }
    g.globalAlpha = 1;
  }
  function woodTex(base, dark, seed, w, h) { return canvasTex(w || 512, h || 512, function (g, W, H) { wood(g, W, H, base, dark, seed); }); }

  function create(canvas, opt) {
    opt = opt || {};
    var size = opt.size || 10, thick = opt.thick || 0.8;
    var renderer = new T.WebGLRenderer({ canvas: canvas, antialias: true });
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
    var scene = new T.Scene();
    scene.background = canvasTex(4, 256, function (g, w, h) { var gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, opt.bgTop || '#3a2418'); gr.addColorStop(1, opt.bgBottom || '#140a06'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
    var camera = new T.PerspectiveCamera(38, 1, 0.1, 200);
    scene.add(new T.HemisphereLight(0xfff4e0, 0x3a2a20, 0.7));
    var lamp = new T.DirectionalLight(0xfff0d8, 0.85); lamp.position.set(-size * 0.5, size * 1.6, size * 0.7); lamp.castShadow = true;
    lamp.shadow.mapSize.set(2048, 2048); var sc = lamp.shadow.camera; sc.left = sc.bottom = -size; sc.right = sc.top = size; sc.near = 0.5; sc.far = size * 5; lamp.shadow.bias = -0.0005;
    scene.add(lamp);
    var fill = new T.PointLight(0xffd8a8, 0.35, size * 6); fill.position.set(size, size * 0.8, -size); scene.add(fill);
    // 桌面
    var tableT = woodTex('#5a3a22', '#2a160a', 3); tableT.wrapS = tableT.wrapT = T.RepeatWrapping; tableT.repeat.set(3, 3);
    var table = new T.Mesh(new T.PlaneGeometry(size * 8, size * 8), new T.MeshLambertMaterial({ map: tableT }));
    table.rotation.x = -Math.PI / 2; table.position.y = -thick - 0.02; table.receiveShadow = true; scene.add(table);
    // 棋盘
    var topTex = canvasTex(1024, Math.round(1024 * (opt.depth || size) / size), function (g, w, h) { (opt.drawTop || function () {})(g, w, h); });
    var sideM = new T.MeshPhongMaterial({ map: woodTex(opt.sideColor || '#b07a3c', '#5a3410', 11), shininess: 20 });
    var topM = new T.MeshPhongMaterial({ map: topTex, shininess: 30 });
    var depth = opt.depth || size;
    var board = new T.Mesh(new T.BoxGeometry(size, thick, depth), [sideM, sideM, topM, sideM, sideM, sideM]);
    board.position.y = -thick / 2; board.castShadow = true; board.receiveShadow = true; scene.add(board);
    var feet = [];
    if (opt.feet) { for (var fx = -1; fx <= 1; fx += 2) for (var fz = -1; fz <= 1; fz += 2) { var f = new T.Mesh(new T.CylinderGeometry(0.35, 0.45, 0.5, 12), sideM); f.position.set(fx * size * 0.4, -thick - 0.25, fz * depth * 0.4); f.castShadow = true; scene.add(f); feet.push(f); } table.position.y = -thick - 0.52; }

    var view = opt.view || '3d', W = 0, H = 0, camTarget = new T.Vector3(), camGoal = new T.Vector3(), first = true;
    function fit() {
      W = canvas.clientWidth || innerWidth; H = canvas.clientHeight || innerHeight;
      renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1)); renderer.setSize(W, H, false);
      camera.aspect = W / H; camera.updateProjectionMatrix();
      var vf = camera.fov * Math.PI / 180, hf = 2 * Math.atan(Math.tan(vf / 2) * camera.aspect), f = Math.min(vf, hf);
      var r = Math.max(size, depth) * 0.5 * (opt.margin || 1.12) * Math.SQRT2 * 0.82;
      var d = r / Math.sin(f / 2);
      var dir = view === 'top' ? new T.Vector3(0, 1, 0.0001) : new T.Vector3(0, 1.2, 0.78).normalize();
      if (view !== 'top' && camera.aspect > 1.2) d *= 0.92;
      camGoal.copy(dir).multiplyScalar(d); camTarget.set(0, 0, view === 'top' ? 0 : size * 0.04);
      if (first) { camera.position.copy(camGoal); first = false; }
    }
    addEventListener('resize', fit); fit();
    var ray = new T.Raycaster(), plane = new T.Plane(new T.Vector3(0, 1, 0), 0), v2 = new T.Vector2(), hit = new T.Vector3();
    function pick(cx, cy) {
      var rect = canvas.getBoundingClientRect();
      v2.set((cx - rect.left) / rect.width * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(v2, camera); var p = ray.ray.intersectPlane(plane, hit);
      return p ? { x: p.x, z: p.z } : null;
    }
    var tweens = [];
    function tween(dur, fn, done) { tweens.push({ t: 0, dur: dur, fn: fn, done: done }); }
    var last = performance.now(), sway = 0;
    function render() {
      var now = performance.now(), dt = Math.min(0.05, (now - last) / 1000); last = now; sway += dt;
      camera.position.lerp(camGoal, Math.min(1, dt * 5));
      camera.lookAt(camTarget);
      for (var i = tweens.length - 1; i >= 0; i--) { var tw = tweens[i]; tw.t += dt; var k = Math.min(1, tw.t / tw.dur); tw.fn(k); if (k >= 1) { tweens.splice(i, 1); if (tw.done) tw.done(); } }
      renderer.render(scene, camera);
    }
    function setView(v) { view = v; fit(); }
    function toScreen(x, y, z) { var v = new T.Vector3(x, y, z).project(camera); return [(v.x + 1) / 2 * W, (1 - v.y) / 2 * H]; }
    return { renderer: renderer, scene: scene, camera: camera, board: board, topTex: topTex, size: size, depth: depth, pick: pick, render: render, tween: tween, setView: setView, get view() { return view; }, fit: fit, toScreen: toScreen, redrawTop: function () { var c = topTex.image; (opt.drawTop || function () {})(c.getContext('2d'), c.width, c.height); topTex.needsUpdate = true; } };
  }
  var stoneGeo = null;
  function stone(color, r) {
    if (!stoneGeo) { stoneGeo = new T.SphereGeometry(1, 28, 16); stoneGeo.scale(1, 0.42, 1); }
    var black = color === 'black';
    var m = new T.Mesh(stoneGeo, new T.MeshPhongMaterial({ color: black ? 0x151515 : 0xf2f0e8, specular: black ? 0x666666 : 0x999999, shininess: black ? 90 : 60 }));
    m.scale.setScalar(r || 0.45); m.castShadow = true; m.receiveShadow = true; return m;
  }
  function disc(label, red, r, h) {
    var top = canvasTex(256, 256, function (g, w, hh) {
      var gr = g.createRadialGradient(w / 2, hh / 2, 10, w / 2, hh / 2, w / 2); gr.addColorStop(0, '#fbe9c8'); gr.addColorStop(1, '#e3c08a'); g.fillStyle = gr; g.fillRect(0, 0, w, hh);
      g.strokeStyle = red ? '#b3261e' : '#1d1d1d'; g.lineWidth = 10; g.beginPath(); g.arc(w / 2, hh / 2, w / 2 - 26, 0, Math.PI * 2); g.stroke();
      g.fillStyle = red ? '#c0281f' : '#151515'; g.font = 'bold 128px "KaiTi","STKaiti","Kaiti SC","楷体",serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, w / 2, hh / 2 + 6);
    });
    var side = new T.MeshPhongMaterial({ color: 0xd9b37a, shininess: 30 });
    var m = new T.Mesh(new T.CylinderGeometry(r || 0.42, r || 0.42, h || 0.22, 36), [side, new T.MeshPhongMaterial({ map: top, shininess: 40 }), side]);
    m.castShadow = true; m.receiveShadow = true; return m;
  }
  root.BoardKit = { create: create, stone: stone, disc: disc, woodTex: woodTex, wood: wood, canvasTex: canvasTex };
})(window);
