/* 双生 · 输入（精装版）
 * 接口（与 GAME_SPEC.md 第 5 节一致，不得变更）：
 *   Input.init(canvas, onStep)
 *   onStep(dir) -> dir ∈ 'up'|'down'|'left'|'right'
 *
 * 支持：
 *   - 屏幕十字方向键（#dpad）：pointerdown / touchstart / mousedown / click 多事件兜底
 *   - 键盘：方向键 + WASD，preventDefault 阻止页面滚动
 *   - 触摸滑动：阈值 24px、取主轴方向、抬手（touchend）触发、节流 120ms
 *   - 附带：鼠标拖拽（桌面调试等价操作，同样抬手触发）
 */
const Input = (function () {
  'use strict';

  const THRESHOLD = 24;    // 滑动判定阈值（px）
  const THROTTLE = 120;    // 节流间隔（ms）

  const KEYMAP = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    w: 'up', s: 'down', a: 'left', d: 'right',
  };

  let lastFire = 0;

  function throttleOk() {
    const now = nowMs();
    if (now - lastFire < THROTTLE) return false;
    lastFire = now;
    return true;
  }

  function nowMs() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  }

  /* ---------- 初始化 ---------- */

  function init(canvas, onStep) {
    if (!canvas) return;

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
      fire(dir);
    };
    window.addEventListener('keydown', onKey, { passive: false });

    /* 虚拟方向键（屏幕十字键）：与键盘同一节流。
     * 多事件兜底：pointerdown（现代浏览器）/ touchstart（老 WebView，可能不支持 PointerEvent）/ mousedown+click（桌面）。
     * 触摸后约 300ms 会补发一次 mousedown/click，用 touchFired 防双发；同刻多事件则由节流天然吸收。 */
    const dpad = document.getElementById('dpad');
    if (dpad) {
      dpad.querySelectorAll('.dp[data-dir]').forEach((btn) => {
        const dir = btn.dataset.dir;
        let touchFired = false;
        let touchTimer = 0;
        const press = (e) => {
          if (e && e.cancelable) e.preventDefault();
          fire(dir);
        };
        btn.addEventListener('pointerdown', press);
        btn.addEventListener('touchstart', (e) => {
          touchFired = true;
          if (touchTimer) { clearTimeout(touchTimer); }
          touchTimer = setTimeout(() => { touchFired = false; }, 500);
          press(e);
        }, { passive: false });
        btn.addEventListener('mousedown', (e) => { if (!touchFired) press(e); });
        btn.addEventListener('click', (e) => {
          e.preventDefault(); // 阻止按钮获得焦点等默认行为
          if (!touchFired) press(e);
        });
      });
    }

    /* 滑动状态 */
    let id = null;
    let sx = 0, sy = 0, cx = 0, cy = 0;
    let dir = null;
    let armed = false;

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
    }

    function move(x, y) {
      if (!armed) return;
      cx = x; cy = y;
      const d = dirOf(x - sx, y - sy);
      if (d) dir = d;
    }

    function end() {
      if (!armed) return;
      armed = false;
      const d = dir || dirOf(cx - sx, cy - sy);
      if (d) fire(d);
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
    canvas.addEventListener('touchcancel', () => { id = null; armed = false; }, { passive: true });

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
