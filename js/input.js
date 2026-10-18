/* 双生 · 输入（精装版）
 * 接口（与 GAME_SPEC.md 第 5 节一致，不得变更）：
 *   Input.init(canvas, onStep)
 *   onStep(dir) -> dir ∈ 'up'|'down'|'left'|'right'
 *
 * 支持：
 *   - 触摸滑动：阈值 24px、取主轴方向、抬手（touchend）触发、节流 120ms
 *   - 键盘：方向键 + WASD，preventDefault 阻止页面滚动
 *   - 加分项：滑动方向箭头预览（按下即跟随手指显示箭头，越阈变亮，抬手闪一下）
 *   - 附带：鼠标拖拽（桌面调试等价操作，同样抬手触发）
 */
const Input = (function () {
  'use strict';

  const THRESHOLD = 24;    // 滑动判定阈值（px）
  const THROTTLE = 120;    // 节流间隔（ms）
  const FLASH = 160;       // 抬手后箭头停留时长（ms）

  const KEYMAP = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    w: 'up', s: 'down', a: 'left', d: 'right',
  };

  const ARROW_COLOR = '#FF6E5C';
  const ARROW_DIM = 'rgba(232,230,240,0.34)';

  let lastFire = 0;
  let hintEl = null;
  let hintCanvas = null;
  let flashTimer = 0;

  function throttleOk() {
    const now = nowMs();
    if (now - lastFire < THROTTLE) return false;
    lastFire = now;
    return true;
  }

  function nowMs() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  }

  /* ---------- 方向箭头预览 ---------- */

  function angleOf(dir) {
    if (dir === 'right') return Math.PI / 2;
    if (dir === 'down') return Math.PI;
    if (dir === 'left') return -Math.PI / 2;
    return 0; // up
  }

  function ensureHint(canvas) {
    if (hintEl) return hintEl;
    const host = (canvas && canvas.parentNode) || document.body;
    hintEl = document.createElement('div');
    hintEl.id = 'swipe-hint';
    hintCanvas = document.createElement('canvas');
    hintCanvas.className = 'sh-arrow';
    hintCanvas.width = 64;
    hintCanvas.height = 64;
    hintEl.appendChild(hintCanvas);
    host.appendChild(hintEl);
    return hintEl;
  }

  function paintArrow(dir, active) {
    if (!hintCanvas) return;
    const g = hintCanvas.getContext('2d');
    g.clearRect(0, 0, 64, 64);
    g.save();
    g.translate(32, 32);
    g.rotate(angleOf(dir));
    g.fillStyle = active ? ARROW_COLOR : ARROW_DIM;
    if (active) { g.shadowColor = ARROW_COLOR; g.shadowBlur = 10; }
    g.beginPath();
    g.moveTo(0, -19);
    g.lineTo(13, 4);
    g.lineTo(5.5, 4);
    g.lineTo(5.5, 18);
    g.lineTo(-5.5, 18);
    g.lineTo(-5.5, 4);
    g.lineTo(-13, 4);
    g.closePath();
    g.fill();
    g.restore();
  }

  function moveHint(canvas, clientX, clientY) {
    const host = (canvas && canvas.parentNode) || document.body;
    const box = host.getBoundingClientRect();
    hintEl.style.left = (clientX - box.left) + 'px';
    hintEl.style.top = (clientY - box.top) + 'px';
  }

  function showHint(canvas, dir, clientX, clientY, active) {
    ensureHint(canvas);
    if (flashTimer) { clearTimeout(flashTimer); flashTimer = 0; }
    paintArrow(dir, active);
    hintEl.classList.toggle('active', !!active);
    hintEl.classList.add('show');
    if (typeof clientX === 'number') moveHint(canvas, clientX, clientY);
    else centerHint(canvas);
  }

  function centerHint(canvas) {
    const host = (canvas && canvas.parentNode) || document.body;
    const box = host.getBoundingClientRect();
    hintEl.style.left = (box.width / 2) + 'px';
    hintEl.style.top = (box.height / 2) + 'px';
  }

  function hideHint(delay) {
    if (!hintEl) return;
    if (flashTimer) { clearTimeout(flashTimer); flashTimer = 0; }
    const off = () => { if (hintEl) { hintEl.classList.remove('show'); hintEl.classList.remove('active'); } };
    if (delay > 0) flashTimer = setTimeout(off, delay);
    else off();
  }

  /* ---------- 初始化 ---------- */

  function init(canvas, onStep) {
    if (!canvas) return;
    ensureHint(canvas);

    const fire = (dir) => {
      if (!throttleOk()) return;
      onStep(dir);
    };

    /* 键盘：方向键 + WASD */
    const onKey = (e) => {
      if (!e || !e.key) return;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const dir = KEYMAP[k];
      if (!dir) return;
      e.preventDefault(); // 阻止方向键 / 空格滚动页面
      showHint(canvas, dir, null, null, true);
      hideHint(FLASH);
      fire(dir);
    };
    window.addEventListener('keydown', onKey, { passive: false });

    /* 滑动状态 */
    let id = null;
    let sx = 0, sy = 0, cx = 0, cy = 0;
    let dir = null;
    let armed = false; // 是否已越过阈值

    function dirOf(dx, dy) {
      if (Math.abs(dx) < THRESHOLD && Math.abs(dy) < THRESHOLD) return null;
      return Math.abs(dx) > Math.abs(dy)
        ? (dx > 0 ? 'right' : 'left')
        : (dy > 0 ? 'down' : 'up');
    }

    function begin(x, y) {
      armed = true;
      sx = cx = x;
      sy = cy = y;
      dir = null;
      showHint(canvas, 'up', x, y, false);
    }

    function move(x, y) {
      if (!armed) return;
      cx = x; cy = y;
      const d = dirOf(x - sx, y - sy);
      if (d) dir = d;
      showHint(canvas, dir || 'up', x, y, !!d);
    }

    function end() {
      if (!armed) return;
      armed = false;
      const d = dir || dirOf(cx - sx, cy - sy);
      if (d) { fire(d); hideHint(FLASH); }
      else hideHint(0);
      dir = null;
    }

    /* 触摸 */
    canvas.addEventListener('touchstart', (e) => {
      if (id !== null) return;
      const t = e.changedTouches[0];
      id = t.identifier;
      begin(t.clientX, t.clientY);
    }, { passive: true });

    canvas.addEventListener('touchmove', (e) => {
      if (id === null) return;
      let t = null;
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === id) { t = e.changedTouches[i]; break; }
      }
      if (!t) return;
      e.preventDefault(); // 阻止滑动时页面滚动
      move(t.clientX, t.clientY);
    }, { passive: false });

    const touchEnd = (e) => {
      if (id === null) return;
      let hit = false;
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === id) hit = true;
      }
      if (!hit) return;
      id = null;
      end();
    };
    canvas.addEventListener('touchend', touchEnd, { passive: true });
    canvas.addEventListener('touchcancel', () => { id = null; armed = false; hideHint(0); }, { passive: true });

    /* 鼠标拖拽（桌面） */
    canvas.addEventListener('mousedown', (e) => {
      if (id !== null) return;
      id = 'mouse';
      begin(e.clientX, e.clientY);
    });
    window.addEventListener('mousemove', (e) => {
      if (id !== 'mouse') return;
      move(e.clientX, e.clientY);
    });
    window.addEventListener('mouseup', (e) => {
      if (id !== 'mouse') return;
      id = null;
      cx = e.clientX; cy = e.clientY;
      end();
    });

    /* 阻止画布上的长按 / 拖拽默认行为 */
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  return { init };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Input;
