/* touch.js — on-screen controls for phones & tablets.
   Appears only on touch devices (or with ?touch=1). Desktop is untouched.
   menu.js calls ArcadeTouch.init() once and ArcadeTouch.configure() whenever
   the active game changes; buttons then feed the same key-routing function
   the physical keyboard uses. */
'use strict';

const ArcadeTouch = (() => {
  const isTouch = (typeof window !== 'undefined') &&
    (('ontouchstart' in window) || (navigator.maxTouchPoints > 0) ||
     /[?&]touch=1/.test(location.search || ''));

  let press = null;          // (code, down) => void, supplied by menu.js
  let root = null, dpadEl = null, btnA = null, btnB = null, btnOk = null;
  let dpadMode = null;       // 'full' | 'lr' | 'ud' | null
  let heldDir = null;        // currently pressed dpad code
  let cfg = {};

  const DIR = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };

  function mkButton(cls, label) {
    const b = document.createElement('div');
    b.className = 'tu-btn ' + cls;
    b.textContent = label;
    return b;
  }

  function bindPress(el, getCode) {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const code = getCode();
      if (!code) return;
      el.classList.add('on');
      if (Sfx && Sfx.ac) Sfx.ac();           // first gesture unlocks audio
      press(code, true);
    });
    const up = (e) => {
      e.preventDefault();
      const code = getCode();
      el.classList.remove('on');
      if (code) press(code, false);
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', up);
  }

  function dpadDirFor(e) {
    const r = dpadEl.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    if (Math.hypot(dx, dy) < r.width * 0.12) return null;     // dead zone
    let dir;
    if (Math.abs(dx) > Math.abs(dy)) dir = dx < 0 ? 'left' : 'right';
    else dir = dy < 0 ? 'up' : 'down';
    if (dpadMode === 'lr' && (dir === 'up' || dir === 'down')) {
      dir = dx < 0 ? 'left' : 'right';
    }
    if (dpadMode === 'ud' && (dir === 'left' || dir === 'right')) {
      dir = dy < 0 ? 'up' : 'down';
    }
    return dir;
  }

  function setHeld(dir) {
    const code = dir ? DIR[dir] : null;
    if (heldDir === code) return;
    if (heldDir) press(heldDir, false);
    heldDir = code;
    if (heldDir) press(heldDir, true);
    for (const d of ['up', 'down', 'left', 'right']) {
      dpadEl.classList.toggle('dir-' + d, dir === d);
    }
  }

  function buildUi() {
    root = document.createElement('div');
    root.id = 'touchui';

    // utility row: back to menu, pause, context button
    const util = document.createElement('div');
    util.className = 'tu-util';
    const menuBtn = mkButton('tu-mini', 'MENU');
    const pauseBtn = mkButton('tu-mini', 'PAUSE');
    btnOk = mkButton('tu-mini tu-ok', 'OK');
    bindPress(menuBtn, () => 'Escape');
    bindPress(pauseBtn, () => 'KeyP');
    bindPress(btnOk, () => (cfg.ok && cfg.ok.code) || 'Enter');
    util.append(menuBtn, pauseBtn, btnOk);

    // d-pad: one surface, finger can slide between directions
    dpadEl = document.createElement('div');
    dpadEl.className = 'tu-dpad';
    for (const d of ['up', 'down', 'left', 'right']) {
      const arm = document.createElement('div');
      arm.className = 'tu-arm tu-' + d;
      dpadEl.appendChild(arm);
    }
    let activePointer = null;
    dpadEl.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      activePointer = e.pointerId;
      dpadEl.setPointerCapture(e.pointerId);
      if (Sfx && Sfx.ac) Sfx.ac();
      setHeld(dpadDirFor(e));
    });
    dpadEl.addEventListener('pointermove', (e) => {
      if (e.pointerId !== activePointer) return;
      e.preventDefault();
      setHeld(dpadDirFor(e));
    });
    const dpadUp = (e) => {
      if (e.pointerId !== activePointer) return;
      e.preventDefault();
      activePointer = null;
      setHeld(null);
    };
    dpadEl.addEventListener('pointerup', dpadUp);
    dpadEl.addEventListener('pointercancel', dpadUp);

    // action buttons
    const btns = document.createElement('div');
    btns.className = 'tu-actions';
    btnB = mkButton('tu-round tu-b', 'B');
    btnA = mkButton('tu-round tu-a', 'A');
    bindPress(btnA, () => cfg.a && cfg.a.code);
    bindPress(btnB, () => cfg.b && cfg.b.code);
    btns.append(btnB, btnA);

    root.append(util, dpadEl, btns);
    document.body.appendChild(root);
  }

  return {
    get active() { return isTouch; },

    init(pressFn) {
      if (!isTouch) return;
      press = pressFn;
      buildUi();
      document.body.classList.add('touch-device');

      // iOS Safari ignores user-scalable=no: double-taps and pinches still
      // page-zoom. All game input goes through pointer/touch handlers, so no
      // default browser gesture is needed anywhere — block them outright.
      const block = (e) => { if (e.cancelable) e.preventDefault(); };
      document.addEventListener('gesturestart', block, { passive: false });
      document.addEventListener('gesturechange', block, { passive: false });
      document.addEventListener('dblclick', block, { passive: false });
      let lastTap = 0;
      document.addEventListener('touchend', (e) => {
        const now = performance.now();
        if (now - lastTap < 350 && e.cancelable) e.preventDefault();
        lastTap = now;
      }, { passive: false, capture: true });
    },

    /* cfg: { dpad:'full'|'lr'|'ud'|null, a:{code,label}, b:{code,label},
              ok:{code,label} } */
    configure(newCfg) {
      if (!isTouch || !root) return;
      cfg = newCfg || {};
      if (heldDir) { press(heldDir, false); heldDir = null; }
      dpadMode = cfg.dpad || null;
      root.classList.add('active');
      dpadEl.style.visibility = dpadMode ? 'visible' : 'hidden';
      dpadEl.classList.toggle('mode-lr', dpadMode === 'lr');
      dpadEl.classList.toggle('mode-ud', dpadMode === 'ud');
      btnA.style.visibility = cfg.a ? 'visible' : 'hidden';
      btnB.style.visibility = cfg.b ? 'visible' : 'hidden';
      if (cfg.a) btnA.textContent = cfg.a.label || 'A';
      if (cfg.b) btnB.textContent = cfg.b.label || 'B';
      btnOk.textContent = (cfg.ok && cfg.ok.label) || 'OK';
    },
  };
})();
