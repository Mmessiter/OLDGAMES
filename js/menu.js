/* menu.js — arcade shell: menu screen, game switching, global keys, main loop. */
'use strict';

(() => {
  const canvas = document.getElementById('screen');
  const ctx = canvas.getContext('2d');

  const GAMES = [
    {
      title: 'SPACE INVADERS', color: '#33ff44', hiKey: 'invaders',
      make: (a) => new InvadersGame(a),
      keys: ['LEFT / RIGHT   MOVE CANNON',
             'SPACE          FIRE',
             'P              PAUSE'],
      blurb: 'Blast the fleet before it lands. Shoot the UFO for mystery points.',
      touch: { dpad: 'lr', a: { code: 'Space', label: 'FIRE' } },
    },
    {
      title: 'PAC-MAN', color: '#ffe14d', hiKey: 'pacman',
      make: (a) => new PacmanGame(a),
      keys: ['ARROW KEYS     STEER PAC-MAN',
             'P              PAUSE'],
      blurb: 'Clear every dot. Power pellets turn the ghosts blue — then bite back.',
      touch: { dpad: 'full' },
    },
    {
      title: 'TETRIS', color: '#00e6e6', hiKey: 'tetris',
      make: (a) => new TetrisGame(a),
      keys: ['LEFT / RIGHT   MOVE PIECE',
             'UP or X        ROTATE  (Z = REVERSE)',
             'DOWN           SOFT DROP',
             'SPACE          HARD DROP',
             'P              PAUSE'],
      blurb: 'Stack the falling pieces and clear lines. Every 10 lines it speeds up.',
      touch: { dpad: 'full', a: { code: 'Space', label: 'DROP' }, b: { code: 'KeyZ', label: 'SPIN' } },
    },
    {
      title: 'CHESS', color: '#f2e2b8', hiKey: 'chess', hiLabel: 'WINS', pad: false,
      make: (a) => new ChessGame(a),
      keys: ['CLICK OR ARROWS + ENTER    MOVE',
             'DRAG ROTATE · SCROLL ZOOM  3D VIEW',
             'U UNDO · P PAUSE · L LEVEL',
             'N NEW GAME (SIDES ALTERNATE)',
             'V RESET VIEW · C OPPONENT'],
      blurb: 'Face Super-Viktor or Elasti-Vera — they stretch out and move the pieces by hand.',
      touch: { ok: { code: 'KeyN', label: 'NEW' } },
    },
    {
      title: 'NEBULUS', color: '#7cfc6a', hiKey: 'nebulus',
      make: (a) => new NebulusGame(a),
      keys: ['LEFT / RIGHT   WALK (THE TOWER TURNS!)',
             'SPACE or UP    JUMP',
             'WALK INTO DOORS & LIFTS TO USE THEM',
             'Z or X         SHOOT',
             'P              PAUSE'],
      blurb: 'Climb from the sea to the sky — then go fishing between towers!',
      touch: { dpad: 'full', a: { code: 'Space', label: 'JUMP' }, b: { code: 'KeyZ', label: 'SHOOT' } },
    },
    {
      title: 'MR EE', color: '#ff77aa', hiKey: 'mree',
      make: (a) => new MrEeGame(a),
      keys: ['ARROW KEYS     DIG & WALK',
             'SPACE          THROW POWER BALL',
             'PUSH APPLES ONTO THE CREEPS',
             'P              PAUSE'],
      blurb: 'Eat every cherry in the garden — or squash all the creeps. 8-in-a-row = bonus!',
      touch: { dpad: 'full', a: { code: 'Space', label: 'BALL' } },
    },
  ];

  const CRAB = [
    '..X.....X..', '...X...X...', '..XXXXXXX..', '.XX.XXX.XX.',
    'XXXXXXXXXXX', 'X.XXXXXXX.X', 'X.X.....X.X', '...XX.XX...'];

  let current = null;      // active game instance, or null when on the menu
  let sel = 0;
  let menuT = 0;
  let toast = null;
  let his = GAMES.map(g => loadHi(g.hiKey));

  const stars = [];
  for (let i = 0; i < 90; i++) {
    stars.push({ x: Math.random() * 672, y: Math.random() * 768, s: Math.random() * 1.6 + 0.6, p: Math.random() * 6.28 });
  }

  const api = { canvas, ctx };

  // Scale the canvas (preserving aspect) to fill most of the window.
  function fitCanvas() {
    const touchPad = (typeof ArcadeTouch !== 'undefined' && ArcadeTouch.active) ? 190 : 0;
    const aw = window.innerWidth * 0.97;
    const ah = (window.innerHeight - touchPad) * (touchPad ? 0.99 : 0.92);
    const r = canvas.width / canvas.height;
    let h = ah, w = ah * r;
    if (w > aw) { w = aw; h = aw / r; }
    canvas.style.width = Math.round(w) + 'px';
    canvas.style.height = Math.round(h) + 'px';
  }
  window.addEventListener('resize', fitCanvas);

  const MENU_TOUCH = { dpad: 'ud', a: { code: 'Enter', label: 'PLAY' } };

  function showMenu() {
    if (current && current.dispose) current.dispose();
    current = null;
    canvas.width = 672;
    canvas.height = 768;
    his = GAMES.map(g => loadHi(g.hiKey));
    if (typeof ArcadeTouch !== 'undefined') ArcadeTouch.configure(MENU_TOUCH);
    fitCanvas();
  }

  function blip() {
    Sfx.tone({ f: 500, f1: 720, type: 'square', dur: 0.05, vol: 0.2 });
  }

  function startGame(i) {
    sel = i;
    Sfx.playSeq([['C5', 1], ['E5', 1], ['G5', 1], ['C6', 2]], 0.055, { vol: 0.3 });
    current = GAMES[i].make(api);
    if (typeof ArcadeTouch !== 'undefined') ArcadeTouch.configure(GAMES[i].touch || {});
    fitCanvas();
  }

  // One key router serves BOTH the physical keyboard and the touch overlay.
  function pressKey(code, down) {
    if (!down) {
      if (current) current.key({ code }, false);
      return;
    }
    Sfx.ac();   // first user gesture unlocks audio
    if (code === 'KeyM') {
      const m = Sfx.toggleMute();
      toast = { txt: m ? 'SOUND OFF' : 'SOUND ON', t: 1.4 };
      return;
    }
    if (code === 'Escape') {
      if (current) {
        showMenu();
        Sfx.tone({ f: 320, f1: 150, type: 'square', dur: 0.12, vol: 0.2 });
      }
      return;
    }
    if (current) { current.key({ code }, true); return; }
    if (code === 'ArrowUp') { sel = (sel + GAMES.length - 1) % GAMES.length; blip(); }
    else if (code === 'ArrowDown') { sel = (sel + 1) % GAMES.length; blip(); }
    else if (code === 'Enter' || code === 'Space') startGame(sel);
    else if (code === 'Digit1') startGame(0);
    else if (code === 'Digit2') startGame(1);
    else if (code === 'Digit3') startGame(2);
    else if (code === 'Digit4') startGame(3);
    else if (code === 'Digit5') startGame(4);
    else if (code === 'Digit6') startGame(5);
  }

  window.addEventListener('keydown', (e) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    if (e.repeat) return;   // games handle held keys themselves
    pressKey(e.code, true);
  });

  window.addEventListener('keyup', (e) => {
    pressKey(e.code, false);
  });

  // tap a menu entry to play it (phones have no Enter key)
  canvas.addEventListener('pointerdown', (e) => {
    if (current) return;                       // games handle their own input
    const r = canvas.getBoundingClientRect();
    const y = (e.clientY - r.top) * (768 / r.height);
    const x = (e.clientX - r.left) * (672 / r.width);
    if (x < 60 || x > 612) return;
    const i = Math.floor((y - 116) / 56);
    if (i >= 0 && i < GAMES.length && (y - 116) - i * 56 <= 50) {
      Sfx.ac();
      startGame(i);
    }
  });

  if (typeof ArcadeTouch !== 'undefined') {
    ArcadeTouch.init(pressKey);
    ArcadeTouch.configure({ dpad: 'ud', a: { code: 'Enter', label: 'PLAY' } });
  }

  // auto-pause the running game when the window loses focus
  window.addEventListener('blur', () => {
    if (current && current.paused === false && current.state !== 'over') {
      current.key({ code: 'KeyP' }, true);
    }
  });

  function drawIcon(i, x, y) {
    if (i === 0) {
      drawPix(ctx, CRAB, x - 16, y - 12, 3, '#33ff44');
    } else if (i === 1) {
      ctx.fillStyle = '#ffe14d';
      ctx.beginPath();
      ctx.moveTo(x - 6, y);
      ctx.arc(x - 6, y, 14, 0.5, Math.PI * 2 - 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#ffb8ae';
      for (let d = 0; d < 3; d++) ctx.fillRect(x + 13 + d * 9, y - 1.5, 3, 3);
    } else if (i === 2) {
      const s = 12;
      ctx.fillStyle = '#bb44ee';
      ctx.fillRect(x - s * 1.5, y, s - 1, s - 1);
      ctx.fillRect(x - s * 0.5, y, s - 1, s - 1);
      ctx.fillRect(x + s * 0.5, y, s - 1, s - 1);
      ctx.fillRect(x - s * 0.5, y - s, s - 1, s - 1);
    } else if (i === 3) {
      drawPix(ctx, CH_PATTERNS.N, x - 12, y - 12, 2, '#f2e2b8');
    } else if (i === 5) {
      // the little clown among his cherries
      ctx.fillStyle = '#f4f4f8';
      ctx.beginPath();
      ctx.arc(x - 6, y + 3, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ff4455';
      ctx.beginPath();
      ctx.arc(x - 6, y - 6, 6, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = '#ffd24d';
      ctx.fillRect(x - 8, y - 14, 4, 4);
      ctx.fillStyle = '#102';
      ctx.fillRect(x - 10, y - 1, 2.5, 3);
      ctx.fillRect(x - 4, y - 1, 2.5, 3);
      ctx.fillStyle = '#ff4455';
      ctx.beginPath();
      ctx.arc(x - 6, y + 4, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ff2244';
      ctx.beginPath();
      ctx.arc(x + 10, y + 4, 4, 0, Math.PI * 2);
      ctx.arc(x + 17, y + 5, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#3faa3f';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + 10, y);
      ctx.quadraticCurveTo(x + 13, y - 7, x + 17, y + 1);
      ctx.stroke();
    } else {
      // Pogo on his tower
      ctx.fillStyle = '#b08040';
      ctx.fillRect(x - 8, y - 14, 16, 28);
      ctx.fillStyle = 'rgba(60,30,10,0.5)';
      for (let r = 0; r < 4; r++) ctx.fillRect(x - 8, y - 10 + r * 7, 16, 1);
      ctx.fillStyle = '#46d848';
      ctx.beginPath();
      ctx.arc(x, y - 18, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillRect(x - 3, y - 21, 3, 4);
      ctx.fillRect(x + 1, y - 21, 3, 4);
      ctx.fillStyle = '#123';
      ctx.fillRect(x - 2, y - 20, 1.5, 2);
      ctx.fillRect(x + 2, y - 20, 1.5, 2);
    }
  }

  function drawMenu(dt) {
    menuT += dt;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 672, 768);

    for (const s of stars) {
      const a = 0.25 + 0.65 * Math.abs(Math.sin(menuT * 1.3 + s.p));
      ctx.fillStyle = `rgba(200,210,255,${a.toFixed(3)})`;
      ctx.fillRect(s.x, s.y, s.s, s.s);
    }

    ctx.save();
    ctx.shadowColor = '#ff44cc';
    ctx.shadowBlur = 22;
    retroText(ctx, "'80s", 336, 10, 46, '#ff44cc', 'center');
    ctx.shadowColor = '#00e6e6';
    retroText(ctx, 'A R C A D E', 336, 62, 32, '#00e6e6', 'center');
    ctx.restore();
    retroText(ctx, '* INSERT COIN *', 336, 102, 12, '#556', 'center');

    // game entries
    for (let i = 0; i < GAMES.length; i++) {
      const g = GAMES[i];
      const y = 116 + i * 56;
      const on = i === sel;
      ctx.fillStyle = on ? '#0a0a1e' : '#050510';
      ctx.fillRect(86, y, 500, 50);
      ctx.lineWidth = on ? 3 : 1;
      ctx.strokeStyle = on ? g.color : '#223';
      if (on) { ctx.save(); ctx.shadowColor = g.color; ctx.shadowBlur = 14; }
      ctx.strokeRect(86, y, 500, 50);
      if (on) ctx.restore();
      drawIcon(i, 140, y + 25);
      retroText(ctx, g.title, 192, y + 11, 18, on ? g.color : '#99a');
      const v = his[i];
      const shown = g.pad === false ? String(v) : String(v).padStart(4, '0');
      retroText(ctx, (g.hiLabel || 'HI') + ' ' + shown, 566, y + 18, 12, '#667', 'right');
      if (on && Math.floor(menuT * 3) % 2 === 0) {
        retroText(ctx, '>', 102, y + 14, 20, g.color);
      }
    }

    // controls panel for the selected game
    const g = GAMES[sel];
    const py = 462;
    ctx.fillStyle = '#05050f';
    ctx.fillRect(86, py, 500, 200);
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#223';
    ctx.strokeRect(86, py, 500, 200);
    retroText(ctx, 'HOW TO PLAY — ' + g.title, 106, py + 9, 15, g.color);
    ctx.fillStyle = '#223';
    ctx.fillRect(106, py + 30, 460, 1);
    g.keys.forEach((line, i) => {
      retroText(ctx, line, 106, py + 39 + i * 20, 13, '#aab');
    });
    retroText(ctx, g.blurb, 106, py + 39 + g.keys.length * 20 + 5, 12, '#667');
    retroText(ctx, 'ESC = BACK TO MENU   ·   M = MUTE', 106, py + 180, 12, '#556');

    if (Math.floor(menuT * 1.6) % 2 === 0) {
      retroText(ctx, 'UP/DOWN CHOOSE — ENTER TO PLAY — OR PRESS 1-6', 336, 690, 15, '#ffe14d', 'center');
    }
  }

  function drawToast() {
    if (!toast) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(canvas.width / 2 - 90, 8, 180, 30);
    retroText(ctx, toast.txt, canvas.width / 2, 15, 15, '#ffe14d', 'center');
  }

  // ?game=invaders|pacman|tetris|chess jumps straight into a game (handy for testing)
  if (typeof location !== 'undefined' && location.search) {
    const want = new URLSearchParams(location.search).get('game');
    const idx = GAMES.findIndex(g => g.hiKey === want);
    if (idx >= 0) startGame(idx);
  }
  fitCanvas();

  // ?still=N stops the loop after N frames (used for automated screenshots)
  const stillMatch = typeof location !== 'undefined' && location.search.match(/[?&]still=(\d+)/);
  const STILL = !!stillMatch;
  const STILL_FRAMES = STILL ? Math.max(6, Number(stillMatch[1])) : 0;
  let frameCount = 0;
  let last = performance.now();
  function frame(t) {
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    if (toast) { toast.t -= dt; if (toast.t <= 0) toast = null; }
    if (current) {
      current.update(dt);
      current.draw();
    } else {
      drawMenu(dt);
    }
    drawToast();
    if (!STILL || ++frameCount < STILL_FRAMES) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
