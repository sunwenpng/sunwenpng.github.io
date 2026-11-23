/*
 * 节奏团子 · 核心：物理、关卡、自动求解器（无 DOM，可在 Node 里测试）
 * 坐标单位为格子；y 向上，地面表面在 y=0；第 r 行占 [r, r+1]。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DangoCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const PH = { G: 82, J: 19.5, VX: 8.4, H: 0.4, HZ: 0.3, MAXV: 28, DT: 1 / 240, PAD: 1.5, SUB: 4, AIR: 2, AIRJ: 0.9, HOLD0: 0.1, HOLD1: 0.38, HOLDG: 0.5 };
  // AIR：空中还能再跳几次（2 = 三连跳）；按住超过 HOLD0 秒后，上升时重力减半直到 HOLD1 秒（按得越久跳得越高）

  /* ---------- 关卡片段（上面一行是最高行，最后一行贴地） ---------- */
  // 记号：# 方块  ^ 地刺  v 倒刺  = 跳板  ~ 倒跳板  o 黄环（空中点击再跳）  b 蓝环（翻转重力）
  //       G 重力向上门  g 重力向下门  > 加速  < 减速  | 恢复速度  T 双生开始  t 双生结束  * 星星
  const C = {
    flat: ['......'],
    sp1: ['.....^.....'],
    sp2: ['.....^^.....'],
    sp3: ['.....^^^......'],
    sp1x3: ['....^.....^.....^.....'],
    blk1: ['.....#......'],
    blk2: ['.....##......', '.....##......'],
    blkrun: ['.....######.....'],
    blkspk: ['.....#^^#......'],
    stairs: ['...........###.....', '........######.....', '.....#########.....'],
    stairsSpk: ['............###......', '.........######......', '......#########^^....'],
    plat: [
      '.............###.......',
      '.........###...........',
      '.....###...............',
      '...^^^^^^^^^^^^^^^.....'],
    lowRoof: ['.....########.....', '..................'],
    lowRoofSpk: ['.........######......', '.....................', '.....^...........^...'],
    pillars: ['..........##..........', '.....##...##...##.....', '.....##^^^##^^^##.....'],
    pad1: ['.........#.......', '.........#.......', '......=..#.......'],
    padspk: ['.....=^^^^.......'],
    padplat: ['........####.........', '.....................', '.....................', '.....=.^^^^^^^.......'],
    orb1: ['........o.......', '................', '.....^^^^^^.....'],
    orb2: ['.......o...o..........', '......................', '.....^^^^^^^^^^.......'],
    orbHigh: [
      '............####......',
      '.........o............',
      '......................',
      '.......o..............',
      '......................',
      '.....^^^^^^^^^^^^^^...'],
    coinA: ['.......*......', '..............', '.....^^^......'],
    coinB: ['....*.....', '..........', '..........', '....=.....'],
    grav1: [
      '##########################',
      '.............vv...........',
      '..........................',
      '..........................',
      '..........................',
      '.....G........^.......g...'],
    grav2: [
      '##################################',
      '........vvv.........vv............',
      '..................................',
      '..................................',
      '..................................',
      '.....G........^^........g...^.....'],
    gravOrb: [
      '##############################',
      '.............vv...............',
      '..............................',
      '.......b......................',
      '..............................',
      '.....^^^^^^^^^^^^^...g........'],
    speedUp: ['....>.....^.......^^.......^......|....'],
    speedDn: ['.................##..........', '....<...^^.......##.....^^....|..'],
    fastStairs: ['....>..........###........|.', '..........######...........', '.......#########...........'],
  };
  const pad = (rows, w) => rows.map(r => r.padEnd(w, '.'));
  // 双生片段：给出下半部分（最多 4 行）和可选的上半部分，自动生成 10 行高、带天花板的片段
  const FLIPC = { '^': 'v', 'v': '^', '=': '~', '~': '=', '#': '#', 'o': 'o', '*': '*', '.': '.' };
  function twin(bottom, top, opt) {
    opt = opt || {};
    const w = Math.max(...bottom.map(r => r.length), ...(top || []).map(r => r.length)) + 4;
    const B = pad(bottom, w);
    const T = top ? pad(top, w) : B;
    const rows = [];
    rows.push('#'.repeat(w));                                       // 第 9 行：天花板
    const tb = T.slice().reverse();                                  // 上半部分倒过来贴在天花板下
    for (let i = 0; i < 4; i++) {
      const src = tb[i] || '.'.repeat(w);
      rows.push(src.split('').map(ch => FLIPC[ch] || '.').join(''));   // 第 8..5 行
    }
    const mid = '.'.repeat(w).split('');                             // 第 4 行：入口和出口
    mid[1] = 'T'; mid[w - 2] = 't';
    rows.push(mid.join(''));
    const bb = B.slice();
    while (bb.length < 4) bb.unshift('.'.repeat(w));
    for (const r of bb) rows.push(r);                                // 第 3..0 行
    if (opt.lead) return rows.map(r => '.'.repeat(opt.lead) + r);
    return rows;
  }
  C.tw1 = twin(['.....^........^.......']);
  C.tw2 = twin(['.....^^.......#.......']);
  C.twA = twin(['.....^...........^.......'], ['.........^...........^...']);
  C.twB = twin(['......#^^#.........'], ['..........^^.......']);
  C.twC = twin(['.....^.........^.........'], ['..........^.........^....']);
  C.twOrb = twin(['.......o.........', '.................', '.....^^^^^^......']);
  C.twPad = twin(['........^^^^^^.........', '.....=..................']);

  /* ---------- 关卡表 ---------- */
  const LEVELS = [
    { id: 1, name: '初遇', sub: '点一下跳，空中再点能三连跳，按住跳更高', color: '#ff9fb2', bg: ['#2b1d4a', '#6b3a7a'], bpm: 120, key: 0,
      seq: ['flat', 'flat', 'sp1', 'sp1', 'blk1', 'sp2', 'blk1', 'coinA', 'sp1x3', 'blk2', 'sp2', 'stairs', 'sp3', 'blkrun', 'coinA', 'blkspk', 'sp2', 'stairs', 'sp1x3', 'coinA', 'sp3', 'flat'] },
    { id: 2, name: '弹弹板', sub: '踩上黄色跳板会弹得更高', color: '#ffd166', bg: ['#14324a', '#2f6d7a'], bpm: 124, key: 2,
      seq: ['flat', 'flat', 'sp2', 'padspk', 'blk1', 'pad1', 'coinB', 'sp3', 'padplat', 'stairs', 'lowRoof', 'padspk', 'coinA', 'plat', 'pad1', 'blkspk', 'coinB', 'padplat', 'sp3', 'flat'] },
    { id: 3, name: '光环', sub: '空中碰到光环时点一下，二段跳', color: '#7ee0ff', bg: ['#102542', '#3b4a8c'], bpm: 128, key: 5,
      seq: ['flat', 'flat', 'sp2', 'orb1', 'blk1', 'orb1', 'coinA', 'orb2', 'stairs', 'lowRoofSpk', 'orbHigh', 'sp3', 'coinB', 'orb2', 'pillars', 'orbHigh', 'coinA', 'plat', 'flat'] },
    { id: 4, name: '逆重', sub: '穿过蓝门重力翻转，粉门翻回', color: '#b388ff', bg: ['#1a1238', '#4b2a7a'], bpm: 126, key: 7,
      seq: ['flat', 'flat', 'sp2', 'grav1', 'blk1', 'coinA', 'grav2', 'sp3', 'gravOrb', 'stairs', 'coinB', 'grav2', 'pillars', 'gravOrb', 'coinA', 'grav1', 'flat'] },
    { id: 5, name: '疾风', sub: '红门加速、蓝门减速，节奏会变', color: '#ff7a5c', bg: ['#3a1420', '#8a3a3a'], bpm: 132, key: 3,
      seq: ['flat', 'flat', 'sp2', 'speedUp', 'blk1', 'speedDn', 'coinA', 'fastStairs', 'orb1', 'speedUp', 'padspk', 'coinB', 'speedDn', 'orb2', 'fastStairs', 'pillars', 'coinA', 'speedUp', 'flat'] },
    { id: 6, name: '双生', sub: '新玩法：上下两只团子同时听你指挥', color: '#80ed99', bg: ['#0f2e2a', '#256d5a'], bpm: 120, key: 9,
      seq: ['flat', 'flat', 'sp1', 'tw1', 'blk1', 'tw2', 'coinA', 'sp2', 'twA', 'stairs', 'coinB', 'twB', 'sp3', 'twC', 'coinA', 'tw2', 'flat'] },
    { id: 7, name: '镜之舞', sub: '双生 + 光环 + 跳板', color: '#f7a8ff', bg: ['#2a1036', '#6a2a6a'], bpm: 128, key: 4,
      seq: ['flat', 'flat', 'sp2', 'twA', 'orb1', 'twOrb', 'coinA', 'twPad', 'padspk', 'coinB', 'twB', 'orbHigh', 'twC', 'gravOrb', 'coinA', 'twOrb', 'twPad', 'flat'] },
    { id: 8, name: '终章 · 星河', sub: '所有机关的大合奏', color: '#ffe066', bg: ['#0b0f2a', '#3a2a6a'], bpm: 136, key: 0,
      seq: ['flat', 'flat', 'sp3', 'speedUp', 'orb2', 'grav2', 'coinA', 'twA', 'padplat', 'fastStairs', 'gravOrb', 'twC', 'coinB', 'orbHigh', 'speedUp', 'twOrb', 'pillars', 'grav2', 'coinA', 'twB', 'stairsSpk', 'flat'] },
  ];
  const DAILY_POOL = ['sp2', 'sp3', 'sp1x3', 'blk2', 'blkspk', 'stairs', 'plat', 'lowRoofSpk', 'pillars', 'pad1', 'padspk', 'padplat', 'orb1', 'orb2', 'orbHigh', 'grav1', 'grav2', 'gravOrb', 'speedUp', 'speedDn', 'fastStairs', 'tw1', 'tw2', 'twA', 'twB', 'twC', 'twOrb', 'twPad', 'stairsSpk'];

  /* ---------- 组装 ---------- */
  function assemble(seq, opts) {
    opts = opts || {};
    const parts = seq.map(n => { const c = C[n]; if (!c) throw new Error('未知片段 ' + n); return c; });
    let coinsLeft = opts.coins === undefined ? 3 : opts.coins;
    const h = Math.max(...parts.map(p => p.length));
    const cols = [];                                                   // cols[c][r]
    for (const p of parts) {
      const w = Math.max(...p.map(r => r.length));
      const rows = pad(p, w);
      for (let c = 0; c < w; c++) {
        const col = [];
        for (let r = 0; r < h; r++) {
          const ri = rows.length - 1 - r;
          let ch = ri >= 0 ? rows[ri][c] : '.';
          if (ch === '*') { if (coinsLeft > 0) coinsLeft--; else ch = '.'; }
          col.push(ch);
        }
        cols.push(col);
      }
      cols.push(new Array(h).fill('.'), new Array(h).fill('.'));
    }
    for (let i = 0; i < 6; i++) cols.push(new Array(h).fill('.'));
    return build(cols, h);
  }
  function build(cols, h) {
    const w = cols.length;
    const grid = new Array(h);
    for (let r = 0; r < h; r++) { grid[r] = new Array(w); for (let c = 0; c < w; c++) grid[r][c] = cols[c][r]; }
    const trig = new Array(w).fill(null);
    const orbs = [], pads = [], coins = [];
    let orbId = 0, padId = 0, coinId = 0;
    const ids = {};
    for (let c = 0; c < w; c++) for (let r = 0; r < h; r++) {
      const ch = grid[r][c];
      if ('><|TtGg'.includes(ch)) { (trig[c] = trig[c] || []).push({ ch, r }); grid[r][c] = '.'; }
      else if (ch === 'o' || ch === 'b') { ids[c + ',' + r] = ++orbId; orbs.push({ c, r, ch, id: orbId }); }
      else if (ch === '=' || ch === '~') { ids[c + ',' + r] = ++padId; pads.push({ c, r, ch, id: padId }); }
      else if (ch === '*') { ids[c + ',' + r] = coinId++; coins.push({ c, r, id: coinId - 1 }); }
    }
    return { w, h, grid, trig, orbs, pads, coins, ids, end: w - 4 };
  }
  function tile(L, c, r) { if (r < 0 || c < 0 || c >= L.w || r >= L.h) return '.'; return L.grid[r][c]; }

  /* ---------- 物理 ---------- */
  function newState(L) {
    return { x: 0.5, speed: 1, t: 0, bodies: [newBody(0.5, 1)], twin: false, coins: 0, dead: false, won: false, events: [] };
  }
  function newBody(y, s) { return { y: y || PH.H, vy: 0, s: s || 1, g: true, lo: 0, lp: 0, land: 0, aj: 0, ht: 9 }; }
  function clone(st) {
    return { x: st.x, speed: st.speed, t: st.t, twin: st.twin, coins: st.coins, dead: st.dead, won: st.won, events: [], ph: st.ph,
      bodies: st.bodies.map(b => ({ y: b.y, vy: b.vy, s: b.s, g: b.g, lo: b.lo, lp: b.lp, land: b.land, aj: b.aj || 0, ht: b.ht == null ? 9 : b.ht })) };
  }
  const ov = (ax0, ax1, ay0, ay1, bx0, bx1, by0, by1) => ax1 > bx0 && ax0 < bx1 && ay1 > by0 && ay0 < by1;

  function step(st, L, held) {
    if (st.dead || st.won) return;
    const dt = PH.DT, H = PH.H;
    const px = st.x;
    st.x += PH.VX * st.speed * dt;
    st.t += dt;
    // 穿过的列触发器
    const c0 = Math.floor(px - 0.5), c1 = Math.floor(st.x - 0.5);
    for (let c = c0 + 1; c <= c1; c++) {
      const tr = L.trig[c]; if (!tr) continue;
      for (const t of tr) {
        if (t.ch === '>') { st.speed = 1.3; st.events.push('speed'); }
        else if (t.ch === '<') { st.speed = 0.8; st.events.push('speed'); }
        else if (t.ch === '|') { st.speed = 1; }
        else if (t.ch === 'G' || t.ch === 'g') {
          const ns = t.ch === 'G' ? -1 : 1, b = st.bodies[0];
          if (b.s !== ns) { b.s = ns; b.vy *= 0.5; b.g = false; st.events.push('grav'); }
        } else if (t.ch === 'T' && !st.twin) {
          const b = st.bodies[0], M = 2 * t.r + 1;
          st.bodies.push({ y: M - b.y, vy: -b.vy, s: -b.s, g: b.g, lo: 0, lp: 0, land: 0, aj: b.aj || 0, ht: b.ht == null ? 9 : b.ht });
          st.twin = true; st.events.push('twin');
        } else if (t.ch === 't' && st.twin) {
          st.bodies.length = 1; st.twin = false; st.events.push('untwin');
        }
      }
    }
    // 按下的那一刻（用来空中连跳）；st.press 由界面在快速“松开又按下”时设置
    const pressed = (held && !st.ph) || !!st.press;
    st.ph = !!held; st.press = false;
    for (let i = 0; i < st.bodies.length; i++) {
      stepBody(st, L, st.bodies[i], held, i, pressed);
      if (st.dead) return;
    }
    if (st.x >= L.end) { st.won = true; st.events.push('win'); }
  }

  // 求解器只用“经典跳法”（不用连跳/长按）验证关卡：新能力只会让玩家更容易，不会更难
  let CLASSIC = false;
  function stepBody(st, L, b, held, bi, pressed) {
    const dt = PH.DT, H = PH.H, x = st.x;
    if (held && b.g) { b.vy = PH.J * b.s; b.g = false; b.aj = 0; b.ht = 0; st.events.push('jump' + bi); }
    else if (!CLASSIC && pressed && !b.g && (b.aj || 0) < PH.AIR) { b.vy = PH.J * PH.AIRJ * b.s; b.aj = (b.aj || 0) + 1; b.ht = 0; st.events.push('air' + bi); }
    if (held) b.ht = (b.ht == null ? 9 : b.ht) + dt; else b.ht = 9;
    const floaty = !CLASSIC && held && b.vy * b.s > 0 && b.ht > PH.HOLD0 && b.ht < PH.HOLD1;
    b.vy -= PH.G * (floaty ? PH.HOLDG : 1) * b.s * dt;
    if (b.vy > PH.MAXV) b.vy = PH.MAXV; else if (b.vy < -PH.MAXV) b.vy = -PH.MAXV;
    const py = b.y;
    b.y += b.vy * dt;
    const wasG = b.g;
    b.g = false;
    if (b.y - H < 0) { b.y = H; if (b.vy < 0) b.vy = 0; if (b.s === 1) b.g = true; }
    // 方块
    const cx0 = Math.floor(x - H), cx1 = Math.floor(x + H - 1e-9);
    for (let pass = 0; pass < 2; pass++) {
      const ry0 = Math.floor(b.y - H), ry1 = Math.floor(b.y + H - 1e-9);
      let hit = false;
      for (let c = cx0; c <= cx1 && !hit; c++) for (let r = ry0; r <= ry1 && !hit; r++) {
        if (tile(L, c, r) !== '#') continue;
        if (!ov(x - H, x + H, b.y - H, b.y + H, c + 1e-6, c + 1 - 1e-6, r + 1e-6, r + 1 - 1e-6)) continue;
        const top = r + 1, bot = r;
        if (b.s === 1 && py - H >= top - 0.12 && b.vy <= 0) { b.y = top + H; b.vy = 0; b.g = true; hit = true; }
        else if (b.s === -1 && py + H <= bot + 0.12 && b.vy >= 0) { b.y = bot - H; b.vy = 0; b.g = true; hit = true; }
        else { st.dead = true; st.events.push('die'); return; }
      }
      if (!hit) break;
    }
    if (b.g) b.aj = 0;
    if (b.g && !wasG) b.land = 1;
    if (b.y > L.h + 5 || b.y < -1) { st.dead = true; st.events.push('die'); return; }
    // 机关
    const HZ = PH.HZ;
    const ax0 = Math.floor(x - 1), ax1 = Math.floor(x + 1), ay0 = Math.floor(b.y - 1), ay1 = Math.floor(b.y + 1);
    for (let c = ax0; c <= ax1; c++) for (let r = ay0; r <= ay1; r++) {
      const ch = tile(L, c, r);
      if (ch === '.' || ch === '#') continue;
      if (ch === '^') { if (ov(x - HZ, x + HZ, b.y - HZ, b.y + HZ, c + 0.3, c + 0.7, r, r + 0.5)) { st.dead = true; st.events.push('die'); return; } }
      else if (ch === 'v') { if (ov(x - HZ, x + HZ, b.y - HZ, b.y + HZ, c + 0.3, c + 0.7, r + 0.5, r + 1)) { st.dead = true; st.events.push('die'); return; } }
      else if (ch === '=' || ch === '~') {
        const id = L.ids[c + ',' + r];
        const hitP = ch === '=' ? ov(x - H, x + H, b.y - H, b.y + H, c, c + 1, r, r + 0.3) : ov(x - H, x + H, b.y - H, b.y + H, c, c + 1, r + 0.7, r + 1);
        if (hitP && b.lp !== id) { b.lp = id; b.vy = PH.J * PH.PAD * (ch === '=' ? 1 : -1); b.g = false; st.events.push('pad'); }
      } else if (ch === 'o' || ch === 'b') {
        const id = L.ids[c + ',' + r];
        if (held && b.lo !== id && Math.abs(x - (c + 0.5)) < 0.8 && Math.abs(b.y - (r + 0.5)) < 0.8) {
          b.lo = id;
          if (ch === 'o') { b.vy = PH.J * b.s; }
          else { b.s = -b.s; b.vy = -PH.J * 0.5 * b.s; }
          b.g = false; st.events.push(ch === 'o' ? 'orb' : 'grav');
        }
      } else if (ch === '*') {
        const id = L.ids[c + ',' + r], bit = 1 << id;
        if (!(st.coins & bit) && Math.abs(x - (c + 0.5)) < 0.75 && Math.abs(b.y - (r + 0.5)) < 0.75) { st.coins |= bit; st.events.push('coin'); }
      }
    }
  }

  /* ---------- 求解器：以 1/60 秒为决策粒度，找一条通关路线 ---------- */
  function solve(L, opts) {
    opts = opts || {};
    CLASSIC = opts.classic !== false;
    try { return solveInner(L, opts); } finally { CLASSIC = false; }
  }
  function solveInner(L, opts) {
    const maxW = opts.maxWidth || 3000;
    let layer = [{ st: opts.init || newState(L), path: null }];
    let frames = 0, best = 0, maxWidth = 1;
    while (layer.length) {
      frames++;
      const next = new Map();
      for (const node of layer) {
        for (const held of [0, 1]) {
          const s = clone(node.st);
          for (let k = 0; k < PH.SUB; k++) { step(s, L, held); if (s.dead || s.won) break; }
          if (s.dead) continue;
          if (s.x > best) best = s.x;
          const path = opts.path ? { h: held, p: node.path } : null;
          if (s.won) {
            return { ok: true, frames, maxWidth, path: path && unroll(path), coins: s.coins };
          }
          const key = s.bodies.map(b => Math.round(b.y * 200) + ':' + Math.round(b.vy * 10) + ':' + b.s + ':' + b.lo + ':' + b.lp + ':' + (b.g ? 1 : 0) + (CLASSIC ? '' : ':' + (b.aj || 0) + ':' + Math.min(5, Math.round(b.ht * 20)))).join('|') + '|' + s.speed + (CLASSIC ? '' : '|' + (s.ph ? 1 : 0));
          const prev = next.get(key);
          if (!prev || (opts.coins && popcount(s.coins) > popcount(prev.st.coins))) next.set(key, { st: s, path });
        }
      }
      layer = [...next.values()];
      if (opts.horizon && frames >= opts.horizon && layer.length) return { ok: true, frames };
      if (layer.length > maxWidth) maxWidth = layer.length;
      if (layer.length > maxW) {
        // 保留多样性：按高度排序后均匀抽样
        layer.sort((a, b) => a.st.bodies[0].y - b.st.bodies[0].y);
        const keep = []; const stepK = layer.length / maxW;
        for (let i = 0; i < maxW; i++) keep.push(layer[Math.floor(i * stepK)]);
        layer = keep;
      }
    }
    return { ok: false, frames, reached: best, maxWidth };
  }
  function popcount(n) { let c = 0; while (n) { c += n & 1; n >>= 1; } return c; }
  function unroll(p) { const out = []; while (p) { out.push(p.h); p = p.p; } return out.reverse(); }

  // 节拍宽容度：在通关路线上每个按键时刻前后挪动，看还能不能过（越大越简单）
  function makeDaily(seed) {
    let s = seed >>> 0 || 1;
    const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
    for (let attempt = 0; attempt < 12; attempt++) {
      const seq = ['flat', 'flat', 'sp2'];
      const n = 14;
      for (let i = 0; i < n; i++) {
        let pick; do { pick = DAILY_POOL[Math.floor(rnd() * DAILY_POOL.length)]; } while (pick === seq[seq.length - 1]);
        seq.push(pick);
        if (i === 3 || i === 8 || i === 12) seq.push('coinA');
      }
      seq.push('flat');
      const L = assemble(seq);
      if (solve(L, { maxWidth: 1500 }).ok) return { seq, L };
    }
    return { seq: LEVELS[0].seq, L: assemble(LEVELS[0].seq) };
  }

  return { PH, C, LEVELS, DAILY_POOL, assemble, tile, newState, clone, step, solve, makeDaily, twin };
});
