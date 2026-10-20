/* 双生 · 渲染器（精装版）
 * 接口（与 GAME_SPEC.md 第 5 节一致，不得变更）：
 *   Renderer.init(canvas)          // 初始化 + DPR 适配 + 尺寸自适应
 *   Renderer.render(state, anim)   // 每帧调用
 * state: { player, shadow, moves, won, level, goalShadowPos }
 * anim:  null | { t: 0~1, fromPlayer, toPlayer, fromShadow, toShadow }
 *
 * 视觉规范（GAME_SPEC.md 第 6 节）：深空 #12121c / 珊瑚 #FF6E5C / 靛蓝 #4F46E5
 * 纯 Canvas 2D 绘制：无外部图片、无外部字体、无第三方库。
 *
 * 性能：静态层（背景/棋盘格/网格线/镜像轴/墙）只在关卡或画布尺寸变化时
 *       重绘到离屏画布，每帧仅整幅贴图 + 动态层（目标呼吸/残影/棋子/暗角），
 *       39×39 大棋盘依然满帧。
 */
const Renderer = (function () {
  'use strict';

  const C = {
    bg: '#12121c',
    coral: '#FF6E5C',
    coralHi: '#FFA08F',
    indigo: '#4F46E5',
    indigoHi: '#7C74F0',
    gridLine: 'rgba(255,255,255,0.06)',
  };

  const TAU = Math.PI * 2;
  const ECHO_LIFE = 520;   // 落位残影寿命（ms）
  const TRAIL_GHOSTS = 3;  // 移动途中拖尾残像数量

  let canvas = null;
  let ctx = null;
  let dpr = 1;
  let cssSize = 0;   // 画布 CSS 边长
  let pad = 0;       // 棋盘外边距
  let cell = 0;      // 单格边长
  let gridN = 5;     // 当前网格数（供 init 计算用）
  let echoes = [];   // 残影 { r, c, color, hi, born }
  let lastAnim = null;
  let resizeBound = false;

  /* 静态层离屏画布：面板/格子/网格线/镜像轴/墙，关卡或尺寸变化时重建 */
  let staticCv = null;
  let staticCtx = null;
  let staticLevel = null;

  /* ---------- 基础工具 ---------- */

  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
  function easeOut(t) { const u = 1 - clamp01(t); return 1 - u * u * u; }
  function nowMs() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  }
  function hexA(hex, a) {
    const h = hex.replace('#', '');
    return 'rgba(' + parseInt(h.slice(0, 2), 16) + ',' +
      parseInt(h.slice(2, 4), 16) + ',' +
      parseInt(h.slice(4, 6), 16) + ',' + a + ')';
  }
  function rrPath(x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }
  function centerOf(r, c) {
    return { x: pad + (c + 0.5) * cell, y: pad + (r + 0.5) * cell };
  }
  function lerpPos(from, to, t) {
    const e = easeOut(t);
    return centerOf(from.r + (to.r - from.r) * e, from.c + (to.c - from.c) * e);
  }

  /* ---------- 尺寸 ---------- */

  function layout() {
    dpr = window.devicePixelRatio || 1;
    const vw = window.innerWidth || 360;
    const vh = window.innerHeight || 640;
    cssSize = Math.max(240, Math.min(vw * 0.92, vh * 0.62, 460));
    canvas.style.width = cssSize + 'px';
    canvas.style.height = cssSize + 'px';
    canvas.width = Math.round(cssSize * dpr);
    canvas.height = Math.round(cssSize * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    pad = cssSize * 0.055;
    cell = (cssSize - pad * 2) / gridN;
  }

  function relayout() { if (canvas && ctx) layout(); }

  function init(cv) {
    canvas = cv;
    ctx = canvas.getContext('2d');
    layout();
    if (!resizeBound) {
      resizeBound = true;
      window.addEventListener('resize', relayout);
      window.addEventListener('orientationchange', relayout);
    }
    return cssSize;
  }

  /* ---------- 图层 1：棋盘面板 ---------- */

  function drawPanel() {
    const r = Math.max(16, cssSize * 0.045);
    const g = ctx.createLinearGradient(0, 0, cssSize * 0.35, cssSize);
    g.addColorStop(0, '#1d1d2d');
    g.addColorStop(0.55, '#15151f');
    g.addColorStop(1, '#0e0e16');
    ctx.save();
    ctx.shadowColor = 'rgba(79,70,229,0.32)';
    ctx.shadowBlur = cssSize * 0.09;
    ctx.shadowOffsetY = cssSize * 0.015;
    ctx.fillStyle = g;
    rrPath(0, 0, cssSize, cssSize, r);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    rrPath(0.5, 0.5, cssSize - 1, cssSize - 1, r);
    ctx.stroke();
  }

  /* ---------- 图层 2：格子（圆角 + 微渐变） ---------- */

  function drawCells(n) {
    const inset = cell * 0.055;
    const w = cell - inset * 2;
    const r = cell * 0.17;
    const top = pad, bottom = pad + n * cell;
    const gA = ctx.createLinearGradient(0, top, 0, bottom);
    gA.addColorStop(0, 'rgba(255,255,255,0.062)');
    gA.addColorStop(1, 'rgba(255,255,255,0.024)');
    const gB = ctx.createLinearGradient(0, top, 0, bottom);
    gB.addColorStop(0, 'rgba(255,255,255,0.034)');
    gB.addColorStop(1, 'rgba(255,255,255,0.010)');
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        ctx.fillStyle = ((i + j) % 2 === 0) ? gA : gB;
        rrPath(pad + j * cell + inset, pad + i * cell + inset, w, w, r);
        ctx.fill();
      }
    }
  }

  /* ---------- 图层 3：网格线 ---------- */

  function drawGridLines(n) {
    ctx.save();
    ctx.strokeStyle = C.gridLine;
    ctx.lineWidth = 1;
    const x0 = pad, x1 = pad + n * cell;
    for (let i = 1; i < n; i++) {
      const p = pad + i * cell;
      ctx.beginPath(); ctx.moveTo(x0, p); ctx.lineTo(x1, p); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(p, x0); ctx.lineTo(p, x1); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    rrPath(x0, x0, n * cell, n * cell, cell * 0.17);
    ctx.stroke();
    ctx.restore();
  }

  /* ---------- 图层 4：镜像轴（两目标连线，极淡，强化对称感） ---------- */

  function drawMirrorAxis(goal, goalS) {
    const a = centerOf(goal.r, goal.c);
    const b = centerOf(goalS.r, goalS.c);
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.055)';
    ctx.lineWidth = Math.max(1, cell * 0.02);
    ctx.setLineDash([cell * 0.14, cell * 0.22]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.restore();
  }

  /* ---------- 图层 5：墙（珊瑚系挡本体 / 靛蓝系挡影子） ---------- */

  function drawWall(w, color, hi) {
    const inset = cell * 0.10;
    const x = pad + w.c * cell + inset;
    const y = pad + w.r * cell + inset;
    const s = cell - inset * 2;
    const r = cell * 0.13;
    const g = ctx.createLinearGradient(x, y, x + s, y + s);
    g.addColorStop(0, hexA(hi, 0.30));
    g.addColorStop(1, hexA(color, 0.15));
    ctx.fillStyle = g;
    rrPath(x, y, s, s, r);
    ctx.fill();
    ctx.save();
    rrPath(x, y, s, s, r);
    ctx.clip();
    ctx.strokeStyle = hexA(color, 0.34);
    ctx.lineWidth = Math.max(1, cell * 0.028);
    for (let k = -s; k < s * 2; k += cell * 0.24) {
      ctx.beginPath();
      ctx.moveTo(x + k, y);
      ctx.lineTo(x + k + s, y + s);
      ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = hexA(color, 0.55);
    ctx.lineWidth = Math.max(1, cell * 0.032);
    rrPath(x, y, s, s, r);
    ctx.stroke();
  }

  function drawWalls(level) {
    (level.wallsA || []).forEach(w => drawWall(w, C.coral, C.coralHi));
    (level.wallsB || []).forEach(w => drawWall(w, C.indigo, C.indigoHi));
  }

  /* ---------- 静态层缓存：只画一次，之后每帧整幅贴图 ---------- */

  function buildStatic(level, n, goalS) {
    staticCv = document.createElement('canvas');
    staticCv.width = canvas.width;
    staticCv.height = canvas.height;
    staticCtx = staticCv.getContext('2d');
    staticCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const mainCtx = ctx;
    ctx = staticCtx;
    try {
      staticCtx.fillStyle = C.bg;
      staticCtx.fillRect(0, 0, cssSize, cssSize);
      drawPanel();
      drawCells(n);
      drawGridLines(n);
      drawMirrorAxis(level.goal, goalS);
      drawWalls(level);
    } finally {
      ctx = mainCtx;
    }
    staticLevel = level;
  }

  /* ---------- 图层 6：目标（呼吸发光环） ---------- */

  function drawGoal(pos, color, hi, now, won) {
    const p = centerOf(pos.r, pos.c);
    const breathe = 0.5 + 0.5 * Math.sin(now / 520);

    // 柔光晕
    const halo = cell * (won ? 2.0 : 1.15);
    const rg = ctx.createRadialGradient(p.x, p.y, cell * 0.04, p.x, p.y, halo);
    rg.addColorStop(0, hexA(color, won ? 0.5 : 0.26));
    rg.addColorStop(1, hexA(color, 0));
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(p.x, p.y, halo, 0, TAU);
    ctx.fill();

    // 胜利扩散环
    if (won) {
      const ph = (now % 1200) / 1200;
      ctx.save();
      ctx.strokeStyle = hexA(hi, 0.55 * (1 - ph));
      ctx.lineWidth = Math.max(1.5, cell * 0.06 * (1 - ph));
      ctx.beginPath();
      ctx.arc(p.x, p.y, cell * (0.3 + 0.75 * ph), 0, TAU);
      ctx.stroke();
      ctx.restore();
    }

    // 呼吸环 + 内芯
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = cell * (won ? 0.7 : 0.32);
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(2, cell * (won ? 0.10 : 0.075));
    ctx.beginPath();
    ctx.arc(p.x, p.y, cell * (0.30 + 0.025 * breathe), 0, TAU);
    ctx.stroke();
    ctx.fillStyle = won ? hi : hexA(hi, 0.45 + 0.4 * breathe);
    ctx.beginPath();
    ctx.arc(p.x, p.y, cell * (won ? 0.155 : 0.10 * (0.88 + 0.12 * breathe)), 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  /* ---------- 图层 7：角色（圆角菱形 + 发光） ---------- */

  function drawActor(p, color, hi, alpha, glow, scale) {
    const half = cell * 0.30 * (scale || 1);
    const s = half * Math.SQRT2; // 旋转 45° 后方块边长
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(Math.PI / 4);
    ctx.globalAlpha = alpha;
    if (glow > 0) { ctx.shadowColor = color; ctx.shadowBlur = glow; }
    const g = ctx.createLinearGradient(-s / 2, -s / 2, s / 2, s / 2);
    g.addColorStop(0, hi);
    g.addColorStop(1, color);
    ctx.fillStyle = g;
    rrPath(-s / 2, -s / 2, s, s, s * 0.30);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = alpha * 0.92;
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    rrPath(-s * 0.17, -s * 0.17, s * 0.34, s * 0.34, s * 0.12);
    ctx.fill();
    ctx.restore();
  }

  // 移动拖尾：沿 from→to 路径留若干个逐渐淡出的残像
  function drawTrail(from, to, t, color, hi, baseAlpha) {
    for (let k = 1; k <= TRAIL_GHOSTS; k++) {
      const tk = t - k * 0.2;
      if (tk <= 0) continue;
      const a = baseAlpha * 0.5 * (1 - k / (TRAIL_GHOSTS + 1));
      drawActor(lerpPos(from, to, tk), color, hi, a, 0, 1 - k * 0.09);
    }
  }

  // 落位残影：一步结束后在起点格留一个缓慢淡出的印记
  function drawEchoes(now) {
    for (let i = 0; i < echoes.length; i++) {
      const e = echoes[i];
      const age = (now - e.born) / ECHO_LIFE;
      if (age >= 1) continue;
      drawActor(centerOf(e.r, e.c), e.color, e.hi, 0.24 * (1 - age), 0, 1 - 0.22 * age);
    }
  }

  /* ---------- 图层 8：暗角 ---------- */

  function drawVignette() {
    const g = ctx.createRadialGradient(
      cssSize / 2, cssSize / 2, cssSize * 0.35,
      cssSize / 2, cssSize / 2, cssSize * 0.78
    );
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, cssSize, cssSize);
  }

  /* ---------- 主渲染 ---------- */

  function render(state, anim) {
    if (!ctx || !canvas || !state || !state.level) return;
    const level = state.level;
    const n = level.size || 5;
    const now = nowMs();
    const won = !!state.won;

    gridN = n;
    pad = cssSize * 0.055;
    cell = (cssSize - pad * 2) / n;

    // 新的一步开始 → 记录残影
    if (anim && anim !== lastAnim) {
      if (anim.fromPlayer) echoes.push({ r: anim.fromPlayer.r, c: anim.fromPlayer.c, color: C.coral, hi: C.coralHi, born: now });
      if (anim.fromShadow) echoes.push({ r: anim.fromShadow.r, c: anim.fromShadow.c, color: C.indigo, hi: C.indigoHi, born: now });
      if (echoes.length > 12) echoes.splice(0, echoes.length - 12);
    }
    lastAnim = anim || null;
    echoes = echoes.filter(e => now - e.born < ECHO_LIFE);

    const goalS = state.goalShadowPos ||
      { r: n - 1 - level.goal.r, c: n - 1 - level.goal.c };

    // 静态层：关卡或画布尺寸变化时重建，否则整幅贴图
    if (!staticCv || staticLevel !== level ||
        staticCv.width !== canvas.width || staticCv.height !== canvas.height) {
      buildStatic(level, n, goalS);
    }

    ctx.clearRect(0, 0, cssSize, cssSize);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(staticCv, 0, 0);
    ctx.restore();

    drawGoal(level.goal, C.coral, C.coralHi, now, won);
    drawGoal(goalS, C.indigo, C.indigoHi, now, won);

    // 影子（半透明，绘制在本体之下）
    const sp = anim && anim.fromShadow && anim.toShadow
      ? lerpPos(anim.fromShadow, anim.toShadow, anim.t)
      : centerOf(state.shadow.r, state.shadow.c);
    // 本体
    const pp = anim && anim.fromPlayer && anim.toPlayer
      ? lerpPos(anim.fromPlayer, anim.toPlayer, anim.t)
      : centerOf(state.player.r, state.player.c);

    drawEchoes(now);
    if (anim && anim.fromShadow && anim.toShadow) {
      drawTrail(anim.fromShadow, anim.toShadow, anim.t, C.indigo, C.indigoHi, 0.65);
    }
    drawActor(sp, C.indigo, C.indigoHi, won ? 0.95 : 0.65, cell * (won ? 0.85 : 0.32), 1);
    if (anim && anim.fromPlayer && anim.toPlayer) {
      drawTrail(anim.fromPlayer, anim.toPlayer, anim.t, C.coral, C.coralHi, 0.85);
    }
    drawActor(pp, C.coral, C.coralHi, 1, cell * (won ? 0.9 : 0.42), 1);

    drawVignette();
  }

  return { init, render };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Renderer;
