/* 双生 · 核心引擎
 * 规则：
 *  - 本体朝 dir 走一格，影子同时朝相反方向走一格。
 *  - 本体或影子任一方新位置越界/碰墙 → 整步无效，双方不动。
 *  - 本体踩上珊瑚目标且影子同时踩上对角靛蓝目标 → 过关。
 * UMD 导出：浏览器挂 window.Engine，Node 可 require 供工具使用。
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.Engine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DIRS = {
    up:    { dr: -1, dc:  0 },
    down:  { dr:  1, dc:  0 },
    left:  { dr:  0, dc: -1 },
    right: { dr:  0, dc:  1 },
  };

  // 影子走反方向：本体的位移向量取反
  function mirrorPos(pos, n) {
    return { r: n - 1 - pos.r, c: n - 1 - pos.c };
  }

  class Engine {
    constructor(level) {
      this.level = level;
      this.reset();
    }

    reset() {
      this.player = { r: this.level.player.r, c: this.level.player.c };
      this.shadow = { r: this.level.shadow.r, c: this.level.shadow.c };
      this.moves = 0;
      this.won = false;
      this.history = []; // 每次移动前的 [player, shadow] 快照，供悔棋
    }

    get size() { return this.level.size; }

    // 靛蓝目标：珊瑚目标的对角
    get goalShadow() { return mirrorPos(this.level.goal, this.size); }

    inBounds(p) {
      return p.r >= 0 && p.r < this.size && p.c >= 0 && p.c < this.size;
    }

    isWallA(p) { // 挡本体
      return this.level.wallsA.some(w => w.r === p.r && w.c === p.c);
    }

    isWallB(p) { // 挡影子
      return this.level.wallsB.some(w => w.r === p.r && w.c === p.c);
    }

    tryMove(dir) {
      if (this.won) return { ok: false, won: true };
      const d = DIRS[dir];
      if (!d) return { ok: false, reason: 'invalid-dir' };

      const np = { r: this.player.r + d.dr, c: this.player.c + d.dc };
      const ns = { r: this.shadow.r - d.dr, c: this.shadow.c - d.dc }; // 影子反方向

      if (!this.inBounds(np) || this.isWallA(np)) return { ok: false, reason: 'blocked' };
      if (!this.inBounds(ns) || this.isWallB(ns)) return { ok: false, reason: 'blocked' };

      this.history.push([
        { r: this.player.r, c: this.player.c },
        { r: this.shadow.r, c: this.shadow.c },
      ]);
      this.player = np;
      this.shadow = ns;
      this.moves++;

      const g = this.level.goal;
      const gs = this.goalShadow;
      this.won = (np.r === g.r && np.c === g.c) && (ns.r === gs.r && ns.c === gs.c);
      return { ok: true, won: this.won, moves: this.moves };
    }

    undo() {
      const last = this.history.pop();
      if (!last) return false;
      this.player = last[0];
      this.shadow = last[1];
      this.moves--;
      this.won = false;
      return true;
    }

    getState() {
      return {
        player: { r: this.player.r, c: this.player.c },
        shadow: { r: this.shadow.r, c: this.shadow.c },
        moves: this.moves,
        won: this.won,
      };
    }
  }

  Engine.DIRS = DIRS;
  Engine.mirrorPos = mirrorPos;
  return Engine;
});
