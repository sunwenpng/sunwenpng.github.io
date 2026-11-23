/*
 * BoardNet：两人棋类的联机流程（五子棋 / 象棋 / 围棋共用，依赖 net.js + netui.js）
 *
 *   const bn = BoardNet({ game, title, firstSide, otherSide,
 *     start(mySide, gameNo),      // 开一局：房主第一局执先手，之后每局交换
 *     apply(move, n),             // 对手走了一步；n 是走之前的步数（用来防止错位）
 *     moves(),                    // 当前全部着法（断线重连时发给对方）
 *     replay(moves),              // 收到对方的完整着法，补上自己缺的
 *     onResign(), status(text), extra(data) });
 *   bn.open()  bn.autoJoin()  bn.send(move)  bn.again()  bn.resign()  bn.extra(data)  bn.leave()  bn.active
 */
(function (root) {
  'use strict';
  root.BoardNet = function (cfg) {
    var room = null, host = false, gameNo = 0, mySide = null, peerOn = true;
    function start() { mySide = ((gameNo % 2 === 0) === host) ? cfg.firstSide : cfg.otherSide; cfg.start(mySide, gameNo); }
    function onMsg(d) {
      if (!d) return;
      if (d.k === 'again') { if (d.g > gameNo) { gameNo = d.g; start(); } return; }
      if (d.g !== gameNo) return;
      if (d.k === 'mv') cfg.apply(d.m, d.n);
      else if (d.k === 'resign') cfg.onResign && cfg.onResign();
      else if (d.k === 'sync') cfg.replay && cfg.replay(d.moves);
      else if (d.k === 'x') cfg.extra && cfg.extra(d.data);
    }
    function onRoom(info) {
      var n = info.players.length;
      if (n < 2 && peerOn) { peerOn = false; cfg.status && cfg.status('对手掉线了，等待重连…'); }
      else if (n >= 2 && !peerOn) { peerOn = true; cfg.status && cfg.status('对手回来了'); room.send({ k: 'sync', g: gameNo, moves: cfg.moves() }); }
    }
    var opts = {
      game: cfg.game, title: cfg.title, max: 2, hostExtra: cfg.hostExtra,
      onClose: function () { cfg.onClose && cfg.onClose(); },
      onStart: function (ctx) { api.startExtra = ctx.extra; room = ctx.room; host = ctx.isHost; gameNo = 0; peerOn = true; api.active = true; api.code = room.code; room.on('msg', onMsg); room.on('room', onRoom); room.on('error', function (m) { cfg.status && cfg.status(m); }); room.on('reconnecting', function () { cfg.status && cfg.status('网络不稳，重连中…'); }); start(); },
    };
    var api = {
      active: false, code: null,
      open: function () { NetUI.open(opts); },
      autoJoin: function () { return NetUI.autoJoin(opts); },
      side: function () { return mySide; },
      send: function (move) { if (room) room.send({ k: 'mv', g: gameNo, n: cfg.moves().length - 1, m: move }); },
      again: function () { gameNo++; if (room) room.send({ k: 'again', g: gameNo }); start(); },
      resign: function () { if (room) room.send({ k: 'resign', g: gameNo }); },
      extra: function (data) { if (room) room.send({ k: 'x', g: gameNo, data: data }); },
      leave: function () { NetUI.leave(); api.active = false; room = null; },
      get isHost() { return host; },
    };
    return api;
  };
})(window);
