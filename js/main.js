/* 双生 · 入口：状态机、动画驱动、HUD、按钮、选关（Claude 负责，CodeBuddy 不得改动接口） */
(function () {
  'use strict';

  let eng = null;
  let curLevel = 0;
  let anim = null; // { t, fromPlayer, toPlayer, fromShadow, toShadow }
  let winShown = false;

  const canvas = document.getElementById('board');
  const elMoves = document.getElementById('move-count');
  const elTime = document.getElementById('time-count');
  const elLevelName = document.getElementById('level-name');
  const elWin = document.getElementById('win-overlay');
  const elWinInfo = document.getElementById('win-info');
  const elWinRecords = document.getElementById('win-records');
  const elLevelSelect = document.getElementById('level-select');
  const elLsButtons = document.getElementById('ls-buttons');
  const elPrivacy = document.getElementById('privacy-overlay');
  const elPrivacyTip = document.getElementById('privacy-decline-tip');

  // 用关卡数量判定版本：100 关 = 地狱版（打包后入口改名 index.html 也依然正确）
  const MODE = (typeof LEVELS !== 'undefined' && LEVELS.length > 20) ? 'hell' : 'normal';
  let startTime = 0; // 本关计时起点（ms，performance.now 基准）
  let finalMs = 0;   // 过关时定格的总用时；0 = 计时中

  Renderer.init(canvas);

  function starsFor(moves, par) {
    if (moves <= par) return 3;
    if (moves <= par * 1.5) return 2;
    return 1;
  }

  function fmtTime(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  function bestKey(i) { return 'ss_best_' + MODE + '_' + (i === undefined ? curLevel : i); }

  function bestMs(i) {
    try {
      const v = localStorage.getItem(bestKey(i));
      return v === null ? null : parseInt(v, 10);
    } catch (e) { return null; }
  }

  function saveBest(ms) {
    try { localStorage.setItem(bestKey(), String(Math.floor(ms))); } catch (e) { /* 忽略 */ }
  }

  function updateHUD() {
    elMoves.textContent = eng.moves + '/' + eng.level.par;
    elLevelName.textContent = '第 ' + (curLevel + 1) + ' 关 · ' + eng.level.name;
  }

  function loadLevel(i) {
    curLevel = i;
    eng = new Engine(LEVELS[i]);
    anim = null;
    winShown = false;
    startTime = performance.now();
    finalMs = 0;
    elTime.textContent = '0:00';
    elWin.classList.add('hidden');
    Renderer.init(canvas); // 重新适配网格尺寸
    updateHUD();
  }

  function showWin() {
    const stars = starsFor(eng.moves, eng.level.par);
    const prev = bestMs();
    const won = prev === null || finalMs < prev;
    if (won) saveBest(finalMs);
    elWinInfo.textContent = '用时 ' + eng.moves + ' 步 · ' + fmtTime(finalMs) + ' · ' + '★'.repeat(stars) + '☆'.repeat(3 - stars);
    elWinRecords.textContent = '最短 ' + eng.level.par + ' 步 · 最快 ' + fmtTime(won ? finalMs : prev)
      + (prev === null ? '（首次纪录）' : won ? '（新纪录！）' : '');
    elWin.classList.remove('hidden');
  }

  function onStep(dir) {
    if (!eng || anim || winShown) return;
    const res = eng.tryMove(dir);
    if (res.ok) {
      anim = {
        t: 0,
        fromPlayer: eng.history[eng.history.length - 1][0],
        toPlayer: { r: eng.player.r, c: eng.player.c },
        fromShadow: eng.history[eng.history.length - 1][1],
        toShadow: { r: eng.shadow.r, c: eng.shadow.c },
      };
      updateHUD();
      if (res.won) {
        finalMs = performance.now() - startTime;
        winShown = true;
        setTimeout(showWin, 320);
      }
    }
  }

  function frame() {
    if (anim) {
      anim.t += 0.16; // ~6 帧完成一步
      if (anim.t >= 1) anim = null;
    }
    if (eng && finalMs === 0) {
      const t = fmtTime(performance.now() - startTime);
      if (elTime.textContent !== t) elTime.textContent = t;
    }
    if (eng) {
      Renderer.render({
        player: eng.player,
        shadow: eng.shadow,
        moves: eng.moves,
        won: eng.won,
        level: eng.level,
        goalShadowPos: eng.goalShadow,
      }, anim);
    }
    requestAnimationFrame(frame);
  }

  // 按钮
  document.getElementById('btn-undo').addEventListener('click', () => {
    if (!eng || anim || winShown) return;
    if (eng.undo()) updateHUD();
  });
  document.getElementById('btn-reset').addEventListener('click', () => loadLevel(curLevel));
  document.getElementById('btn-next').addEventListener('click', () => {
    loadLevel((curLevel + 1) % LEVELS.length);
  });
  document.getElementById('btn-replay').addEventListener('click', () => loadLevel(curLevel));
  document.getElementById('btn-levels').addEventListener('click', () => {
    buildLevelSelect(); // 刷新各关纪录
    elLevelSelect.classList.remove('hidden');
  });
  document.getElementById('btn-ls-close').addEventListener('click', () => {
    elLevelSelect.classList.add('hidden');
  });

  // 选关面板
  function buildLevelSelect() {
    elLsButtons.innerHTML = '';
    LEVELS.forEach((lv, i) => {
      const b = document.createElement('button');
      const best = bestMs(i);
      b.innerHTML = '<span>' + (i + 1) + '. ' + lv.name + '</span>'
        + '<span class="ls-meta">最短 ' + lv.par + ' 步 · 最快 ' + (best === null ? '--' : fmtTime(best)) + '</span>';
      b.addEventListener('click', () => {
        elLevelSelect.classList.add('hidden');
        loadLevel(i);
      });
      elLsButtons.appendChild(b);
    });
  }

  /* ---------- 启动门槛：隐私政策同意（TapTap 合规要求） ---------- */
  let started = false;

  function startGame() {
    if (started) return;
    started = true;
    buildLevelSelect();
    loadLevel(0);
    Input.init(canvas, onStep);
    requestAnimationFrame(frame);
  }

  try {
    if (localStorage.getItem('ss_privacy_ok')) {
      elPrivacy.classList.add('hidden');
      startGame();
    }
  } catch (e) { /* localStorage 不可用时仍显示门槛 */ }

  document.getElementById('btn-privacy-agree').addEventListener('click', () => {
    try { localStorage.setItem('ss_privacy_ok', '1'); } catch (e) { /* 忽略 */ }
    elPrivacy.classList.add('hidden');
    startGame();
  });
  document.getElementById('btn-privacy-decline').addEventListener('click', () => {
    elPrivacyTip.classList.remove('hidden');
  });
})();
