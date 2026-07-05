/* chess.js — Chess vs the computer, rendered as a real 3D scene.
   Turned Staunton pieces with smooth per-vertex shading, specular highlights
   and directional shadows cast from a lamp that is fixed in the room — the
   light never moves when you rotate the board.
   Camera: drag to rotate, scroll to zoom, Q/E turn, R/F tilt, V reset.
   Pick White or Black (sides alternate each game), pause with P, undo with U.
   Engine: legal move generation (castling, en passant, promotion), negamax
   alpha-beta with quiescence, piece-square tables. Levels: EASY/NORMAL/HARD. */
'use strict';

const CH_DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const CH_ORTHO = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const CH_ALL8 = CH_DIAG.concat(CH_ORTHO);
const CH_KN = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const CH_VAL = [0, 100, 320, 330, 500, 900, 0];

// piece-square tables (white's view, row 0 = rank 8); black mirrors via idx^56
const CH_PST = {
  1: [0, 0, 0, 0, 0, 0, 0, 0,
      50, 50, 50, 50, 50, 50, 50, 50,
      10, 10, 20, 30, 30, 20, 10, 10,
      5, 5, 10, 25, 25, 10, 5, 5,
      0, 0, 0, 20, 20, 0, 0, 0,
      5, -5, -10, 0, 0, -10, -5, 5,
      5, 10, 10, -20, -20, 10, 10, 5,
      0, 0, 0, 0, 0, 0, 0, 0],
  2: [-50, -40, -30, -30, -30, -30, -40, -50,
      -40, -20, 0, 0, 0, 0, -20, -40,
      -30, 0, 10, 15, 15, 10, 0, -30,
      -30, 5, 15, 20, 20, 15, 5, -30,
      -30, 0, 15, 20, 20, 15, 0, -30,
      -30, 5, 10, 15, 15, 10, 5, -30,
      -40, -20, 0, 5, 5, 0, -20, -40,
      -50, -40, -30, -30, -30, -30, -40, -50],
  3: [-20, -10, -10, -10, -10, -10, -10, -20,
      -10, 0, 0, 0, 0, 0, 0, -10,
      -10, 0, 5, 10, 10, 5, 0, -10,
      -10, 5, 5, 10, 10, 5, 5, -10,
      -10, 0, 10, 10, 10, 10, 0, -10,
      -10, 10, 10, 10, 10, 10, 10, -10,
      -10, 5, 0, 0, 0, 0, 5, -10,
      -20, -10, -10, -10, -10, -10, -10, -20],
  4: [0, 0, 0, 0, 0, 0, 0, 0,
      5, 10, 10, 10, 10, 10, 10, 5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      0, 0, 0, 5, 5, 0, 0, 0],
  5: [-20, -10, -10, -5, -5, -10, -10, -20,
      -10, 0, 0, 0, 0, 0, 0, -10,
      -10, 0, 5, 5, 5, 5, 0, -10,
      -5, 0, 5, 5, 5, 5, 0, -5,
      0, 0, 5, 5, 5, 5, 0, -5,
      -10, 5, 5, 5, 5, 5, 0, -10,
      -10, 0, 5, 0, 0, 0, 0, -10,
      -20, -10, -10, -5, -5, -10, -10, -20],
  6: [-30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -20, -30, -30, -40, -40, -30, -30, -20,
      -10, -20, -20, -20, -20, -20, -20, -10,
      20, 20, 0, 0, 0, 0, 20, 20,
      20, 30, 10, 0, 0, 10, 30, 20],
};

// small pixel knight kept for the arcade menu icon
const CH_PATTERNS = {
  N: ['............', '....XXX.....', '...XXXXX....', '..XXXXXXX...',
      '.XXX.XXXXX..', '.XX..XXXXX..', '......XXXX..', '.....XXXX...',
      '....XXXXX...', '...XXXXXXX..', '..XXXXXXXXX.', '............'],
};

/* ================= tiny 3D toolkit ================= */

// lamp fixed in the ROOM (world space) — rotating the board never moves it
const CH_LIGHT = (() => {
  const l = [-0.38, 1.05, 0.40];
  const n = Math.hypot(l[0], l[1], l[2]);
  return [l[0] / n, l[1] / n, l[2] / n];
})();

const CH_MAT = {
  w: { base: [236, 226, 204], amb: 0.36, diff: 0.64, spec: 0.50, pow: 26 },
  b: { base: [74, 66, 62], amb: 0.30, diff: 0.55, spec: 0.85, pow: 34 },
};

function chShade(rgb, n, minK, maxK) {
  const d = Math.max(0, n[0] * CH_LIGHT[0] + n[1] * CH_LIGHT[1] + n[2] * CH_LIGHT[2]);
  const k = minK + (maxK - minK) * d;
  const r = Math.min(255, Math.round(rgb[0] * k));
  const g = Math.min(255, Math.round(rgb[1] * k));
  const b = Math.min(255, Math.round(rgb[2] * k));
  return `rgb(${r},${g},${b})`;
}

// Catmull-Rom subdivision of a lathe profile → smooth silhouettes
function chRefine(pts) {
  const cr = (a, b, c, d, t) => {
    const t2 = t * t, t3 = t2 * t;
    return 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  };
  const out = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (const t of [1 / 3, 2 / 3]) {
      out.push([Math.max(0, cr(p0[0], p1[0], p2[0], p3[0], t)), cr(p0[1], p1[1], p2[1], p3[1], t)]);
    }
    out.push(p2);
  }
  return out;
}

// surface of revolution;每 face carries face normal + the two edge normals
function chLathe(profile, seg) {
  const faces = [];
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    const am = (a0 + a1) / 2;
    const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
    const cm = Math.cos(am), sm = Math.sin(am);
    for (let j = 0; j < profile.length - 1; j++) {
      const [r0, y0] = profile[j], [r1, y1] = profile[j + 1];
      if (r0 < 1e-4 && r1 < 1e-4) continue;
      const dy = y1 - y0, dr = r1 - r0;
      let pr = dy, py = -dr;                    // profile normal (radial, y)
      if (Math.abs(dy) < 1e-6) { pr = 0; py = dr > 0 ? -1 : 1; }
      const pl = Math.hypot(pr, py) || 1;
      pr /= pl; py /= pl;
      if (py < -0.62) continue;                 // undersides are never seen
      faces.push({
        pts: [[r0 * c0, y0, r0 * s0], [r0 * c1, y0, r0 * s1], [r1 * c1, y1, r1 * s1], [r1 * c0, y1, r1 * s0]],
        n: [pr * cm, py, pr * sm],
        n0: [pr * c0, py, pr * s0],
        n1: [pr * c1, py, pr * s1],
      });
    }
  }
  return faces;
}

function chNormalFromWinding(pts, centroid) {
  const [a, b, c] = pts;
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const ln = Math.hypot(n[0], n[1], n[2]) || 1;
  n = [n[0] / ln, n[1] / ln, n[2] / ln];
  if (centroid) {
    const fc = pts.reduce((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0]).map(v2 => v2 / pts.length);
    const out = [fc[0] - centroid[0], fc[1] - centroid[1], fc[2] - centroid[2]];
    if (n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0) n = [-n[0], -n[1], -n[2]];
  }
  return n;
}

function chBox(cx, cy, cz, sx, sy, sz) {
  const x0 = cx - sx / 2, x1 = cx + sx / 2;
  const y0 = cy - sy / 2, y1 = cy + sy / 2;
  const z0 = cz - sz / 2, z1 = cz + sz / 2;
  const quads = [
    [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]],
    [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]],
    [[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]],
    [[x1, y0, z1], [x0, y0, z1], [x0, y1, z1], [x1, y1, z1]],
    [[x0, y0, z1], [x0, y0, z0], [x0, y1, z0], [x0, y1, z1]],
  ];
  const c = [cx, cy, cz];
  return quads.map(pts => {
    const n = chNormalFromWinding(pts, c);
    return { pts, n, n0: n, n1: n };
  });
}

// closed polygon in the (x, y) plane extruded along z
function chExtrude(poly, halfT, mirrorX) {
  const sgn = mirrorX ? -1 : 1;
  const p = poly.map(([x, y]) => [x * sgn, y]);
  const faces = [];
  const cx = p.reduce((s, q) => s + q[0], 0) / p.length;
  const cy = p.reduce((s, q) => s + q[1], 0) / p.length;
  const centroid = [cx, cy, 0];
  const mk = (pts, n) => ({ pts, n, n0: n, n1: n });
  faces.push(mk(p.map(([x, y]) => [x, y, halfT]), [0, 0, 1]));
  faces.push(mk(p.map(([x, y]) => [x, y, -halfT]).reverse(), [0, 0, -1]));
  for (let i = 0; i < p.length; i++) {
    const [x0, y0] = p[i], [x1, y1] = p[(i + 1) % p.length];
    const pts = [[x0, y0, halfT], [x1, y1, halfT], [x1, y1, -halfT], [x0, y0, -halfT]];
    faces.push(mk(pts, chNormalFromWinding(pts, centroid)));
  }
  return faces;
}

const CH_SEG = 40;

// traditional Staunton silhouettes: stepped base, waisted stem, collar, head
const CH_PROFILES = {
  P: [[0, 0], [.32, 0], [.32, .05], [.26, .10], [.17, .15], [.13, .38], [.11, .48],
      [.20, .54], [.20, .57], [.11, .61], [.19, .72], [.20, .80], [.13, .91], [0, .97]],
  R: [[0, 0], [.34, 0], [.34, .06], [.28, .11], [.21, .17], [.19, .60], [.26, .66],
      [.28, .70], [.28, .92], [.20, .92], [.20, .86], [0, .86]],
  B: [[0, 0], [.33, 0], [.33, .05], [.27, .10], [.17, .16], [.12, .44], [.10, .54],
      [.19, .60], [.19, .63], [.10, .67], [.16, .80], [.17, .92], [.12, 1.06],
      [.06, 1.16], [.10, 1.22], [.06, 1.29], [0, 1.32]],
  Q: [[0, 0], [.36, 0], [.36, .05], [.30, .10], [.19, .16], [.13, .50], [.11, .66],
      [.21, .72], [.21, .75], [.11, .79], [.14, 1.00], [.17, 1.16], [.20, 1.28],
      [.28, 1.40], [.15, 1.35], [.11, 1.40], [.16, 1.48], [.10, 1.56], [0, 1.60]],
  K: [[0, 0], [.37, 0], [.37, .05], [.31, .10], [.20, .16], [.14, .52], [.12, .72],
      [.23, .78], [.23, .81], [.12, .85], [.15, 1.10], [.18, 1.26], [.25, 1.40],
      [.13, 1.36], [.09, 1.42], [0, 1.46]],
  NBASE: [[0, 0], [.35, 0], [.35, .05], [.29, .10], [.20, .16], [.18, .42], [.26, .50], [0, .50]],
};

// horse-head profile in the (x,y) plane — muzzle to the left, seen side-on
const CH_KNIGHT_HEAD = [
  [.16, .48], [.22, .72], [.19, .96], [.10, 1.20], [.02, 1.06], [-.05, 1.16],
  [-.15, 1.05], [-.31, .95], [-.34, .84], [-.29, .78], [-.12, .76], [-.16, .62], [-.05, .48],
];

// coarse outlines used to cast the directional shadows
const CH_SHADOW_SIL = {
  P: [[.32, 0], [.13, .38], [.20, .56], [.19, .74], [0, .95]],
  R: [[.34, 0], [.20, .30], [.19, .60], [.28, .80], [0, 1.02]],
  B: [[.33, 0], [.12, .44], [.19, .61], [.16, .90], [0, 1.31]],
  Q: [[.36, 0], [.13, .50], [.21, .73], [.17, 1.16], [.24, 1.38], [0, 1.58]],
  K: [[.37, 0], [.14, .52], [.23, .79], [.18, 1.26], [.22, 1.42], [0, 1.66]],
  N: [[.35, 0], [.20, .30], [.22, .70], [.30, .92], [.15, 1.10], [0, 1.22]],
};

const CH_PIECE_H = { P: 0.97, N: 1.22, B: 1.32, R: 1.02, Q: 1.60, K: 1.66 };

// the opponents who sit across the table — comic-strip superheroes
const CH_CHARS = {
  viktor: {
    name: 'SUPER-VIKTOR', hairStyle: 'short', curl: true,
    skin: [228, 186, 158], suit: [48, 84, 182], hair: [26, 24, 26],
    lip: [150, 95, 85], iris: [70, 95, 150],
    cape: [172, 36, 36], belt: [230, 188, 62], emblem: 'diamond',
    wine: [128, 20, 38], thirst: { min: 15, rand: 14 },     // a red, in moderation
    torso: [[.62, .25], [.70, .62], [.62, 1.05], [.57, 1.35], [.68, 1.72],
            [.80, 1.94], [.76, 2.08], [.24, 2.10], [.20, 2.34]],
  },
  vera: {
    name: 'ELASTI-VERA', hairStyle: 'bob', cheeks: true,
    skin: [240, 202, 178], suit: [204, 52, 46], hair: [150, 75, 38],
    lip: [200, 60, 72], iris: [64, 112, 84],
    gloves: [32, 30, 34], mask: [36, 32, 38], belt: [32, 30, 34], emblem: 'circle',
    wine: [230, 198, 122], thirst: { min: 5, rand: 6 },     // white wine, frequently
    torso: [[.60, .25], [.66, .60], [.50, 1.05], [.48, 1.30], [.62, 1.62],
            [.70, 1.90], [.66, 2.04], [.20, 2.08], [.17, 2.32]],
  },
};

/* ==================================================== */

class ChessGame {
  constructor(api) {
    this.api = api;
    this.canvas = api.canvas;
    this.RS = 2;
    api.canvas.width = 672 * this.RS;
    api.canvas.height = 768 * this.RS;
    api.canvas.style.imageRendering = 'auto';
    try {
      const fr = document.getElementById('frame');
      if (fr && fr.classList) fr.classList.add('no-scan');
    } catch (e) {}
    this.ctx = api.ctx;
    this.levelIdx = 1;
    this.wins = loadHi('chess');
    this.animT = 0;
    this.dead = false;
    this.paused = false;
    this.thinkTimer = null;
    this.anims = [];
    this.hand = null;
    this.handQueue = [];
    this.leanAmt = 0;
    this.blinkT = 0;
    let ck = '';
    try { ck = localStorage.getItem('arcade.chess.char') || ''; } catch (e) {}
    this.charKey = (ck === 'vera' || ck === 'viktor') ? ck : (Math.random() < 0.5 ? 'viktor' : 'vera');

    this.buildMeshes();
    this.buildBoardFaces();
    this.impostors = {};
    this.impKey = null;
    this.sprites = {};
    for (const k of 'PNBRQK') {
      this.sprites['w' + k] = this.makeThumb(k, 1);
      this.sprites['b' + k] = this.makeThumb(k, -1);
    }

    let prev = 0;
    try { prev = Number(localStorage.getItem('arcade.chess.side')) || 0; } catch (e) {}
    this.pickSide = prev === 0 ? 1 : -prev;
    this.playerSide = this.pickSide;

    this.cam = { yaw: this.homeYaw(), pitch: 0.94, radius: 11.6, targetYaw: this.homeYaw() };

    this.pos = {
      board: ChessGame.startBoard(),
      turn: 1,
      castle: { wk: true, wq: true, bk: true, bq: true },
      ep: -1,
    };
    this.cursor = 52;
    this.sel = -1;
    this.selMoves = [];
    this.lastMove = null;
    this.history = [];
    this.capsByWhite = [];
    this.capsByBlack = [];
    this.state = 'pick';
    this.status = 'CHOOSE YOUR SIDE';
    this.result = null;
    this.tilePolys = [];

    this.mouse = { down: false, drag: false, x: 0, y: 0 };
    this.onDown = (ev) => this.mouseDown(ev);
    this.onMove = (ev) => this.mouseMove(ev);
    this.onUp = (ev) => this.mouseUp(ev);
    this.onWheel = (ev) => { ev.preventDefault(); this.zoom(ev.deltaY * 0.012); };
    api.canvas.addEventListener('mousedown', this.onDown);
    window.addEventListener('mousemove', this.onMove);
    window.addEventListener('mouseup', this.onUp);
    api.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.onTS = (ev) => this.touchStart(ev);
    this.onTM = (ev) => this.touchMove(ev);
    this.onTE = (ev) => this.touchEnd(ev);
    api.canvas.addEventListener('touchstart', this.onTS, { passive: false });
    api.canvas.addEventListener('touchmove', this.onTM, { passive: false });
    api.canvas.addEventListener('touchend', this.onTE, { passive: false });
    api.canvas.addEventListener('touchcancel', this.onTE, { passive: false });
    try { api.canvas.style.cursor = 'grab'; } catch (e) {}

    if (typeof location !== 'undefined' && location.search) {
      const q = new URLSearchParams(location.search);
      const s = q.get('side');
      if (s === 'w') this.beginGame(1);
      else if (s === 'b') this.beginGame(-1);
      if (q.get('yaw')) { this.cam.yaw = this.cam.targetYaw = Number(q.get('yaw')) * Math.PI / 180; }
      if (q.get('pitch')) this.cam.pitch = Number(q.get('pitch')) * Math.PI / 180;
      const ch = q.get('char');
      if (ch === 'vera' || ch === 'viktor') this.charKey = ch;
      if (q.get('dist')) this.cam.radius = Math.max(7.5, Math.min(19, Number(q.get('dist'))));
      if (q.get('drunk')) this.sipCount = Number(q.get('drunk'));
      const dbgPose = q.get('pose');
      if (dbgPose === 'joy' || dbgPose === 'shame' || dbgPose === 'stretch') this.pose = { type: dbgPose, t: 0 };
    }
  }

  homeYaw() { return this.playerSide === 1 ? 0 : Math.PI; }

  /* ---------- meshes ---------- */

  buildMeshes() {
    this.meshes = {};
    this.meshes.P = chLathe(chRefine(CH_PROFILES.P), CH_SEG);
    this.meshes.B = chLathe(chRefine(CH_PROFILES.B), CH_SEG);
    this.meshes.Q = chLathe(chRefine(CH_PROFILES.Q), CH_SEG);

    let king = chLathe(chRefine(CH_PROFILES.K), CH_SEG);
    king = king.concat(chBox(0, 1.56, 0, .08, .26, .08), chBox(0, 1.60, 0, .24, .08, .08));
    this.meshes.K = king;

    let rook = chLathe(chRefine(CH_PROFILES.R), CH_SEG);
    for (const [bx, bz] of [[.20, 0], [-.20, 0], [0, .20], [0, -.20]]) {
      rook = rook.concat(chBox(bx, .99, bz, .15, .14, .15));
    }
    this.meshes.R = rook;

    const rotY = (faces, a) => {
      const c = Math.cos(a), s = Math.sin(a);
      const rp = ([x, y, z]) => [x * c + z * s, y, -x * s + z * c];
      const rn = (n) => [n[0] * c + n[2] * s, n[1], -n[0] * s + n[2] * c];
      return faces.map(f => ({ pts: f.pts.map(rp), n: rn(f.n), n0: rn(f.n0), n1: rn(f.n1) }));
    };
    const nBase = chLathe(chRefine(CH_PROFILES.NBASE), CH_SEG);
    this.meshes.N = nBase.concat(rotY(chExtrude(CH_KNIGHT_HEAD, .13, false), 0.5));
    this.meshes.Nb = nBase.concat(rotY(chExtrude(CH_KNIGHT_HEAD, .13, true), -0.5));

    // the opponent's wine glass (wine band + surface marked as wine)
    const gp = [[0, 0], [.20, 0], [.21, .02], [.07, .05], [.05, .32], [.10, .35],
                [.21, .43], [.235, .55], [.215, .70]];
    this.glassRaw = chLathe(gp, 16).map(f => {
      const avgY = f.pts.reduce((s, p) => s + p[1], 0) / f.pts.length;
      return { pts: f.pts, n: f.n, n0: f.n0, n1: f.n1, wine: avgY > 0.36 && avgY < 0.56 };
    });
    const surf = [];
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      surf.push([Math.cos(a) * .20, .56, Math.sin(a) * .20]);
    }
    this.glassRaw.push({ pts: surf, n: [0, 1, 0], wine: true });
  }

  buildBoardFaces() {
    const LIGHT = [228, 208, 166], DARK = [150, 105, 68], WOOD = [114, 80, 46], WOODD = [76, 52, 30];
    let seed = 987654321;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    this.boardFaces = [];
    this.tileCorners = [];
    // tiles get a subtle gradient running along the lamp direction
    const gdir = (() => {
      const h = Math.hypot(CH_LIGHT[0], CH_LIGHT[2]) || 1;
      return [CH_LIGHT[0] / h, CH_LIGHT[2] / h];
    })();
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const x0 = c - 4, z0 = r - 4;
        const pts = [[x0, 0, z0], [x0 + 1, 0, z0], [x0 + 1, 0, z0 + 1], [x0, 0, z0 + 1]];
        this.tileCorners.push(pts);
        const tone = 0.95 + rnd() * 0.09;   // per-square veneer variation
        const raw = (r + c) % 2 === 0 ? LIGHT : DARK;
        const base = [raw[0] * tone, raw[1] * tone, raw[2] * tone];
        this.boardFaces.push({
          pts,
          col: chShade(base, [0, 1, 0], 0.42, 0.98),
          grad: {
            a: [x0 + 0.5 + gdir[0] * 0.5, 0, z0 + 0.5 + gdir[1] * 0.5],
            b: [x0 + 0.5 - gdir[0] * 0.5, 0, z0 + 0.5 - gdir[1] * 0.5],
            c0: chShade(base, [0, 1, 0], 0.46, 1.04),
            c1: chShade(base, [0, 1, 0], 0.38, 0.92),
          },
        });
        // wood grain: fine streaks running along the files
        for (let s = 0; s < 3; s++) {
          const gx = x0 + 0.08 + rnd() * 0.82;
          const wd = 0.012 + rnd() * 0.028;
          const za = z0 + rnd() * 0.3, zb = z0 + 1 - rnd() * 0.3;
          const wig = (rnd() - 0.5) * 0.06;
          const darkStreak = rnd() < 0.6;
          this.boardFaces.push({
            pts: [[gx, 0.003, za], [gx + wd, 0.003, za], [gx + wd + wig, 0.003, zb], [gx + wig, 0.003, zb]],
            col: darkStreak ? 'rgb(62,40,22)' : 'rgb(255,244,214)',
            alpha: darkStreak ? 0.05 + rnd() * 0.05 : 0.04 + rnd() * 0.04,
          });
        }
      }
    }
    // soft ambient-occlusion strip where the squares meet the frame
    for (const pts of [
      [[-4, 0.002, -4], [4, 0.002, -4], [4, 0.002, -3.87], [-4, 0.002, -3.87]],
      [[-4, 0.002, 3.87], [4, 0.002, 3.87], [4, 0.002, 4], [-4, 0.002, 4]],
      [[-4, 0.002, -4], [-3.87, 0.002, -4], [-3.87, 0.002, 4], [-4, 0.002, 4]],
      [[3.87, 0.002, -4], [4, 0.002, -4], [4, 0.002, 4], [3.87, 0.002, 4]],
    ]) {
      this.boardFaces.push({ pts, col: 'rgb(0,0,0)', alpha: 0.15 });
    }
    const R0 = 4, R1 = 4.62, TOP = 0.02, BOT = -0.06;
    const rimCol = chShade(WOOD, [0, 1, 0], 0.42, 1.0);
    const rim = [
      [[-R1, TOP, -R1], [R1, TOP, -R1], [R0, TOP, -R0], [-R0, TOP, -R0]],
      [[R1, TOP, -R1], [R1, TOP, R1], [R0, TOP, R0], [R0, TOP, -R0]],
      [[R1, TOP, R1], [-R1, TOP, R1], [-R0, TOP, R0], [R0, TOP, R0]],
      [[-R1, TOP, R1], [-R1, TOP, -R1], [-R0, TOP, -R0], [-R0, TOP, R0]],
    ];
    for (const pts of rim) this.boardFaces.push({ pts, col: rimCol });
    // grain on the frame, running around the rim
    for (let s = 0; s < 10; s++) {
      const t = 4.06 + rnd() * 0.48;
      const a0 = -4.4 + rnd() * 2, a1 = a0 + 1.5 + rnd() * 3;
      const wd = 0.015 + rnd() * 0.02;
      const darkStreak = rnd() < 0.65;
      const col = darkStreak ? 'rgb(50,32,16)' : 'rgb(240,210,170)';
      const alpha = 0.08 + rnd() * 0.06;
      this.boardFaces.push({ pts: [[a0, 0.023, -t - wd], [a1, 0.023, -t - wd], [a1, 0.023, -t], [a0, 0.023, -t]], col, alpha });
      this.boardFaces.push({ pts: [[a0, 0.023, t], [a1, 0.023, t], [a1, 0.023, t + wd], [a0, 0.023, t + wd]], col, alpha });
      this.boardFaces.push({ pts: [[-t - wd, 0.023, a0], [-t, 0.023, a0], [-t, 0.023, a1], [-t - wd, 0.023, a1]], col, alpha });
      this.boardFaces.push({ pts: [[t, 0.023, a0], [t + wd, 0.023, a0], [t + wd, 0.023, a1], [t, 0.023, a1]], col, alpha });
    }
    const walls = [
      { pts: [[-R1, BOT, -R1], [R1, BOT, -R1], [R1, TOP, -R1], [-R1, TOP, -R1]], n: [0, 0, -1] },
      { pts: [[R1, BOT, -R1], [R1, BOT, R1], [R1, TOP, R1], [R1, TOP, -R1]], n: [1, 0, 0] },
      { pts: [[R1, BOT, R1], [-R1, BOT, R1], [-R1, TOP, R1], [R1, TOP, R1]], n: [0, 0, 1] },
      { pts: [[-R1, BOT, R1], [-R1, BOT, -R1], [-R1, TOP, -R1], [-R1, TOP, R1]], n: [-1, 0, 0] },
    ];
    for (const w of walls) this.boardFaces.push({ pts: w.pts, col: chShade(WOODD, w.n, 0.35, 1.0) });
    // a round pedestal table, just big enough for board, trophies and a glass
    this.tableFaces = [];
    const T = -0.04, TABLE = [64, 44, 28], TR = 7.3, SEGC = 30;
    const tcol = chShade(TABLE, [0, 1, 0], 0.40, 0.95);
    for (let i = 0; i < SEGC; i++) {
      const a0 = (i / SEGC) * 2 * Math.PI, a1 = ((i + 1) / SEGC) * 2 * Math.PI;
      const x0 = Math.cos(a0) * TR, z0 = Math.sin(a0) * TR;
      const x1 = Math.cos(a1) * TR, z1 = Math.sin(a1) * TR;
      this.tableFaces.push({
        pts: [[0, T, 0], [x0, T, z0], [x1, T, z1]],
        col: tcol, zbias: 0.15,
      });
      const nrm = [Math.cos((a0 + a1) / 2), 0, Math.sin((a0 + a1) / 2)];
      this.tableFaces.push({
        pts: [[x0, T, z0], [x1, T, z1], [x1, T - 0.26, z1], [x0, T - 0.26, z0]],
        col: chShade([92, 62, 38], nrm, 0.35, 1.0),
        zbias: 0.5,
      });
    }
    // grain chords + plank seams across the round top
    for (let s = 0; s < 20; s++) {
      const zc = -TR + rnd() * 2 * TR;
      const half = Math.sqrt(Math.max(0, TR * TR - zc * zc)) * 0.95;
      if (half < 0.6) continue;
      const wd = 0.02 + rnd() * 0.03;
      const darkStreak = rnd() < 0.6;
      this.tableFaces.push({
        pts: [[-half, T + 0.002, zc], [half, T + 0.002, zc], [half, T + 0.002, zc + wd], [-half, T + 0.002, zc + wd]],
        col: darkStreak ? "rgb(38,24,12)" : "rgb(160,120,80)",
        alpha: 0.10 + rnd() * 0.08, zbias: 0.12,
      });
    }
    for (let z = -6.5; z <= 6.6; z += 1.3) {
      const half = Math.sqrt(Math.max(0, TR * TR - z * z)) * 0.985;
      if (half < 0.5) continue;
      this.tableFaces.push({
        pts: [[-half, T + 0.001, z], [half, T + 0.001, z], [half, T + 0.001, z + 0.018], [-half, T + 0.001, z + 0.018]],
        col: "rgb(20,13,8)", alpha: 0.32, zbias: 0.12,
      });
    }
    // turned central pedestal with a round foot
    const pedProf = [[0, -3.54], [1.60, -3.54], [1.48, -3.40], [.55, -3.30], [.42, -2.55],
                     [.38, -1.45], [.46, -.60], [.56, -.24], [.64, -.05]];
    for (const f of chLathe(pedProf, 16)) {
      this.tableFaces.push({
        pts: f.pts,
        col: chShade([150, 108, 66], f.n, 0.40, 1.02),
        zbias: 1.1,
      });
    }
    // the floor, far below
    this.floorFaces = [{
      pts: [[-18, -3.56, -18], [18, -3.56, -18], [18, -3.56, 18], [-18, -3.56, 18]],
      col: "rgb(44,36,30)",
      grad: {
        a: [0, -3.56, 0], b: [17, -3.56, 17],
        c0: "rgb(96,78,60)", c1: "rgb(18,15,13)",
      },
    }];
  }

  /* ---------- camera + projection ---------- */

  camBasis(cam, target) {
    const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    const sy = Math.sin(cam.yaw), cy = Math.cos(cam.yaw);
    const eye = [target[0] + cam.radius * cp * sy, target[1] + cam.radius * sp, target[2] + cam.radius * cp * cy];
    let f = [target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]];
    const fl = Math.hypot(f[0], f[1], f[2]);
    f = [f[0] / fl, f[1] / fl, f[2] / fl];
    let rgt = [-f[2], 0, f[0]];
    const rl = Math.hypot(rgt[0], rgt[1], rgt[2]) || 1;
    rgt = [rgt[0] / rl, rgt[1] / rl, rgt[2] / rl];
    const up = [
      rgt[1] * f[2] - rgt[2] * f[1],
      rgt[2] * f[0] - rgt[0] * f[2],
      rgt[0] * f[1] - rgt[1] * f[0],
    ];
    return { eye, f, rgt, up };
  }

  projectPoint(p, basis, view) {
    const dx = p[0] - basis.eye[0], dy = p[1] - basis.eye[1], dz = p[2] - basis.eye[2];
    const z = dx * basis.f[0] + dy * basis.f[1] + dz * basis.f[2];
    const x = dx * basis.rgt[0] + dy * basis.rgt[1] + dz * basis.rgt[2];
    const y = dx * basis.up[0] + dy * basis.up[1] + dz * basis.up[2];
    return { x: view.cx + view.focal * x / z, y: view.cy - view.focal * y / z, z };
  }

  // flat-shaded world scene (board, highlights, shadows)
  renderFaces(ctx, faces, cam, view) {
    const basis = this.camBasis(cam, view.target);
    const out = [];
    for (const face of faces) {
      const pp = [];
      let zsum = 0, ok = true;
      for (const p of face.pts) {
        const pr = this.projectPoint(p, basis, view);
        if (pr.z < 0.3) { ok = false; break; }
        pp.push([pr.x, pr.y]);
        zsum += pr.z;
      }
      if (!ok) continue;
      out.push({ pp, z: zsum / face.pts.length + (face.zbias || 0), face });
    }
    out.sort((a, b) => b.z - a.z);
    for (const q of out) {
      const face = q.face;
      if (face.id != null) this.tilePolys[face.id] = q.pp;
      let minx = q.pp[0][0], maxx = minx, miny = q.pp[0][1], maxy = miny;
      for (let i = 1; i < q.pp.length; i++) {
        const [px, py] = q.pp[i];
        if (px < minx) minx = px; if (px > maxx) maxx = px;
        if (py < miny) miny = py; if (py > maxy) maxy = py;
      }
      if ((maxx - minx) * (maxy - miny) < 0.5) continue;
      ctx.beginPath();
      ctx.moveTo(q.pp[0][0], q.pp[0][1]);
      for (let i = 1; i < q.pp.length; i++) ctx.lineTo(q.pp[i][0], q.pp[i][1]);
      ctx.closePath();
      let fill = face.col;
      if (face.grad) {
        const a = this.projectPoint(face.grad.a, basis, view);
        const b = this.projectPoint(face.grad.b, basis, view);
        const g = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
        g.addColorStop(0, face.grad.c0);
        g.addColorStop(1, face.grad.c1);
        fill = g;
      }
      if (face.alpha != null) ctx.globalAlpha = face.alpha;
      ctx.fillStyle = fill;
      ctx.fill();
      if (face.alpha == null) {
        ctx.strokeStyle = fill;
        ctx.lineWidth = 0.7;
        ctx.stroke();
      } else {
        ctx.globalAlpha = 1;
      }
    }
  }

  /* ---------- piece impostors: high-quality cached renders ---------- */

  shadePhong(mat, n, Hv) {
    const d = Math.max(0, n[0] * CH_LIGHT[0] + n[1] * CH_LIGHT[1] + n[2] * CH_LIGHT[2]);
    const k = mat.amb + mat.diff * d;
    const s = Math.pow(Math.max(0, n[0] * Hv[0] + n[1] * Hv[1] + n[2] * Hv[2]), mat.pow) * mat.spec;
    const r = Math.min(255, Math.round(mat.base[0] * k + 255 * s));
    const g = Math.min(255, Math.round(mat.base[1] * k + 255 * s));
    const b = Math.min(255, Math.round(mat.base[2] * k + 255 * s));
    return `rgb(${r},${g},${b})`;
  }

  // render a piece mesh with smooth (per-edge gradient) Phong shading
  renderMeshLit(g, mesh, side, cam, view) {
    const basis = this.camBasis(cam, view.target);
    let V = [basis.eye[0] - view.target[0], basis.eye[1] - view.target[1], basis.eye[2] - view.target[2]];
    const vl = Math.hypot(V[0], V[1], V[2]) || 1;
    V = [V[0] / vl, V[1] / vl, V[2] / vl];
    let Hv = [V[0] + CH_LIGHT[0], V[1] + CH_LIGHT[1], V[2] + CH_LIGHT[2]];
    const hl = Math.hypot(Hv[0], Hv[1], Hv[2]) || 1;
    Hv = [Hv[0] / hl, Hv[1] / hl, Hv[2] / hl];
    const mat = side === 1 ? CH_MAT.w : CH_MAT.b;

    const out = [];
    for (const face of mesh) {
      const pp = [];
      let zsum = 0;
      for (const p of face.pts) {
        const pr = this.projectPoint(p, basis, view);
        pp.push([pr.x, pr.y]);
        zsum += pr.z;
      }
      out.push({ pp, z: zsum / face.pts.length, face });
    }
    out.sort((a, b) => b.z - a.z);
    for (const q of out) {
      const face = q.face;
      g.beginPath();
      g.moveTo(q.pp[0][0], q.pp[0][1]);
      for (let i = 1; i < q.pp.length; i++) g.lineTo(q.pp[i][0], q.pp[i][1]);
      g.closePath();
      let fill;
      if (face.n0 !== face.n1 && q.pp.length === 4) {
        // smooth shading across the segment: gradient between edge normals
        const m0x = (q.pp[0][0] + q.pp[3][0]) / 2, m0y = (q.pp[0][1] + q.pp[3][1]) / 2;
        const m1x = (q.pp[1][0] + q.pp[2][0]) / 2, m1y = (q.pp[1][1] + q.pp[2][1]) / 2;
        if (Math.hypot(m1x - m0x, m1y - m0y) > 2.5) {
          fill = g.createLinearGradient(m0x, m0y, m1x, m1y);
          fill.addColorStop(0, this.shadePhong(mat, face.n0, Hv));
          fill.addColorStop(1, this.shadePhong(mat, face.n1, Hv));
        } else {
          fill = this.shadePhong(mat, face.n, Hv);
        }
      } else {
        fill = this.shadePhong(mat, face.n, Hv);
      }
      g.fillStyle = fill;
      g.fill();
      g.strokeStyle = fill;
      g.lineWidth = 0.8;
      g.stroke();
    }
  }

  buildImpostor(kind, side) {
    const W = 260, H = 520;
    const cnv = document.createElement('canvas');
    cnv.width = W; cnv.height = H;
    const g = cnv.getContext('2d');
    const cam = { yaw: this.cam.yaw, pitch: this.cam.pitch, radius: this.cam.radius };
    const pxPerWorld = (H - 80) / 2.0;
    const focal = pxPerWorld * cam.radius;
    const view = { target: [0, 0.85, 0], cx: W / 2, cy: (H - 56) - pxPerWorld * 0.85, focal };
    const mesh = kind === 'N' ? (side === 1 ? this.meshes.N : this.meshes.Nb) : this.meshes[kind];
    this.renderMeshLit(g, mesh, side, cam, view);
    const basis = this.camBasis(cam, view.target);
    const b = this.projectPoint([0, 0, 0], basis, view);
    return { cnv, baseX: b.x, baseY: b.y, pxPerWorld: focal / b.z };
  }

  ensureImpostors() {
    const c = this.cam;
    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
    if (this.impKey) {
      const moved = Math.abs(c.yaw - this.impKey.yaw) > 0.02 ||
                    Math.abs(c.pitch - this.impKey.pitch) > 0.015 ||
                    Math.abs(c.radius - this.impKey.radius) > 0.3;
      if (!moved) return;
      const wait = this.mouse.drag ? 200 : 70;
      if (now - this.impKey.t < wait) return;
    }
    for (const k of 'PNBRQK') {
      this.impostors['w' + k] = this.buildImpostor(k, 1);
      this.impostors['b' + k] = this.buildImpostor(k, -1);
    }
    this.impKey = { yaw: c.yaw, pitch: c.pitch, radius: c.radius, t: now };
  }

  makeThumb(kind, side) {
    const cnv = document.createElement('canvas');
    cnv.width = 176; cnv.height = 176;
    const g = cnv.getContext('2d');
    g.fillStyle = 'rgba(0,0,0,0.28)';
    g.beginPath();
    g.ellipse(88, 152, 36, 9, 0, 0, Math.PI * 2);
    g.fill();
    const pxPerWorld = 64;
    const cam = { yaw: 0.55, pitch: 0.40, radius: 6 };
    const view = { target: [0, 0.75, 0], cx: 88, cy: 152 - pxPerWorld * 0.75, focal: pxPerWorld * 6 };
    const mesh = kind === 'N' ? (side === 1 ? this.meshes.N : this.meshes.Nb) : this.meshes[kind];
    this.renderMeshLit(g, mesh, side, cam, view);
    return cnv;
  }

  octagon(x, y, z, r) {
    const pts = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      pts.push([x + r * Math.cos(a), y, z + r * Math.sin(a)]);
    }
    return pts;
  }

  // directional shadow polygon: the piece outline projected along the lamp rays
  shadowPoly(sil, wx, wz, lift, inflate) {
    const ox = CH_LIGHT[0] / CH_LIGHT[1], oz = CH_LIGHT[2] / CH_LIGHT[1];
    let px = -oz, pz = ox;
    const pl = Math.hypot(px, pz) || 1;
    px /= pl; pz /= pl;
    const L = [], R = [];
    for (const [r0, y0] of sil) {
      const r = r0 * inflate + (inflate > 1 ? 0.02 : 0);
      const y = y0 + lift;
      const cx = wx - ox * y, cz = wz - oz * y;
      L.push([cx + px * r, 0.006, cz + pz * r]);
      R.push([cx - px * r, 0.006, cz - pz * r]);
    }
    return L.concat(R.reverse());
  }

  sqWorld(i) { return { x: (i & 7) - 3.5, z: (i >> 3) - 3.5 }; }

  /* ---------- setup ---------- */

  static startBoard() {
    const board = new Array(64).fill(0);
    const back = [4, 2, 3, 5, 6, 3, 2, 4];
    for (let c = 0; c < 8; c++) {
      board[c] = -back[c];
      board[8 + c] = -1;
      board[48 + c] = 1;
      board[56 + c] = back[c];
    }
    return board;
  }

  static fromFEN(fen) {
    const parts = fen.split(' ');
    const board = new Array(64).fill(0);
    const map = { p: 1, n: 2, b: 3, r: 4, q: 5, k: 6 };
    let i = 0;
    for (const ch of parts[0]) {
      if (ch === '/') continue;
      if (ch >= '1' && ch <= '8') { i += Number(ch); continue; }
      const lo = ch.toLowerCase();
      board[i++] = map[lo] * (ch === lo ? -1 : 1);
    }
    const cs = parts[2] || '-';
    const ep = parts[3] || '-';
    return {
      board,
      turn: parts[1] === 'b' ? -1 : 1,
      castle: { wk: cs.includes('K'), wq: cs.includes('Q'), bk: cs.includes('k'), bq: cs.includes('q') },
      ep: ep === '-' ? -1 : (8 - Number(ep[1])) * 8 + (ep.charCodeAt(0) - 97),
    };
  }

  beginGame(side) {
    if (this.thinkTimer) { clearTimeout(this.thinkTimer); this.thinkTimer = null; }
    this.playerSide = side;
    this.pickSide = side;
    try { localStorage.setItem('arcade.chess.side', String(side)); } catch (e) {}
    this.pos = {
      board: ChessGame.startBoard(),
      turn: 1,
      castle: { wk: true, wq: true, bk: true, bq: true },
      ep: -1,
    };
    this.cursor = side === 1 ? 52 : 12;
    this.sel = -1;
    this.selMoves = [];
    this.lastMove = null;
    this.history = [];
    this.capsByWhite = [];
    this.capsByBlack = [];
    this.result = null;
    this.paused = false;
    this.anims = [];
    this.hand = null;
    this.handQueue = [];
    this.leanAmt = 0;
    this.sip = null;
    this.sipCooldown = null;
    this.sipCount = 0;
    this.glassPos = null;
    this.glassTilt = 0;
    this.pose = null;
    this.stretchCooldown = null;
    this.hicT = null;
    this.hicPulse = 0;
    this.drunk = 0;
    this.bodyLift = 0;
    this.bodyRoll = 0;
    this.cpuScore = 0;
    this.cpuWorried = false;
    this.cam.targetYaw = this.homeYaw();
    if (side === -1) {
      this.state = 'thinking';
      this.status = 'CPU IS THINKING';
      this.thinkTimer = setTimeout(() => { if (!this.dead) this.cpuMove(); }, 450);
    } else {
      this.state = 'play';
      this.status = 'YOUR MOVE';
    }
  }

  /* ---------- engine: move generation ---------- */

  genMoves(pos) {
    const B = pos.board, t = pos.turn, ms = [];
    const push = (from, to, extra) => {
      const m = { from, to, capt: B[to] };
      if (extra) Object.assign(m, extra);
      ms.push(m);
    };
    for (let i = 0; i < 64; i++) {
      const p = B[i];
      if (!p || (p > 0) !== (t > 0)) continue;
      const a = p * t, r = i >> 3, c = i & 7;
      if (a === 1) {
        const dir = t === 1 ? -8 : 8;
        const one = i + dir;
        const promoRow = t === 1 ? 0 : 7;
        const startRow = t === 1 ? 6 : 1;
        if (one >= 0 && one < 64 && B[one] === 0) {
          if ((one >> 3) === promoRow) push(i, one, { promo: 5 });
          else {
            push(i, one);
            const two = i + 2 * dir;
            if (r === startRow && B[two] === 0) push(i, two, { flag: 'double' });
          }
        }
        for (const dc of [-1, 1]) {
          const nc = c + dc;
          if (nc < 0 || nc > 7) continue;
          const to = one + dc;
          if (to < 0 || to > 63) continue;
          if (B[to] !== 0 && (B[to] > 0) !== (t > 0)) {
            if ((to >> 3) === promoRow) push(i, to, { promo: 5 });
            else push(i, to);
          } else if (to === pos.ep && B[to] === 0) {
            ms.push({ from: i, to, capt: -t, flag: 'ep' });
          }
        }
      } else if (a === 2 || a === 6) {
        const offs = a === 2 ? CH_KN : CH_ALL8;
        for (const [dr, dc] of offs) {
          const nr = r + dr, nc = c + dc;
          if (nr < 0 || nr > 7 || nc < 0 || nc > 7) continue;
          const to = nr * 8 + nc;
          if (B[to] === 0 || (B[to] > 0) !== (t > 0)) push(i, to);
        }
      } else {
        const dirs = a === 3 ? CH_DIAG : a === 4 ? CH_ORTHO : CH_ALL8;
        for (const [dr, dc] of dirs) {
          let nr = r + dr, nc = c + dc;
          while (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
            const to = nr * 8 + nc;
            if (B[to] === 0) push(i, to);
            else {
              if ((B[to] > 0) !== (t > 0)) push(i, to);
              break;
            }
            nr += dr; nc += dc;
          }
        }
      }
    }
    if (t === 1) {
      if (pos.castle.wk && B[60] === 6 && B[61] === 0 && B[62] === 0 && B[63] === 4 &&
          !this.isAttacked(B, 60, -1) && !this.isAttacked(B, 61, -1) && !this.isAttacked(B, 62, -1)) {
        ms.push({ from: 60, to: 62, capt: 0, flag: 'ck' });
      }
      if (pos.castle.wq && B[60] === 6 && B[59] === 0 && B[58] === 0 && B[57] === 0 && B[56] === 4 &&
          !this.isAttacked(B, 60, -1) && !this.isAttacked(B, 59, -1) && !this.isAttacked(B, 58, -1)) {
        ms.push({ from: 60, to: 58, capt: 0, flag: 'cq' });
      }
    } else {
      if (pos.castle.bk && B[4] === -6 && B[5] === 0 && B[6] === 0 && B[7] === -4 &&
          !this.isAttacked(B, 4, 1) && !this.isAttacked(B, 5, 1) && !this.isAttacked(B, 6, 1)) {
        ms.push({ from: 4, to: 6, capt: 0, flag: 'ck' });
      }
      if (pos.castle.bq && B[4] === -6 && B[3] === 0 && B[2] === 0 && B[1] === 0 && B[0] === -4 &&
          !this.isAttacked(B, 4, 1) && !this.isAttacked(B, 3, 1) && !this.isAttacked(B, 2, 1)) {
        ms.push({ from: 4, to: 2, capt: 0, flag: 'cq' });
      }
    }
    return ms;
  }

  isAttacked(B, sq, by) {
    const r = sq >> 3, c = sq & 7;
    const pr = by === 1 ? r + 1 : r - 1;
    if (pr >= 0 && pr < 8) {
      for (const dc of [-1, 1]) {
        const nc = c + dc;
        if (nc >= 0 && nc < 8 && B[pr * 8 + nc] === by) return true;
      }
    }
    for (const [dr, dc] of CH_KN) {
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && B[nr * 8 + nc] === 2 * by) return true;
    }
    for (const [dr, dc] of CH_ALL8) {
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && B[nr * 8 + nc] === 6 * by) return true;
    }
    for (const [dr, dc] of CH_ORTHO) {
      let nr = r + dr, nc = c + dc;
      while (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
        const v = B[nr * 8 + nc];
        if (v !== 0) {
          if (v === 4 * by || v === 5 * by) return true;
          break;
        }
        nr += dr; nc += dc;
      }
    }
    for (const [dr, dc] of CH_DIAG) {
      let nr = r + dr, nc = c + dc;
      while (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
        const v = B[nr * 8 + nc];
        if (v !== 0) {
          if (v === 3 * by || v === 5 * by) return true;
          break;
        }
        nr += dr; nc += dc;
      }
    }
    return false;
  }

  kingSq(B, side) {
    const k = 6 * side;
    for (let i = 0; i < 64; i++) if (B[i] === k) return i;
    return -1;
  }

  kingChecked(pos, side) {
    const k = this.kingSq(pos.board, side);
    return k < 0 ? true : this.isAttacked(pos.board, k, -side);
  }

  make(pos, m) {
    const B = pos.board, t = pos.turn;
    const u = { piece: B[m.from], capt: 0, captSq: -1, castle: { ...pos.castle }, ep: pos.ep };
    B[m.from] = 0;
    if (m.flag === 'ep') {
      u.captSq = m.to + (t === 1 ? 8 : -8);
      u.capt = B[u.captSq];
      B[u.captSq] = 0;
    } else if (B[m.to] !== 0) {
      u.capt = B[m.to];
      u.captSq = m.to;
    }
    B[m.to] = m.promo ? 5 * t : u.piece;
    if (m.flag === 'ck') {
      if (t === 1) { B[61] = B[63]; B[63] = 0; } else { B[5] = B[7]; B[7] = 0; }
    }
    if (m.flag === 'cq') {
      if (t === 1) { B[59] = B[56]; B[56] = 0; } else { B[3] = B[0]; B[0] = 0; }
    }
    const cs = pos.castle;
    if (u.piece === 6) { cs.wk = cs.wq = false; }
    if (u.piece === -6) { cs.bk = cs.bq = false; }
    if (m.from === 63 || m.to === 63) cs.wk = false;
    if (m.from === 56 || m.to === 56) cs.wq = false;
    if (m.from === 7 || m.to === 7) cs.bk = false;
    if (m.from === 0 || m.to === 0) cs.bq = false;
    pos.ep = m.flag === 'double' ? (m.from + m.to) / 2 : -1;
    pos.turn = -t;
    return u;
  }

  unmake(pos, m, u) {
    const B = pos.board;
    pos.turn = -pos.turn;
    const t = pos.turn;
    B[m.from] = u.piece;
    B[m.to] = 0;
    if (u.captSq >= 0) B[u.captSq] = u.capt;
    if (m.flag === 'ck') {
      if (t === 1) { B[63] = B[61]; B[61] = 0; } else { B[7] = B[5]; B[5] = 0; }
    }
    if (m.flag === 'cq') {
      if (t === 1) { B[56] = B[59]; B[59] = 0; } else { B[0] = B[3]; B[3] = 0; }
    }
    pos.castle = u.castle;
    pos.ep = u.ep;
  }

  allLegal(pos) {
    const out = [];
    for (const m of this.genMoves(pos)) {
      const u = this.make(pos, m);
      if (!this.kingChecked(pos, -pos.turn)) out.push(m);
      this.unmake(pos, m, u);
    }
    return out;
  }

  perft(pos, d) {
    if (d === 0) return 1;
    let n = 0;
    for (const m of this.genMoves(pos)) {
      const u = this.make(pos, m);
      if (!this.kingChecked(pos, -pos.turn)) n += this.perft(pos, d - 1);
      this.unmake(pos, m, u);
    }
    return n;
  }

  /* ---------- engine: search ---------- */

  evalBoard(B) {
    let s = 0;
    for (let i = 0; i < 64; i++) {
      const p = B[i];
      if (!p) continue;
      if (p > 0) s += CH_VAL[p] + CH_PST[p][i];
      else s -= CH_VAL[-p] + CH_PST[-p][i ^ 56];
    }
    return s;
  }

  orderMoves(ms) {
    return ms.sort((a, b) =>
      (Math.abs(b.capt || 0) * 10 + (b.promo ? 800 : 0)) -
      (Math.abs(a.capt || 0) * 10 + (a.promo ? 800 : 0)));
  }

  quiesce(pos, alpha, beta) {
    const stand = this.evalBoard(pos.board) * pos.turn;
    if (stand >= beta) return beta;
    if (stand > alpha) alpha = stand;
    const ms = this.orderMoves(this.genMoves(pos).filter(m => m.capt || m.promo));
    for (const m of ms) {
      const u = this.make(pos, m);
      if (this.kingChecked(pos, -pos.turn)) { this.unmake(pos, m, u); continue; }
      const v = -this.quiesce(pos, -beta, -alpha);
      this.unmake(pos, m, u);
      if (v >= beta) return beta;
      if (v > alpha) alpha = v;
    }
    return alpha;
  }

  negamax(pos, d, alpha, beta) {
    if (d === 0) return this.quiesce(pos, alpha, beta);
    const ms = this.orderMoves(this.genMoves(pos));
    let any = false;
    for (const m of ms) {
      const u = this.make(pos, m);
      if (this.kingChecked(pos, -pos.turn)) { this.unmake(pos, m, u); continue; }
      any = true;
      const v = -this.negamax(pos, d - 1, -beta, -alpha);
      this.unmake(pos, m, u);
      if (v >= beta) return beta;
      if (v > alpha) alpha = v;
    }
    if (!any) return this.kingChecked(pos, pos.turn) ? -(100000 + d * 100) : 0;
    return alpha;
  }

  searchBest() {
    const depth = [2, 3, 4][this.levelIdx];
    const jitter = [30, 8, 0][this.levelIdx];
    const ms = this.orderMoves(this.genMoves(this.pos));
    let best = null, bestV = -Infinity, alpha = -Infinity;
    for (const m of ms) {
      const u = this.make(this.pos, m);
      if (this.kingChecked(this.pos, -this.pos.turn)) { this.unmake(this.pos, m, u); continue; }
      const raw = -this.negamax(this.pos, depth - 1, -Infinity, -alpha);
      this.unmake(this.pos, m, u);
      const v = raw + (Math.random() * 2 - 1) * jitter;
      if (raw > alpha) alpha = raw;
      if (v > bestV) { bestV = v; best = m; }
    }
    return best;
  }

  /* ---------- game flow ---------- */

  snap() {
    return {
      board: this.pos.board.slice(),
      turn: this.pos.turn,
      castle: { ...this.pos.castle },
      ep: this.pos.ep,
      lastMove: this.lastMove,
      capW: this.capsByWhite.slice(),
      capB: this.capsByBlack.slice(),
    };
  }

  restore(s) {
    this.pos.board = s.board.slice();
    this.pos.turn = s.turn;
    this.pos.castle = { ...s.castle };
    this.pos.ep = s.ep;
    this.lastMove = s.lastMove;
    this.capsByWhite = s.capW.slice();
    this.capsByBlack = s.capB.slice();
  }

  recordCapture(u) {
    if (!u.capt) return;
    if (u.capt < 0) this.capsByWhite.push(-u.capt);
    else this.capsByBlack.push(u.capt);
  }

  insufficient() {
    const minors = [];
    for (const p of this.pos.board) {
      if (!p) continue;
      const a = Math.abs(p);
      if (a === 6) continue;
      if (a === 1 || a === 4 || a === 5) return false;
      minors.push(a);
    }
    return minors.length <= 1;
  }

  moveSound(u, m) {
    if (m.promo) Sfx.playSeq([['C5', 1], ['E5', 1], ['G5', 2]], 0.06, { vol: 0.3 });
    else if (m.flag === 'ck' || m.flag === 'cq') {
      Sfx.tone({ f: 240, type: 'square', dur: 0.05, vol: 0.25 });
      Sfx.tone({ f: 300, type: 'square', dur: 0.05, vol: 0.25, at: Sfx.time + 0.09 });
    } else if (u.capt) {
      Sfx.noise({ dur: 0.12, vol: 0.35, fc: 600 });
      Sfx.tone({ f: 160, f1: 110, type: 'square', dur: 0.1, vol: 0.3 });
    } else {
      Sfx.tone({ f: 240, f1: 180, type: 'square', dur: 0.06, vol: 0.22 });
    }
  }

  addAnims(m, movedPiece) {
    const names = ' PNBRQK';
    const kind = names[Math.abs(movedPiece)];
    const side = movedPiece > 0 ? 1 : -1;
    this.anims = [{ from: m.from, to: m.to, kind: m.promo ? 'Q' : kind, side, start: this.animT }];
    if (m.flag === 'ck') {
      this.anims.push(side === 1 ? { from: 63, to: 61, kind: 'R', side, start: this.animT }
                                 : { from: 7, to: 5, kind: 'R', side, start: this.animT });
    }
    if (m.flag === 'cq') {
      this.anims.push(side === 1 ? { from: 56, to: 59, kind: 'R', side, start: this.animT }
                                 : { from: 0, to: 3, kind: 'R', side, start: this.animT });
    }
  }

  checkEnd() {
    const side = this.pos.turn;
    if (this.allLegal(this.pos).length === 0) {
      this.state = 'over';
      if (this.kingChecked(this.pos, side)) {
        if (side === -this.playerSide) {
          this.result = 'CHECKMATE — YOU WIN!';
          this.wins++;
          saveHi('chess', this.wins);
          this.pose = { type: 'shame', t: 0 };    // head on the table
          Sfx.playSeq([['C5', 1], ['E5', 1], ['G5', 1], ['C6', 1], ['E6', 1], ['G6', 2]], 0.09, { vol: 0.4 });
          Sfx.tone({ f: 230, f1: 150, type: 'sine', dur: 0.5, vol: 0.2, at: Sfx.time + 1.0 });
          Sfx.tone({ f: 180, f1: 118, type: 'sine', dur: 0.6, vol: 0.18, at: Sfx.time + 1.5 });
        } else {
          this.result = 'CHECKMATE — CPU WINS';
          this.pose = { type: 'joy', t: 0 };      // jumping about
          Sfx.playSeq([['E4', 2], ['C4', 2], ['A3', 2], ['F3', 4]], 0.11, { type: 'sawtooth', vol: 0.35 });
          Sfx.playSeq([['C5', 1], ['E5', 1], ['G5', 1], ['C6', 2]], 0.08, { vol: 0.3 });
        }
      } else {
        this.result = 'STALEMATE — DRAW';
        this.pose = null;
        Sfx.playSeq([['C5', 2], ['C5', 2]], 0.1, { vol: 0.3 });
      }
      this.status = this.result;
      return true;
    }
    if (this.insufficient()) {
      this.state = 'over';
      this.result = 'DRAW — INSUFFICIENT MATERIAL';
      this.status = this.result;
      Sfx.playSeq([['C5', 2], ['C5', 2]], 0.1, { vol: 0.3 });
      return true;
    }
    return false;
  }

  playPlayerMove(m) {
    this.history.push(this.snap());
    const movedPiece = this.pos.board[m.from];
    const u = this.make(this.pos, m);
    this.recordCapture(u);
    this.lastMove = m;
    this.sel = -1;
    this.selMoves = [];
    this.addAnims(m, movedPiece);
    this.moveSound(u, m);
    if (this.checkEnd()) return;
    if (this.kingChecked(this.pos, -this.playerSide)) {
      Sfx.tone({ f: 880, type: 'square', dur: 0.08, vol: 0.25 });
    }
    this.state = 'thinking';
    this.status = 'CPU IS THINKING';
    this.thinkTimer = setTimeout(() => {
      if (this.dead) return;
      this.cpuMove();
    }, 350);
  }

  cpuMove() {
    if (this.sip || (this.pose && this.pose.type === 'stretch')) {   // wine and stretches finish first
      this.thinkTimer = setTimeout(() => { if (!this.dead) this.cpuMove(); }, 400);
      return;
    }
    const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
    const m = this.searchBest();
    const searchMs = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : 0) - t0;
    this.lastSearchMs = searchMs;
    if (!m) { this.checkEnd(); return; }
    this.history.push(this.snap());
    const movedPiece = this.pos.board[m.from];
    const u = this.make(this.pos, m);
    this.recordCapture(u);
    this.lastMove = m;
    // the opponent reaches out and moves the piece by hand
    const names = ' PNBRQK';
    const side = movedPiece > 0 ? 1 : -1;
    const q = [{
      from: m.from, to: m.to,
      kind: m.promo ? 'Q' : names[Math.abs(movedPiece)], side,
      capt: u.capt ? Math.abs(u.capt) : 0,
      captSide: u.capt ? (u.capt > 0 ? 1 : -1) : 0,
      captSq: u.captSq, m, u,
    }];
    if (m.flag === 'ck') q.push({ from: side === 1 ? 63 : 7, to: side === 1 ? 61 : 5, kind: 'R', side, capt: 0, m: {}, u: {} });
    if (m.flag === 'cq') q.push({ from: side === 1 ? 56 : 0, to: side === 1 ? 59 : 3, kind: 'R', side, capt: 0, m: {}, u: {} });
    // scratch the head only when the position genuinely made them think hard
    q[0].think = this.lastSearchMs > 600 || Math.random() < 0.28;
    this.handQueue = q;
    this.startNextHand();
    this.status = 'CPU MOVES';
  }

  undo() {
    if (this.state === 'thinking' || this.state === 'pick') return;
    if (!this.history.some(s => s.turn === this.playerSide)) return;
    let s = null;
    while (this.history.length) {
      s = this.history.pop();
      if (s.turn === this.playerSide) break;
    }
    this.restore(s);
    this.sel = -1;
    this.selMoves = [];
    this.anims = [];
    this.pose = null;
    this.state = 'play';
    this.result = null;
    this.status = this.kingChecked(this.pos, this.playerSide) ? 'CHECK — YOUR MOVE' : 'YOUR MOVE';
    Sfx.tone({ f: 330, f1: 200, type: 'square', dur: 0.09, vol: 0.2 });
  }

  buzz() { Sfx.tone({ f: 110, type: 'sawtooth', dur: 0.09, vol: 0.22 }); }

  legalFrom(i) { return this.allLegal(this.pos).filter(m => m.from === i); }

  press() {
    if (this.state !== 'play' || this.paused) return;
    const i = this.cursor, B = this.pos.board;
    const mine = (v) => v !== 0 && (v > 0) === (this.playerSide > 0);
    if (this.sel < 0) {
      if (mine(B[i])) {
        this.sel = i;
        this.selMoves = this.legalFrom(i);
        Sfx.tone({ f: 480, type: 'square', dur: 0.04, vol: 0.15 });
      } else this.buzz();
      return;
    }
    if (i === this.sel) { this.sel = -1; this.selMoves = []; return; }
    const m = this.selMoves.find(mm => mm.to === i);
    if (m) { this.playPlayerMove(m); return; }
    if (mine(B[i])) {
      this.sel = i;
      this.selMoves = this.legalFrom(i);
      Sfx.tone({ f: 480, type: 'square', dur: 0.04, vol: 0.15 });
      return;
    }
    this.buzz();
  }

  /* ---------- input ---------- */

  logicalXY(ev) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (ev.clientX - rect.left) * (this.canvas.width / rect.width) / this.RS,
      y: (ev.clientY - rect.top) * (this.canvas.height / rect.height) / this.RS,
    };
  }

  mouseDown(ev) {
    Sfx.ac();
    const p = this.logicalXY(ev);
    this.mouse = { down: true, drag: false, x: p.x, y: p.y };
  }

  mouseMove(ev) {
    if (!this.mouse.down) return;
    const p = this.logicalXY(ev);
    const dx = p.x - this.mouse.x, dy = p.y - this.mouse.y;
    if (!this.mouse.drag && Math.hypot(dx, dy) > 6) {
      this.mouse.drag = true;
      try { this.canvas.style.cursor = 'grabbing'; } catch (e) {}
    }
    if (this.mouse.drag) {
      this.cam.yaw -= dx * 0.008;
      this.cam.targetYaw = this.cam.yaw;
      this.cam.pitch = Math.max(0.10, Math.min(1.35, this.cam.pitch + dy * 0.006));
      this.mouse.x = p.x;
      this.mouse.y = p.y;
    }
  }

  mouseUp(ev) {
    if (!this.mouse.down) return;
    const wasDrag = this.mouse.drag;
    this.mouse.down = false;
    this.mouse.drag = false;
    try { this.canvas.style.cursor = 'grab'; } catch (e) {}
    if (wasDrag) { this.impKey = null; return; }   // force a fresh lighting pass
    const p = this.logicalXY(ev);
    this.clickAt(p.x, p.y);
  }

  // shared by mouse clicks and touch taps
  clickAt(x, y) {
    if (this.state === 'pick') {
      if (y > 396 && y < 566) {
        if (x > 156 && x < 316) { this.beginGame(1); return; }
        if (x > 356 && x < 516) { this.beginGame(-1); return; }
      }
      return;
    }
    if (this.paused) return;
    let hit = -1;
    for (let i = 0; i < 64; i++) {
      const poly = this.tilePolys[i];
      if (poly && this.pointInPoly(x, y, poly)) { hit = i; break; }
    }
    if (hit < 0) return;
    this.cursor = hit;
    this.press();
  }

  // ---- touch: one finger drags the view or taps a square; two fingers zoom ----

  touchXY(t) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (t.clientX - rect.left) * (this.canvas.width / rect.width) / this.RS,
      y: (t.clientY - rect.top) * (this.canvas.height / rect.height) / this.RS,
    };
  }

  touchStart(ev) {
    ev.preventDefault();                    // stop WebKit synthesising mouse events too
    Sfx.ac();
    if (ev.touches.length === 1) {
      const p = this.touchXY(ev.touches[0]);
      this.tp = { x: p.x, y: p.y, sx: p.x, sy: p.y, moved: false, pinch: 0 };
    } else if (ev.touches.length === 2 && this.tp) {
      const a = this.touchXY(ev.touches[0]), b = this.touchXY(ev.touches[1]);
      this.tp.pinch = Math.hypot(a.x - b.x, a.y - b.y);
      this.tp.moved = true;
    }
  }

  touchMove(ev) {
    ev.preventDefault();
    if (!this.tp) return;
    if (ev.touches.length >= 2) {
      const a = this.touchXY(ev.touches[0]), b = this.touchXY(ev.touches[1]);
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.tp.pinch > 0) this.zoom((this.tp.pinch - d) * 0.03);
      this.tp.pinch = d;
      this.tp.moved = true;
      return;
    }
    const p = this.touchXY(ev.touches[0]);
    const dx = p.x - this.tp.x, dy = p.y - this.tp.y;
    if (!this.tp.moved && Math.hypot(p.x - this.tp.sx, p.y - this.tp.sy) > 8) this.tp.moved = true;
    if (this.tp.moved) {
      this.cam.yaw -= dx * 0.008;
      this.cam.targetYaw = this.cam.yaw;
      this.cam.pitch = Math.max(0.10, Math.min(1.35, this.cam.pitch + dy * 0.006));
    }
    this.tp.x = p.x;
    this.tp.y = p.y;
  }

  touchEnd(ev) {
    ev.preventDefault();
    if (!this.tp) return;
    if (ev.touches.length > 0) { this.tp.pinch = 0; return; }   // a finger remains
    const wasTap = !this.tp.moved;
    const x = this.tp.sx, y = this.tp.sy;
    this.tp = null;
    if (wasTap) this.clickAt(x, y);
    else this.impKey = null;               // drag over — refresh piece lighting
  }

  pointInPoly(x, y, poly) {
    let sign = 0;
    for (let i = 0; i < poly.length; i++) {
      const [x0, y0] = poly[i], [x1, y1] = poly[(i + 1) % poly.length];
      const cr = (x1 - x0) * (y - y0) - (y1 - y0) * (x - x0);
      if (Math.abs(cr) < 1e-9) continue;
      const s = Math.sign(cr);
      if (sign === 0) sign = s;
      else if (s !== sign) return false;
    }
    return true;
  }

  zoom(d) {
    this.cam.radius = Math.max(7.5, Math.min(19, this.cam.radius + d));
  }

  key(e, down) {
    if (!down) return;
    const k = e.code;

    if (k === 'KeyQ') { this.cam.targetYaw += Math.PI / 8; return; }
    if (k === 'KeyE') { this.cam.targetYaw -= Math.PI / 8; return; }
    if (k === 'KeyR') { this.cam.pitch = Math.min(1.35, this.cam.pitch + 0.09); return; }
    if (k === 'KeyF') { this.cam.pitch = Math.max(0.10, this.cam.pitch - 0.09); return; }
    if (k === 'Equal' || k === 'NumpadAdd') { this.zoom(-0.8); return; }
    if (k === 'Minus' || k === 'NumpadSubtract') { this.zoom(0.8); return; }
    if (k === 'KeyV') {
      this.cam.targetYaw = this.homeYaw();
      this.cam.pitch = 0.94;
      this.cam.radius = 11.6;
      return;
    }
    if (k === 'KeyC') {
      this.charKey = this.charKey === 'viktor' ? 'vera' : 'viktor';
      try { localStorage.setItem('arcade.chess.char', this.charKey); } catch (e) {}
      Sfx.tone({ f: 520, f1: 700, type: 'square', dur: 0.06, vol: 0.2 });
      return;
    }

    if (this.state === 'pick') {
      if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown') {
        this.pickSide *= -1;
        this.playerSide = this.pickSide;
        this.cam.targetYaw = this.homeYaw();
        Sfx.tone({ f: 500, f1: 720, type: 'square', dur: 0.05, vol: 0.2 });
      } else if (k === 'Enter' || k === 'Space') {
        this.beginGame(this.pickSide);
      } else if (k === 'KeyW') this.beginGame(1);
      else if (k === 'KeyB') this.beginGame(-1);
      else if (k === 'KeyL') {
        this.levelIdx = (this.levelIdx + 1) % 3;
        Sfx.tone({ f: 400 + this.levelIdx * 120, type: 'square', dur: 0.06, vol: 0.2 });
      }
      return;
    }

    if (k === 'KeyP') {
      if (this.state === 'over') return;
      this.paused = !this.paused;
      Sfx.tone({ f: this.paused ? 300 : 420, type: 'square', dur: 0.06, vol: 0.2 });
      return;
    }
    if (this.paused) return;

    if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown') {
      const quad = Math.round(this.cam.yaw / (Math.PI / 2));
      let d = k === 'ArrowUp' ? [-1, 0] : k === 'ArrowDown' ? [1, 0] : k === 'ArrowLeft' ? [0, -1] : [0, 1];
      const q = ((quad % 4) + 4) % 4;
      for (let i = 0; i < q; i++) d = [-d[1], d[0]];
      const r = Math.max(0, Math.min(7, (this.cursor >> 3) + d[0]));
      const c = Math.max(0, Math.min(7, (this.cursor & 7) + d[1]));
      this.cursor = r * 8 + c;
      return;
    }
    if (k === 'Enter' || k === 'Space') this.press();
    else if (k === 'KeyU') this.undo();
    else if (k === 'KeyN') {
      this.beginGame(-this.playerSide);
      Sfx.tone({ f: 500, f1: 720, type: 'square', dur: 0.06, vol: 0.2 });
    } else if (k === 'KeyL' && this.state !== 'thinking') {
      this.levelIdx = (this.levelIdx + 1) % 3;
      Sfx.tone({ f: 400 + this.levelIdx * 120, type: 'square', dur: 0.06, vol: 0.2 });
    }
  }

  glassHome() {
    const fw = this.playerSide;
    return [fw * -1.75, -0.04, -7.35 * fw + fw * 0.85];
  }

  updateSip(dt) {
    const s = this.sip;
    s.t += dt;
    if (s.t > 4.5) {   // safety: a sip never overruns
      this.sip = null;
      this.sipCount = (this.sipCount || 0) + 1;
      this.glassPos = this.glassHome();
      this.glassTilt = 0;
      return;
    }
    const D = { reach: 0.5, lift: 0.6, drink: 0.7, lower: 0.6, release: 0.45 };
    const fw = this.playerSide, cz = -7.35 * fw;
    const rest = this.handRestPos(-1);
    const home = this.glassHome();
    const grip = [home[0], home[1] + 0.34, home[2]];
    const mouthG = [fw * -0.26, 2.44, cz + fw * 0.58];
    const ease = (x) => x * x * (3 - 2 * x);
    let t = s.t;
    if (t < D.reach) {
      s.phase = 'reach';
      const k = ease(t / D.reach);
      s.handPos = [rest[0] + (grip[0] - rest[0]) * k, rest[1] + (grip[1] - rest[1]) * k + Math.sin(Math.PI * k) * 0.2, rest[2] + (grip[2] - rest[2]) * k];
      return;
    }
    t -= D.reach;
    if (t < D.lift) {
      s.phase = 'lift';
      const k = ease(t / D.lift);
      s.handPos = [grip[0] + (mouthG[0] - grip[0]) * k, grip[1] + (mouthG[1] - grip[1]) * k, grip[2] + (mouthG[2] - grip[2]) * k];
      this.glassPos = [s.handPos[0], s.handPos[1] - 0.34, s.handPos[2]];
      return;
    }
    t -= D.lift;
    if (t < D.drink) {
      s.phase = 'drink';
      if (!s.glug) {
        s.glug = true;
        Sfx.tone({ f: 300, f1: 180, type: 'sine', dur: 0.10, vol: 0.16 });
        Sfx.tone({ f: 280, f1: 170, type: 'sine', dur: 0.10, vol: 0.14, at: Sfx.time + 0.16 });
      }
      s.handPos = mouthG.slice();
      this.glassPos = [mouthG[0], mouthG[1] - 0.34, mouthG[2]];
      this.glassTilt = Math.sin(Math.PI * Math.min(1, t / D.drink)) * 0.55;
      return;
    }
    t -= D.drink;
    if (t < D.lower) {
      s.phase = 'lower';
      const k = ease(t / D.lower);
      s.handPos = [mouthG[0] + (grip[0] - mouthG[0]) * k, mouthG[1] + (grip[1] - mouthG[1]) * k, mouthG[2] + (grip[2] - mouthG[2]) * k];
      this.glassPos = [s.handPos[0], s.handPos[1] - 0.34, s.handPos[2]];
      this.glassTilt = 0;
      return;
    }
    t -= D.lower;
    if (t < D.release) {
      s.phase = 'release';
      const k = ease(t / D.release);
      s.handPos = [grip[0] + (rest[0] - grip[0]) * k, grip[1] + (rest[1] - grip[1]) * k + Math.sin(Math.PI * k) * 0.15, grip[2] + (rest[2] - grip[2]) * k];
      this.glassPos = home.slice();
      return;
    }
    this.sip = null;
    this.sipCount = (this.sipCount || 0) + 1;
    this.glassPos = home.slice();
    this.glassTilt = 0;
  }

  update(dt) {
    if (!this.paused) {
      this.animT += dt;
      this.blinkT += dt;
      this.updateHand(dt);

      // poses: stretching, victory jumps, head-on-table despair
      if (this.pose) {
        this.pose.t += dt;
        if (this.pose.type === 'stretch' && this.pose.t > 2.5) this.pose = null;
      } else if (this.state === 'play' && !this.hand && !this.sip) {
        if (this.stretchCooldown == null) this.stretchCooldown = 16 + Math.random() * 20;
        this.stretchCooldown -= dt * (this.cpuWorried ? 2.4 : 1);
        if (this.stretchCooldown <= 0) {
          this.pose = { type: 'stretch', t: 0 };
          this.stretchCooldown = 24 + Math.random() * 22;
        }
      }

      // a sip of wine now and then, while the player is thinking
      if (this.sip) {
        this.updateSip(dt);
      } else {
        this.glassPos = this.glassHome();
        this.glassTilt = 0;
        if (this.state === 'play' && !this.hand && !this.pose) {
          const thirst = CH_CHARS[this.charKey].thirst || { min: 12, rand: 12 };
          if (this.sipCooldown == null) this.sipCooldown = thirst.min * 0.6 + Math.random() * thirst.rand;
          this.sipCooldown -= dt;
          if (this.sipCooldown <= 0) {
            this.sip = { t: 0, phase: 'reach' };
            this.sipCooldown = thirst.min + Math.random() * thirst.rand;
          }
        }
      }

      // tipsiness: sway, hiccups
      this.drunk = Math.min(1, (this.sipCount || 0) / 7);
      let lift = 0;
      let roll = Math.sin(this.animT * 0.9) * 0.10 * this.drunk;
      if (this.drunk > 0.35) {
        this.hicT = (this.hicT == null ? 5 : this.hicT) - dt;
        if (this.hicT <= 0) {
          this.hicT = 6 + Math.random() * 7;
          this.hicPulse = 1;
          Sfx.tone({ f: 520, f1: 900, type: 'square', dur: 0.07, vol: 0.14 });
          Sfx.tone({ f: 700, f1: 1000, type: 'square', dur: 0.05, vol: 0.10, at: Sfx.time + 0.08 });
        }
      }
      this.hicPulse = Math.max(0, (this.hicPulse || 0) - dt * 4);
      lift += this.hicPulse * 0.10;
      roll += this.hicPulse * 0.05;
      if (this.pose) {
        const t = this.pose.t;
        if (this.pose.type === 'stretch') {
          const k = t < 0.5 ? t / 0.5 : t > 2.0 ? Math.max(0, (2.5 - t) / 0.5) : 1;
          const ke = k * k * (3 - 2 * k);
          lift += ke * 0.85 + (t > 0.5 && t < 2.0 ? Math.sin((t - 0.5) * 4) * 0.05 : 0);
        } else if (this.pose.type === 'joy') {
          lift += Math.abs(Math.sin(t * 5.2)) * 0.55;
          roll += Math.sin(t * 5.2) * 0.05;
        }
      }
      this.bodyLift = lift;
      this.bodyRoll = roll;

      const cz = -7.35 * this.playerSide;
      const shame = this.pose && this.pose.type === 'shame';
      const tgt = shame ? 1.95
        : (this.hand && this.hand.handPos)
          ? Math.min(1, Math.max(0, (Math.hypot(this.hand.handPos[0], this.hand.handPos[2] - cz) - 3.2) / 4.6))
          : 0;
      this.leanAmt += (tgt - this.leanAmt) * Math.min(1, dt * (shame ? 2.5 : 6));
    }
    let diff = this.cam.targetYaw - this.cam.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.cam.yaw += diff * Math.min(1, dt * 7);
    this.anims = this.anims.filter(a => this.animT - a.start < 0.32);
  }

  /* ---------- draw ---------- */

  rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  pieceWorld(i, animAt) {
    let w = this.sqWorld(i);
    let lift = 0;
    const a = animAt[i];
    if (a) {
      let t = (this.animT - a.start) / 0.3;
      t = Math.max(0, Math.min(1, t));
      const s = t * t * (3 - 2 * t);
      const from = this.sqWorld(a.from);
      w = { x: from.x + (w.x - from.x) * s, z: from.z + (w.z - from.z) * s };
      lift = Math.sin(Math.PI * t) * (a.kind === 'N' ? 0.55 : 0.18);
    }
    return { w, lift };
  }

  sceneFaces() {
    const faces = [];
    this.tilePolys = [];
    for (const f of this.boardFaces) faces.push(f);
    for (let i = 0; i < 64; i++) {
      faces.push({ pts: this.tileCorners[i], col: 'rgba(0,0,0,0)', alpha: 0.001, id: i });
    }

    const liftY = 0.012;
    const tileQuad = (i, col, alpha, dy) => {
      const c = this.tileCorners[i];
      return { pts: c.map(p => [p[0], (dy || liftY), p[2]]), col, alpha };
    };

    if (this.lastMove) {
      faces.push(tileQuad(this.lastMove.from, 'rgb(255,213,74)', 0.32));
      faces.push(tileQuad(this.lastMove.to, 'rgb(255,213,74)', 0.40));
    }
    if (this.sel >= 0) {
      faces.push(tileQuad(this.sel, 'rgb(80,200,255)', 0.38));
      for (const m of this.selMoves) {
        const w = this.sqWorld(m.to);
        if (m.capt) faces.push({ pts: this.octagon(w.x, liftY, w.z, 0.42), col: 'rgb(235,70,70)', alpha: 0.5 });
        else faces.push({ pts: this.octagon(w.x, liftY, w.z, 0.15), col: 'rgb(40,90,80)', alpha: 0.55 });
      }
    }
    for (const side of [1, -1]) {
      if (this.state !== 'pick' && this.kingChecked(this.pos, side)) {
        const k = this.kingSq(this.pos.board, side);
        if (k >= 0) {
          const pulse = 0.32 + 0.16 * Math.sin(this.animT * 5);
          faces.push(tileQuad(k, 'rgb(255,45,45)', pulse));
        }
      }
    }
    if (this.state === 'play' && !this.paused && Math.floor(this.animT * 2.5) % 2 === 0) {
      faces.push(tileQuad(this.cursor, 'rgb(255,210,80)', 0.30, 0.018));
    }

    // the wine glass casts a little shadow while it stands on the table
    const gp = this.glassPos || this.glassHome();
    if (gp[1] < 0.2) {
      faces.push({ pts: this.octagon(gp[0], -0.036, gp[2], 0.26), col: 'rgb(0,0,0)', alpha: 0.22 });
    }

    // directional shadows + contact shadows for every piece
    for (const pc of this.effectivePieces()) {
      const sil = CH_SHADOW_SIL[pc.kind];
      faces.push({ pts: this.shadowPoly(sil, pc.x, pc.z, pc.lift, 1.35), col: 'rgb(10,8,6)', alpha: 0.10 });
      faces.push({ pts: this.shadowPoly(sil, pc.x, pc.z, pc.lift, 1.0), col: 'rgb(10,8,6)', alpha: 0.20 });
      faces.push({ pts: this.octagon(pc.x, 0.004, pc.z, 0.27), col: 'rgb(0,0,0)', alpha: Math.max(0.08, 0.28 - pc.lift * 0.25) });
    }
    return faces;
  }

  /* ---------- the opponent: hand animation + character ---------- */

  handRestPos(sgn) {
    const fw = this.playerSide, cz = -7.35 * this.playerSide;
    return [fw * sgn * 0.60, 0.13, cz + fw * 1.04];
  }

  startNextHand() {
    const it = this.handQueue.shift();
    const w1 = this.sqWorld(it.from), w2 = this.sqWorld(it.to);
    this.hand = Object.assign({}, it, {
      t: 0, phase: 'reach', landed: false,
      grabH: (CH_PIECE_H[it.kind] || 1) * 0.62,
      fx: w1.x, fz: w1.z, tx: w2.x, tz: w2.z,
      handPos: this.handRestPos(Math.sign(this.playerSide * w1.x) || 1),
    });
  }

  updateHand(dt) {
    if (!this.hand) return;
    const h = this.hand;
    h.t += dt;
    const D = { ponder: 1.05, aha: 0.42, muse: 0.95, reach: 0.55, grab: 0.12, carry: 0.62, put: 0.12, ret: 0.5 };
    const sgn = Math.sign(this.playerSide * h.fx) || 1;
    const rest = this.handRestPos(sgn);
    const fw = this.playerSide, czc = -7.35 * this.playerSide;
    const scratch = [fw * sgn * 0.50, 3.30, czc + fw * 0.12];
    const ease = (x) => x * x * (3 - 2 * x);
    const grabP = [h.fx, h.grabH, h.fz], putP = [h.tx, h.grabH, h.tz];
    let t = h.t;
    if (h.think) {
      // scratch the head, look worried...
      if (t < D.ponder) {
        h.phase = 'ponder';
        const s = ease(Math.min(1, t / 0.35));
        const wob = t > 0.35 ? Math.sin((t - 0.35) * 15) * 0.05 : 0;
        h.handPos = [
          rest[0] + (scratch[0] - rest[0]) * s,
          rest[1] + (scratch[1] - rest[1]) * s + wob,
          rest[2] + (scratch[2] - rest[2]) * s,
        ];
        if (!h.hmm && t > 0.38) {
          h.hmm = true;
          Sfx.tone({ f: 196, f1: 164, type: 'sine', dur: 0.28, vol: 0.12 });
          Sfx.tone({ f: 175, f1: 208, type: 'sine', dur: 0.30, vol: 0.10, at: Sfx.time + 0.4 });
        }
        return;
      }
      t -= D.ponder;
      // ...then brighten up: aha!
      if (t < D.aha) {
        h.phase = 'aha';
        if (!h.ding) {
          h.ding = true;
          Sfx.tone({ f: 880, f1: 1320, type: 'sine', dur: 0.16, vol: 0.14 });
        }
        const s = ease(t / D.aha);
        h.handPos = [
          scratch[0] + (rest[0] - scratch[0]) * s,
          scratch[1] + (rest[1] - scratch[1]) * s + Math.sin(Math.PI * s) * 0.1,
          scratch[2] + (rest[2] - scratch[2]) * s,
        ];
        return;
      }
      t -= D.aha;
      // ...savour the idea for a moment before reaching out
      if (t < D.muse) {
        h.phase = 'muse';
        h.handPos = rest.slice();
        return;
      }
      t -= D.muse;
    }
    if (t < D.reach) {
      h.phase = 'reach';
      const s = ease(t / D.reach);
      h.handPos = [
        rest[0] + (grabP[0] - rest[0]) * s,
        rest[1] + (grabP[1] - rest[1]) * s + Math.sin(Math.PI * s) * 0.55,
        rest[2] + (grabP[2] - rest[2]) * s,
      ];
      return;
    }
    t -= D.reach;
    if (t < D.grab) { h.phase = 'grab'; h.handPos = grabP.slice(); return; }
    t -= D.grab;
    if (t < D.carry) {
      h.phase = 'carry';
      const s = ease(t / D.carry);
      h.handPos = [
        grabP[0] + (putP[0] - grabP[0]) * s,
        h.grabH + Math.sin(Math.PI * s) * 0.85,
        grabP[2] + (putP[2] - grabP[2]) * s,
      ];
      return;
    }
    t -= D.carry;
    if (t < D.put) {
      h.phase = 'put';
      h.handPos = putP.slice();
      if (!h.landed) {
        h.landed = true;
        this.moveSound(h.u || { capt: 0 }, h.m || {});
      }
      return;
    }
    t -= D.put;
    if (t < D.ret) {
      h.phase = 'ret';
      const s = ease(t / D.ret);
      h.handPos = [
        putP[0] + (rest[0] - putP[0]) * s,
        putP[1] + (rest[1] - putP[1]) * s + Math.sin(Math.PI * s) * 0.4,
        putP[2] + (rest[2] - putP[2]) * s,
      ];
      return;
    }
    this.hand = null;
    if (this.handQueue.length) { this.startNextHand(); return; }
    this.finishCpuMove();
  }

  finishCpuMove() {
    if (this.checkEnd()) return;
    // how does the engine feel about its position? (drives worry + stretching)
    this.cpuScore = this.evalBoard(this.pos.board) * (-this.playerSide);
    this.cpuWorried = this.cpuScore < -120;
    this.state = 'play';
    if (this.kingChecked(this.pos, this.playerSide)) {
      this.status = 'CHECK — YOUR MOVE';
      Sfx.tone({ f: 880, type: 'square', dur: 0.09, vol: 0.3 });
      Sfx.tone({ f: 660, type: 'square', dur: 0.09, vol: 0.3, at: Sfx.time + 0.12 });
    } else {
      this.status = 'YOUR MOVE';
    }
  }

  // two-bone arm: shoulder→elbow→hand, stretches politely for long reaches
  solveArm(S, T) {
    const d = [T[0] - S[0], T[1] - S[1], T[2] - S[2]];
    let dist = Math.hypot(d[0], d[1], d[2]) || 1e-6;
    let L1 = 1.15, L2 = 1.15;
    if (dist > L1 + L2) { const k = dist / (L1 + L2); L1 *= k; L2 *= k; }
    const dir = [d[0] / dist, d[1] / dist, d[2] / dist];
    const a = (L1 * L1 - L2 * L2 + dist * dist) / (2 * dist);
    const h = Math.sqrt(Math.max(0.01, L1 * L1 - a * a));
    let eDir = [dir[2] * 0.55, -0.85, -dir[0] * 0.55];
    const dot = eDir[0] * dir[0] + eDir[1] * dir[1] + eDir[2] * dir[2];
    let o = [eDir[0] - dir[0] * dot, eDir[1] - dir[1] * dot, eDir[2] - dir[2] * dot];
    const ol = Math.hypot(o[0], o[1], o[2]) || 1;
    o = [o[0] / ol, o[1] / ol, o[2] / ol];
    return [S[0] + dir[0] * a + o[0] * h, S[1] + dir[1] * a + o[1] * h, S[2] + dir[2] * a + o[2] * h];
  }

  cylFaces(p0, p1, r0, r1, seg = 8) {
    const ax = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    const al = Math.hypot(ax[0], ax[1], ax[2]) || 1;
    const a = [ax[0] / al, ax[1] / al, ax[2] / al];
    let u = Math.abs(a[1]) < 0.9 ? [a[2], 0, -a[0]] : [1, 0, 0];
    const ul = Math.hypot(u[0], u[1], u[2]) || 1;
    u = [u[0] / ul, u[1] / ul, u[2] / ul];
    const v = [a[1] * u[2] - a[2] * u[1], a[2] * u[0] - a[0] * u[2], a[0] * u[1] - a[1] * u[0]];
    const mid = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2];
    const faces = [];
    for (let i = 0; i < seg; i++) {
      const b0 = (i / seg) * 2 * Math.PI, b1 = ((i + 1) / seg) * 2 * Math.PI;
      const ring = (p, r, b) => [
        p[0] + (u[0] * Math.cos(b) + v[0] * Math.sin(b)) * r,
        p[1] + (u[1] * Math.cos(b) + v[1] * Math.sin(b)) * r,
        p[2] + (u[2] * Math.cos(b) + v[2] * Math.sin(b)) * r,
      ];
      const q = [ring(p0, r0, b0), ring(p0, r0, b1), ring(p1, r1, b1), ring(p1, r1, b0)];
      const rad = (b) => [u[0] * Math.cos(b) + v[0] * Math.sin(b), u[1] * Math.cos(b) + v[1] * Math.sin(b), u[2] * Math.cos(b) + v[2] * Math.sin(b)];
      faces.push({ pts: q, n: chNormalFromWinding(q, mid), n0: rad(b0), n1: rad(b1) });
    }
    return faces;
  }

  sphereW(c, r, seg = 8, rows = 5) {
    const prof = [];
    for (let i = 0; i <= rows; i++) {
      const a = Math.PI * (i / rows);
      prof.push([Math.sin(a) * r, -Math.cos(a) * r]);
    }
    return chLathe(prof, seg).map(f => ({
      pts: f.pts.map(p => [p[0] + c[0], p[1] + c[1], p[2] + c[2]]),
      n: f.n, n0: f.n0, n1: f.n1,
    }));
  }

  charFaces() {
    const C = CH_CHARS[this.charKey];
    const fw = this.playerSide;
    const cz = -7.35 * this.playerSide;
    const th = Math.min(this.leanAmt, 2.0) * 0.62;
    const cs = Math.cos(th), sn = Math.sin(th);
    const roll = this.bodyRoll || 0;
    const lift = this.bodyLift || 0;
    const cr = Math.cos(roll), sr = Math.sin(roll);
    const bendP = (x, y, z) => {
      const dy = y - 0.45;
      const by = 0.45 + dy * cs - z * sn, bz = dy * sn + z * cs;
      const x2 = x * cr - (by - 0.45) * sr;
      const y2 = 0.45 + x * sr + (by - 0.45) * cr;
      return [x2, y2 + lift, bz];
    };
    const W = (p) => {
      const b = bendP(p[0], p[1], p[2]);
      return [fw * b[0], b[1], cz + fw * b[2]];
    };
    const WN = (n) => {
      const ny1 = n[1] * cs - n[2] * sn, nz1 = n[1] * sn + n[2] * cs;
      const nx2 = n[0] * cr - ny1 * sr, ny2 = n[0] * sr + ny1 * cr;
      return [fw * nx2, ny2, fw * nz1];
    };
    const out = [];
    // smooth, slightly glossy cartoon shading (view-dependent highlight)
    const camB = this.camBasis(this.cam, [0, 0.15, 0]);
    let Vv = [camB.eye[0], camB.eye[1] - 1.6, camB.eye[2] - cz];
    const vl = Math.hypot(Vv[0], Vv[1], Vv[2]) || 1;
    Vv = [Vv[0] / vl, Vv[1] / vl, Vv[2] / vl];
    let Hv = [Vv[0] + CH_LIGHT[0], Vv[1] + CH_LIGHT[1], Vv[2] + CH_LIGHT[2]];
    const hln = Math.hypot(Hv[0], Hv[1], Hv[2]) || 1;
    Hv = [Hv[0] / hln, Hv[1] / hln, Hv[2] / hln];
    const shade = (rgb, n, m) => {
      const d = Math.max(0, n[0] * CH_LIGHT[0] + n[1] * CH_LIGHT[1] + n[2] * CH_LIGHT[2]);
      const sp = Math.pow(Math.max(0, n[0] * Hv[0] + n[1] * Hv[1] + n[2] * Hv[2]), m.pow) * m.spec;
      const k = m.amb + m.diff * d;
      const r = Math.min(255, Math.round(rgb[0] * k + 255 * sp));
      const g2 = Math.min(255, Math.round(rgb[1] * k + 255 * sp));
      const b2 = Math.min(255, Math.round(rgb[2] * k + 255 * sp));
      return `rgb(${r},${g2},${b2})`;
    };
    const M_SKIN = { amb: .42, diff: .60, spec: .22, pow: 12 };
    const M_SUIT = { amb: .38, diff: .62, spec: .42, pow: 20 };
    const M_HAIR = { amb: .34, diff: .60, spec: .55, pow: 26 };
    const M_CAPE = { amb: .36, diff: .62, spec: .15, pow: 10 };
    const M_GLASS = { amb: .42, diff: .50, spec: .95, pow: 42 };
    const M_WINE = { amb: .48, diff: .55, spec: .55, pow: 18 };
    const emit = (faces, rgb, m = M_SUIT) => {
      for (const f of faces) {
        const item = { pts: f.pts.map(W), col: shade(rgb, WN(f.n), m) };
        if (f.n0 && f.n1 && f.n0 !== f.n1) {
          item.col0 = shade(rgb, WN(f.n0), m);
          item.col1 = shade(rgb, WN(f.n1), m);
        }
        out.push(item);
      }
    };
    const t3 = (faces, dx, dy, dz) => faces.map(f => ({
      pts: f.pts.map(p => [p[0] + dx, p[1] + dy, p[2] + dz]), n: f.n, n0: f.n0, n1: f.n1,
    }));

    // cape first (painter's sort puts it behind the torso)
    if (C.cape) {
      const sway = Math.sin(this.animT * 1.3) * 0.07;
      const top = [[-.70, 2.02, -.30], [0, 2.06, -.36], [.70, 2.02, -.30]];
      const bot = [[-1.08 + sway, 0.22, -.90], [sway * 1.4, 0.16, -1.02], [1.08 + sway, 0.22, -.90]];
      for (let i = 0; i < 2; i++) {
        const pts = [top[i], top[i + 1], bot[i + 1], bot[i]];
        const n = chNormalFromWinding(pts, [0, 1.2, 0]);
        out.push({ pts: pts.map(W), col: shade(C.cape, WN(n), M_CAPE) });
      }
    }

    emit(chLathe(C.torso, 22), C.suit, M_SUIT);
    // a bigger, rounder cartoon head at higher resolution
    const headProf = [];
    for (let i = 0; i <= 10; i++) {
      const a = Math.PI * i / 10;
      headProf.push([Math.sin(a) * .52, -Math.cos(a) * .52]);
    }
    emit(t3(chLathe(headProf, 24), 0, 2.80, 0.02), C.skin, M_SKIN);
    const hairProf = [];
    for (let i = 0; i <= 6; i++) {
      const a = Math.PI * (0.40 + 0.60 * i / 6);
      hairProf.push([Math.sin(a) * .60, -Math.cos(a) * .60]);
    }
    emit(t3(chLathe(hairProf, 24), 0, 2.92, -0.11), C.hair, M_HAIR);
    if (C.hairStyle === "bob") {
      emit(chBox(.48, 2.46, -0.02, .18, .74, .42), C.hair, M_HAIR);
      emit(chBox(-.48, 2.46, -0.02, .18, .74, .42), C.hair, M_HAIR);
      emit(chBox(0, 2.36, -0.48, .82, .95, .18), C.hair, M_HAIR);
    }

    // face + costume details (bold cartoon-strip features)
    const disc = (cx, cy, czl, r, colFlat, scaleY = 1, alpha) => {
      const pts = [];
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r * scaleY, czl]);
      }
      out.push({ pts: pts.map(W), col: colFlat, alpha });
    };
    const rgbOf = (v) => `rgb(${v[0]},${v[1]},${v[2]})`;
    const blink = (this.blinkT % 4.3) > 4.16 ? 0.12 : 1;
    const drunk = this.drunk || 0;
    const pose = this.pose;
    let mood = this.hand
      ? (this.hand.phase === "ponder" ? "worried" : "happy")
      : (this.state === "thinking" ? "focused" : "normal");
    if (pose && pose.type === "shame") mood = "worried";
    else if (pose && pose.type === "joy") mood = "happy";
    else if (mood === "normal" && drunk > 0.55) mood = "happy";            // tipsy grin
    else if (mood === "normal" && this.cpuWorried && (this.animT % 9) < 2.4) mood = "worried";
    let gx = 0, gy = 0;
    if (mood === "focused") gy = -0.04;
    if (mood === "worried") { gx = -0.026; gy = 0.034; }
    if (pose && pose.type === "stretch" && pose.t > 0.5 && pose.t < 2.0) {
      gx = Math.sin((pose.t - 0.5) * 2.1) * 0.05;    // looking around the room
      gy = 0.01;
    }
    gx += drunk * Math.sin(this.animT * 0.7) * 0.02;
    const hairC = rgbOf(C.hair);
    const skinC = rgbOf(C.skin);
    if (C.mask) {
      disc(0, 2.90, .530, .38, rgbOf(C.mask), .45);   // domino mask band
    }
    // outlined cartoon eyes
    disc(.19, 2.88, .543, .105, "rgb(45,36,32)", blink);
    disc(-.19, 2.88, .543, .105, "rgb(45,36,32)", blink);
    disc(.19, 2.88, .551, .092, "rgb(248,246,240)", blink);
    disc(-.19, 2.88, .551, .092, "rgb(248,246,240)", blink);
    const irisC = rgbOf(C.iris);
    disc(.19 + gx, 2.88 + gy, .558, .062, irisC, blink);
    disc(-.19 + gx, 2.88 + gy, .558, .062, irisC, blink);
    disc(.19 + gx * 1.2, 2.88 + gy, .565, .03, "rgb(22,17,16)", blink);
    disc(-.19 + gx * 1.2, 2.88 + gy, .565, .03, "rgb(22,17,16)", blink);
    disc(.165 + gx, 2.905 + gy, .572, .02, "rgb(255,255,255)", blink);
    disc(-.215 + gx, 2.905 + gy, .572, .02, "rgb(255,255,255)", blink);
    // brows: knitted when worried, lifted when happy
    const browQ = (sgn) => {
      let yi = 3.02, yo = 3.02;
      if (mood === "worried") { yi = 3.10; yo = 2.98; }
      else if (mood === "happy") { yi = 3.06; yo = 3.045; }
      const pts = [
        [sgn * .09, yi + .026, .545], [sgn * .30, yo + .026, .540],
        [sgn * .30, yo - .026, .540], [sgn * .09, yi - .026, .545],
      ];
      out.push({ pts: pts.map(W), col: C.mask ? "rgb(14,12,16)" : hairC });
    };
    browQ(1);
    browQ(-1);
    disc(0, 2.77, .565, .052, `rgb(${Math.round(C.skin[0] * .88)},${Math.round(C.skin[1] * .85)},${Math.round(C.skin[2] * .85)})`);
    // mouth by mood: open worry / huge grin with teeth / gentle smile
    if (mood === "worried") {
      disc(0, 2.60, .550, .10, rgbOf(C.lip), .85);
      disc(0, 2.60, .557, .066, "rgb(70,28,28)", .92);
    } else if (mood === "happy") {
      disc(0, 2.615, .550, .175, rgbOf(C.lip), .68);
      disc(0, 2.63, .554, .12, "rgb(250,248,244)", .30);
      disc(0, 2.70, .557, .185, skinC, .50);
    } else {
      disc(0, 2.615, .550, .115, rgbOf(C.lip), .5);
      disc(0, 2.66, .553, .125, skinC, .45);
    }
    if (C.cheeks || drunk > 0.18) {
      // rosier and rounder with every glass
      const cy = mood === "happy" ? 2.745 : 2.72;
      const cr2 = .075 + drunk * .05;
      const ca2 = Math.min(.8, (C.cheeks ? .35 : .15) + drunk * .5);
      disc(.34, cy, .50, cr2, "rgb(242,120,120)", .8, ca2);
      disc(-.34, cy, .50, cr2, "rgb(242,120,120)", .8, ca2);
      if (drunk > 0.5) disc(0, 2.77, .585, .054, "rgb(228,120,110)");   // the nose too
    }
    if (C.curl) {
      disc(.03, 3.24, .50, .062, hairC);      // the forehead spit-curl
      disc(-.045, 3.17, .52, .046, hairC);
    }
    // chest emblem
    if (C.emblem === "diamond") {
      out.push({ pts: [[0, 1.82, .64], [.24, 1.58, .66], [0, 1.36, .64], [-.24, 1.58, .66]].map(W), col: "rgb(180,40,40)" });
      out.push({ pts: [[0, 1.74, .665], [.16, 1.58, .675], [0, 1.44, .665], [-.16, 1.58, .675]].map(W), col: "rgb(238,196,66)" });
    } else if (C.emblem === "circle") {
      disc(0, 1.60, .625, .15, "rgb(240,140,40)");
      disc(0, 1.60, .635, .085, "rgb(60,26,22)");
    }
    // belt
    if (C.belt) {
      const bc = rgbOf(C.belt);
      out.push({ pts: [[-.52, 1.06, .40], [0, 1.08, .56], [0, .92, .58], [-.52, .90, .42]].map(W), col: bc });
      out.push({ pts: [[0, 1.08, .56], [.52, 1.06, .40], [.52, .90, .42], [0, .92, .58]].map(W), col: bc });
    }

    // arms — gloved for the elastic heroine, bare-handed for the caped one
    const foreRGB = C.gloves || C.skin;
    const foreMat = C.gloves ? M_SUIT : M_SKIN;
    const pushSmooth = (faces, rgb, m) => {
      for (const f of faces) {
        const item = { pts: f.pts, col: shade(rgb, f.n, m) };
        if (f.n0 && f.n1 && f.n0 !== f.n1) {
          item.col0 = shade(rgb, f.n0, m);
          item.col1 = shade(rgb, f.n1, m);
        }
        out.push(item);
      }
    };
    const armFaces = (S, T) => {
      const E = this.solveArm(S, T);
      pushSmooth(this.cylFaces(S, E, .16, .13, 12), C.suit, M_SUIT);
      pushSmooth(this.cylFaces(E, T, .125, .095, 12), foreRGB, foreMat);
      pushSmooth(this.sphereW(T, .155, 12, 7), foreRGB, foreMat);
    };
    // pose-driven arm targets: stretching up, cheering, or flat on the table
    const lerp3 = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
    let poseArm = null;
    if (pose) {
      const rest1 = this.handRestPos(1), restm1 = this.handRestPos(-1);
      if (pose.type === "stretch") {
        const t = pose.t;
        const k0 = t < 0.5 ? t / 0.5 : t > 2.0 ? Math.max(0, (2.5 - t) / 0.5) : 1;
        const k = k0 * k0 * (3 - 2 * k0);
        const up = (sgn) => [fw * (sgn * 0.6 + Math.sin(this.animT * 4 + sgn) * 0.1 * k), 3.95 + lift, cz + fw * 0.12];
        poseArm = { "1": lerp3(rest1, up(1), k), "-1": lerp3(restm1, up(-1), k) };
      } else if (pose.type === "shame") {
        const k = Math.min(1, pose.t / 0.8);
        poseArm = {
          "1": lerp3(rest1, [fw * 0.95, 0.03, cz + fw * 2.3], k),
          "-1": lerp3(restm1, [fw * -0.95, 0.03, cz + fw * 2.3], k),
        };
      } else if (pose.type === "joy") {
        const b = pose.t * 5.2;
        poseArm = {
          "1": [fw * 0.72, 3.7 + lift + Math.sin(b) * 0.35, cz + fw * 0.15],
          "-1": [fw * -0.72, 3.7 + lift + Math.cos(b) * 0.35, cz + fw * 0.15],
        };
      }
    }
    let activeSign = 0;
    if (this.hand && this.hand.handPos) {
      activeSign = Math.sign(this.playerSide * this.hand.fx) || 1;
      armFaces(W([activeSign * .74, 1.94, .10]), this.hand.handPos);
    }
    let sipSign = 0;
    if (this.sip && this.sip.handPos && activeSign !== -1) {
      sipSign = -1;
      armFaces(W([-0.74, 1.94, .10]), this.sip.handPos);
    }
    for (const sgn of [-1, 1]) {
      if (sgn === activeSign || sgn === sipSign) continue;
      const target = poseArm ? poseArm[String(sgn)] : this.handRestPos(sgn);
      armFaces(W([sgn * .74, 1.94, .10]), target);
    }

    // the wine glass (in hand or standing on the table) — Vera takes hers white
    const gp = this.glassPos || this.glassHome();
    const tiltA = (this.glassTilt || 0) * -fw;
    const ca = Math.cos(tiltA), sa = Math.sin(tiltA);
    const wineRGB = C.wine || [128, 20, 38];
    const rotN = (n) => [n[0], n[1] * ca - n[2] * sa, n[1] * sa + n[2] * ca];
    for (const f of this.glassRaw) {
      const pts = f.pts.map(p => [p[0] + gp[0], p[1] * ca - p[2] * sa + gp[1], p[1] * sa + p[2] * ca + gp[2]]);
      const rgb = f.wine ? wineRGB : [204, 218, 226];
      const m = f.wine ? M_WINE : M_GLASS;
      const item = { pts, col: shade(rgb, rotN(f.n), m) };
      if (f.n0 && f.n1 && f.n0 !== f.n1) {
        item.col0 = shade(rgb, rotN(f.n0), m);
        item.col1 = shade(rgb, rotN(f.n1), m);
      }
      out.push(item);
    }
    return out;
  }

  effectivePieces() {
    const names = ' PNBRQK';
    const out = [];
    const animAt = {};
    for (const a of this.anims) animAt[a.to] = a;
    const redirect = {};
    if (this.hand) redirect[this.hand.to] = this.hand;
    for (const q of this.handQueue) redirect[q.to] = q;
    for (let i = 0; i < 64; i++) {
      const p = this.pos.board[i];
      if (!p) continue;
      const kind = names[Math.abs(p)], side = p > 0 ? 1 : -1;
      const rd = redirect[i];
      if (rd) {
        const ph = rd.phase || 'reach';
        if (ph === 'ponder' || ph === 'aha' || ph === 'muse' || ph === 'reach' || ph === 'grab') {
          const w = this.sqWorld(rd.from);
          out.push({ x: w.x, z: w.z, lift: 0, kind, side });
          continue;
        }
        if (ph === 'carry') {
          const hp = rd.handPos;
          out.push({ x: hp[0], z: hp[2], lift: Math.max(0, hp[1] - rd.grabH), kind, side });
          continue;
        }
      }
      const { w, lift } = this.pieceWorld(i, animAt);
      out.push({ x: w.x, z: w.z, lift, kind, side });
    }
    if (this.hand && this.hand.capt && this.hand.phase !== 'put' && this.hand.phase !== 'ret') {
      const w = this.sqWorld(this.hand.captSq);
      out.push({ x: w.x, z: w.z, lift: 0, kind: names[this.hand.capt], side: this.hand.captSide });
    }
    // captured pieces stand beside the board as trophies
    const trophyRow = (caps, pieceSide, ownerSign) => {
      for (let i = 0; i < Math.min(caps.length, 15); i++) {
        const col = i % 3, row = (i / 3) | 0;
        out.push({
          x: ownerSign * (4.85 + col * 0.62),
          z: ownerSign * (0.85 + row * 0.68),
          lift: 0,
          kind: names[caps[i]],
          side: pieceSide,
        });
      }
    };
    const capsMine = this.playerSide === 1 ? this.capsByWhite : this.capsByBlack;
    const capsCpu = this.playerSide === 1 ? this.capsByBlack : this.capsByWhite;
    trophyRow(capsMine, -this.playerSide, this.playerSide);
    trophyRow(capsCpu, this.playerSide, -this.playerSide);
    return out;
  }

  // character polygons + piece billboards, depth-sorted together
  drawSolids(ctx) {
    const view = { target: [0, 0.15, 0], cx: 336, cy: 398, focal: 680 };
    const basis = this.camBasis(this.cam, view.target);
    const items = [];
    for (const f of this.charFaces()) {
      const pp = [];
      let z = 0, ok = true;
      for (const p of f.pts) {
        const pr = this.projectPoint(p, basis, view);
        if (pr.z < 0.3) { ok = false; break; }
        pp.push([pr.x, pr.y]);
        z += pr.z;
      }
      if (!ok) continue;
      items.push({ poly: true, z: z / f.pts.length, pp, col: f.col, alpha: f.alpha });
    }
    for (const pc of this.effectivePieces()) {
      const pr = this.projectPoint([pc.x, pc.lift, pc.z], basis, view);
      if (pr.z < 0.5) continue;
      const imp = this.impostors[(pc.side === 1 ? 'w' : 'b') + pc.kind];
      if (!imp) continue;
      const s = (680 / pr.z) / imp.pxPerWorld;
      items.push({
        poly: false, z: pr.z, img: imp.cnv,
        x: pr.x - imp.baseX * s, y: pr.y - imp.baseY * s,
        w: imp.cnv.width * s, h: imp.cnv.height * s,
      });
    }
    items.sort((a, b) => b.z - a.z);
    for (const it of items) {
      if (!it.poly) {
        ctx.drawImage(it.img, it.x, it.y, it.w, it.h);
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(it.pp[0][0], it.pp[0][1]);
      for (let i = 1; i < it.pp.length; i++) ctx.lineTo(it.pp[i][0], it.pp[i][1]);
      ctx.closePath();
      let fill = it.col;
      if (it.col0 && it.pp.length === 4) {
        // smooth shading across curved surfaces (goodbye, folded paper)
        const m0x = (it.pp[0][0] + it.pp[3][0]) / 2, m0y = (it.pp[0][1] + it.pp[3][1]) / 2;
        const m1x = (it.pp[1][0] + it.pp[2][0]) / 2, m1y = (it.pp[1][1] + it.pp[2][1]) / 2;
        if (Math.hypot(m1x - m0x, m1y - m0y) > 2.5) {
          fill = ctx.createLinearGradient(m0x, m0y, m1x, m1y);
          fill.addColorStop(0, it.col0);
          fill.addColorStop(1, it.col1);
        }
      }
      if (it.alpha != null) ctx.globalAlpha = it.alpha;
      ctx.fillStyle = fill;
      ctx.fill();
      if (it.alpha != null) {
        ctx.globalAlpha = 1;
      } else {
        ctx.strokeStyle = fill;
        ctx.lineWidth = 0.7;
        ctx.stroke();
      }
    }
  }

  draw() {
    const ctx = this.ctx;
    ctx.setTransform(this.RS, 0, 0, this.RS, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    const bg = ctx.createLinearGradient(0, 0, 0, 768);
    bg.addColorStop(0, '#23262e');
    bg.addColorStop(0.55, '#14161c');
    bg.addColorStop(1, '#08090c');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 672, 768);
    const glow = ctx.createRadialGradient(300, 420, 60, 300, 420, 430);
    glow.addColorStop(0, 'rgba(255,216,150,0.11)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, 672, 768);

    this.ensureImpostors();
    const mainView = { target: [0, 0.15, 0], cx: 336, cy: 398, focal: 680 };
    this.renderFaces(ctx, this.floorFaces, this.cam, mainView);
    this.renderFaces(ctx, this.tableFaces, this.cam, mainView);
    this.renderFaces(ctx, this.sceneFaces(), this.cam, mainView);
    this.drawSolids(ctx);

    // rim coordinate labels
    ctx.textAlign = 'center';
    const basis = this.camBasis(this.cam, [0, 0.15, 0]);
    const view = { target: [0, 0.15, 0], cx: 336, cy: 398, focal: 680 };
    const label = (wx, wz, txt) => {
      const pr = this.projectPoint([wx, 0.03, wz], basis, view);
      if (pr.z < 1) return;
      const size = Math.max(6, 110 / pr.z);
      ctx.font = `bold ${size.toFixed(1)}px "Courier New", monospace`;
      ctx.fillStyle = 'rgba(250,232,190,0.55)';
      ctx.fillText(txt, pr.x, pr.y);
    };
    for (let c = 0; c < 8; c++) {
      label(c - 3.5, 4.33, 'ABCDEFGH'[c]);
      label(c - 3.5, -4.33, 'ABCDEFGH'[c]);
    }
    for (let r = 0; r < 8; r++) {
      label(-4.33, r - 3.5, String(8 - r));
      label(4.33, r - 3.5, String(8 - r));
    }

    // header
    retroText(ctx, 'CHESS', 48, 14, 28, '#f2e2b8');
    retroText(ctx, 'WINS ' + this.wins, 624, 12, 13, '#8a8f9c', 'right');
    retroText(ctx, 'LEVEL: ' + ['EASY', 'NORMAL', 'HARD'][this.levelIdx] + ' (L)', 624, 30, 13, '#8a8f9c', 'right');
    if (this.state !== 'pick') {
      retroText(ctx, 'YOU PLAY: ' + (this.playerSide === 1 ? 'WHITE' : 'BLACK'), 624, 48, 13, '#c8b47e', 'right');
    }
    retroText(ctx, 'VS ' + CH_CHARS[this.charKey].name + ' (C)', 624, 66, 12, '#8a8f9c', 'right');
    let dots = '';
    if (this.state === 'thinking') dots = '.'.repeat(1 + (Math.floor(this.animT * 3) % 3));
    let sc = '#aab';
    if (this.status.includes('YOU WIN')) sc = '#33ff44';
    else if (this.status.includes('CPU WINS')) sc = '#ff3355';
    else if (this.status.includes('CHECK')) sc = '#ffcc44';
    else if (this.status.includes('DRAW') || this.status.includes('STALEMATE')) sc = '#66ccff';
    retroText(ctx, this.status + dots, 48, 52, 17, sc);

    // filmic vignette
    const vg = ctx.createRadialGradient(336, 400, 280, 336, 400, 580);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.36)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, 672, 768);

    retroText(ctx, 'CLICK OR ARROWS+ENTER · U UNDO · P PAUSE · L LEVEL · N NEW · C OPPONENT', 336, 730, 11, '#667', 'center');
    retroText(ctx, 'DRAG ROTATE · SCROLL ZOOM · Q/E TURN · R/F TILT · V RESET VIEW', 336, 748, 11, '#556', 'center');

    if (this.state === 'pick') this.drawPick(ctx);
    else if (this.paused) this.drawPanel(ctx, 'PAUSED', 'P = RESUME', '#f2e2b8');
    else if (this.state === 'over') this.drawPanel(ctx, this.result, 'N = NEW GAME (YOU SWAP COLOURS) · U = UNDO', sc);
  }

  drawPanel(ctx, title, sub, colour) {
    ctx.fillStyle = 'rgba(5,6,10,0.55)';
    ctx.fillRect(0, 90, 672, 580);
    this.rr(ctx, 86, 330, 500, 130, 12);
    ctx.fillStyle = 'rgba(12,14,22,0.95)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(242,226,184,0.4)';
    ctx.lineWidth = 1.5;
    this.rr(ctx, 86, 330, 500, 130, 12);
    ctx.stroke();
    retroText(ctx, title, 336, 372, 20, colour, 'center');
    retroText(ctx, sub, 336, 410, 12, '#aab', 'center');
  }

  drawPick(ctx) {
    ctx.fillStyle = 'rgba(5,6,10,0.6)';
    ctx.fillRect(0, 90, 672, 580);
    this.rr(ctx, 106, 226, 460, 340, 14);
    ctx.fillStyle = 'rgba(12,14,22,0.94)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(242,226,184,0.4)';
    ctx.lineWidth = 1.5;
    this.rr(ctx, 106, 226, 460, 340, 14);
    ctx.stroke();

    retroText(ctx, 'CHOOSE YOUR SIDE', 336, 252, 20, '#f2e2b8', 'center');

    const opts = [
      { side: 1, x: 156, label: 'WHITE', spr: this.sprites.wK },
      { side: -1, x: 356, label: 'BLACK', spr: this.sprites.bK },
    ];
    for (const o of opts) {
      const on = this.pickSide === o.side;
      const y = 396;
      this.rr(ctx, o.x, y, 160, 170, 10);
      ctx.fillStyle = on ? 'rgba(60,55,35,0.9)' : 'rgba(22,24,34,0.9)';
      ctx.fill();
      ctx.strokeStyle = on ? '#ffd24d' : '#3a3f50';
      ctx.lineWidth = on ? 3 : 1.5;
      this.rr(ctx, o.x, y, 160, 170, 10);
      ctx.stroke();
      ctx.drawImage(o.spr, o.x + 22, y + 8, 116, 116);
      retroText(ctx, o.label, o.x + 80, y + 134, 16, on ? '#ffd24d' : '#99a', 'center');
    }
    if (Math.floor(this.animT * 1.6) % 2 === 0) {
      retroText(ctx, '← → CHOOSE   ·   ENTER TO PLAY   ·   OR CLICK', 336, 300, 13, '#ffe14d', 'center');
    }
    retroText(ctx, 'SIDES ALTERNATE EACH NEW GAME', 336, 322, 11, '#8a8f9c', 'center');
    retroText(ctx, 'OPPONENT: ' + CH_CHARS[this.charKey].name + '  —  PRESS C TO SWAP', 336, 344, 12, '#c8b47e', 'center');
  }

  dispose() {
    this.dead = true;
    if (this.thinkTimer) { clearTimeout(this.thinkTimer); this.thinkTimer = null; }
    this.canvas.removeEventListener('mousedown', this.onDown);
    window.removeEventListener('mousemove', this.onMove);
    window.removeEventListener('mouseup', this.onUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('touchstart', this.onTS);
    this.canvas.removeEventListener('touchmove', this.onTM);
    this.canvas.removeEventListener('touchend', this.onTE);
    this.canvas.removeEventListener('touchcancel', this.onTE);
    this.canvas.style.imageRendering = '';
    try { this.canvas.style.cursor = ''; } catch (e) {}
    try {
      const fr = document.getElementById('frame');
      if (fr && fr.classList) fr.classList.remove('no-scan');
    } catch (e) {}
  }
}
