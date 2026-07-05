/* pacman.js — Pac-Man. Maze 28x31 tiles of 8px (224x248), 16px HUD bands top+bottom, drawn at 3x. */
'use strict';

const PAC_MAZE = [
  '############################',
  '#............##............#',
  '#.####.#####.##.#####.####.#',
  '#o####.#####.##.#####.####o#',
  '#.####.#####.##.#####.####.#',
  '#..........................#',
  '#.####.##.########.##.####.#',
  '#.####.##.########.##.####.#',
  '#......##....##....##......#',
  '######.##### ## #####.######',
  '     #.##### ## #####.#     ',
  '     #.##          ##.#     ',
  '     #.## ###--### ##.#     ',
  '######.## #      # ##.######',
  '      .   #      #   .      ',
  '######.## #      # ##.######',
  '     #.## ######## ##.#     ',
  '     #.##          ##.#     ',
  '     #.## ######## ##.#     ',
  '######.## ######## ##.######',
  '#............##............#',
  '#.####.#####.##.#####.####.#',
  '#.####.#####.##.#####.####.#',
  '#o..##................##..o#',
  '###.##.##.########.##.##.###',
  '###.##.##.########.##.##.###',
  '#......##....##....##......#',
  '#.##########.##.##########.#',
  '#.##########.##.##########.#',
  '#..........................#',
  '############################',
];

class PacmanGame {
  constructor(api) {
    this.api = api;
    api.canvas.width = 672;
    api.canvas.height = 840;
    this.ctx = api.ctx;
    this.S = 3;
    this.W = 224;             // maze pixel size
    this.MH = 248;
    this.OY = 16;             // maze y-offset (HUD band)

    this.buildWalkGrid();
    this.mazeBlue = this.renderMaze('#2121de', '#ffb8de');
    this.mazeWhite = this.renderMaze('#dedeff', '#ffb8de');

    this.siren = Sfx.makeWarble({ f: 360, depth: 45, rate: 2.2, type: 'sawtooth', vol: 0.045 });
    this.frightLoop = Sfx.makeWarble({ f: 210, depth: 130, rate: 9, type: 'square', vol: 0.05 });

    this.hi = loadHi('pacman');
    this.newGame();
  }

  /* ---------- board ---------- */

  buildWalkGrid() {
    const open = (c) => c === '.' || c === 'o' || c === ' ' || c === '-';
    this.walk = [];
    this.doorTile = [];
    for (let y = 0; y < 31; y++) {
      this.walk.push(new Array(28).fill(false));
      this.doorTile.push(new Array(28).fill(false));
    }
    // flood fill from pac spawn so decorative out-of-bounds gaps stay solid
    const q = [[13, 23]];
    const seen = new Set(['13,23']);
    while (q.length) {
      const [x, y] = q.pop();
      this.walk[y][x] = true;
      if (PAC_MAZE[y][x] === '-') this.doorTile[y][x] = true;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = ((x + dx) % 28 + 28) % 28, ny = y + dy;
        if (ny < 0 || ny > 30) continue;
        if (!open(PAC_MAZE[ny][nx])) continue;
        const k = nx + ',' + ny;
        if (!seen.has(k)) { seen.add(k); q.push([nx, ny]); }
      }
    }
  }

  canPass(tx, ty) {
    tx = ((tx % 28) + 28) % 28;
    if (ty < 0 || ty > 30) return false;
    return this.walk[ty][tx] && !this.doorTile[ty][tx];
  }

  resetDots() {
    this.dots = [];
    this.totalDots = 0;
    for (let y = 0; y < 31; y++) {
      const row = new Array(28).fill(0);
      for (let x = 0; x < 28; x++) {
        if (PAC_MAZE[y][x] === '.') { row[x] = 1; this.totalDots++; }
        if (PAC_MAZE[y][x] === 'o') { row[x] = 2; this.totalDots++; }
      }
      this.dots.push(row);
    }
    this.dotsRemaining = this.totalDots;
  }

  renderMaze(wallColor, doorColor) {
    const c = document.createElement('canvas');
    c.width = this.W; c.height = this.MH;
    const g = c.getContext('2d');
    g.fillStyle = wallColor;
    const isWall = (x, y) => x >= 0 && x < 28 && y >= 0 && y < 31 && PAC_MAZE[y][x] === '#';
    for (let y = 0; y < 31; y++) {
      for (let x = 0; x < 28; x++) {
        if (!isWall(x, y)) continue;
        const px = x * 8, py = y * 8;
        g.fillRect(px + 3, py + 3, 2, 2);
        if (isWall(x + 1, y)) g.fillRect(px + 5, py + 3, 3, 2);
        if (isWall(x - 1, y)) g.fillRect(px, py + 3, 3, 2);
        if (isWall(x, y + 1)) g.fillRect(px + 3, py + 5, 2, 3);
        if (isWall(x, y - 1)) g.fillRect(px + 3, py, 2, 3);
      }
    }
    // ghost house door
    g.fillStyle = doorColor;
    g.fillRect(13 * 8, 12 * 8 + 3, 16, 2);
    return c;
  }

  /* ---------- game lifecycle ---------- */

  newGame() {
    this.score = 0;
    this.lives = 3;
    this.level = 1;
    this.extraGiven = false;
    this.paused = false;
    this.popups = [];
    this.resetDots();
    this.resetPositions();
    this.state = 'ready';
    this.stateT = Sfx.playSeq(PacmanGame.JINGLE, 0.066, { vol: 0.35, gap: 0.95 }) + 0.4;
    if (this.stateT < 2) this.stateT = 2;
  }

  nextLevel() {
    this.level++;
    this.resetDots();
    this.resetPositions();
    this.state = 'ready';
    this.stateT = 1.8;
  }

  resetPositions() {
    this.pac = { x: 112, y: 188, dir: { x: -1, y: 0 }, allowStop: true };
    this.desired = { x: -1, y: 0 };
    this.pacMoving = true;
    this.animT = 0;
    this.ghosts = [
      { id: 'blinky', color: '#ff0000', x: 112, y: 92, dir: { x: -1, y: 0 }, mode: 'out', fright: false, scatter: { x: 25, y: 0 }, dotLimit: 0, released: true },
      { id: 'pinky', color: '#ffb8ff', x: 112, y: 116, dir: { x: 0, y: -1 }, mode: 'home', fright: false, scatter: { x: 2, y: 0 }, dotLimit: 0, released: false, bob: 1 },
      { id: 'inky', color: '#00ffff', x: 96, y: 116, dir: { x: 0, y: -1 }, mode: 'home', fright: false, scatter: { x: 27, y: 30 }, dotLimit: 30, released: false, bob: -1 },
      { id: 'clyde', color: '#ffb852', x: 128, y: 116, dir: { x: 0, y: -1 }, mode: 'home', fright: false, scatter: { x: 0, y: 30 }, dotLimit: 60, released: false, bob: 1 },
    ];
    this.modeIdx = 0;
    this.modeT = PacmanGame.SCHEDULE[0][0];
    this.frightT = 0;
    this.eatChain = 0;
    this.freezeT = 0;
    this.lastDotT = 0;
    this.dotsEaten = this.dotsEaten || 0;
    if (this.dotsRemaining === this.totalDots) this.dotsEaten = 0;
    this.fruit = null;
    this.wakaHi = false;
  }

  static get SCHEDULE() {
    return [[7, 'scatter'], [20, 'chase'], [7, 'scatter'], [20, 'chase'], [5, 'scatter'], [20, 'chase'], [5, 'scatter'], [Infinity, 'chase']];
  }

  get mode() { return PacmanGame.SCHEDULE[this.modeIdx][1]; }

  /* ---------- movement core ---------- */

  tileOf(e) { return { x: ((Math.floor(e.x / 8) % 28) + 28) % 28, y: Math.floor(e.y / 8) }; }

  wrapX(e) {
    if (e.x < 0) e.x += 224;
    if (e.x >= 224) e.x -= 224;
  }

  // Advance entity `dist` px along its dir; `decide(e)` is called at each tile
  // center it lands on and returns false to halt.
  step(e, dist, decide) {
    let guard = 0;
    while (dist > 1e-4 && guard++ < 80) {
      const t = this.tileOf(e);
      const cx = Math.floor(e.x / 8) * 8 + 4, cy = t.y * 8 + 4;
      const atCx = Math.abs(e.x - cx) < 1e-3, atCy = Math.abs(e.y - cy) < 1e-3;
      if (atCx && atCy) {
        if (!decide(e)) return;
        const nx = t.x + e.dir.x, ny = t.y + e.dir.y;
        if (!this.canPass(nx, ny)) return;
        const d = Math.min(dist, 8);
        e.x += e.dir.x * d; e.y += e.dir.y * d;
        this.wrapX(e);
        dist -= d;
      } else {
        const along = (cx - e.x) * e.dir.x + (cy - e.y) * e.dir.y;
        if (along > 1e-4) {
          const d = Math.min(dist, along);
          e.x += e.dir.x * d; e.y += e.dir.y * d;
          dist -= d;
          if (d >= along - 1e-4) { e.x = cx; e.y = cy; }
        } else {
          // between centers, moving away: run to the next center
          const rem = 8 + along;      // along is negative distance past center
          const d = Math.min(dist, Math.max(rem, 0.5));
          e.x += e.dir.x * d; e.y += e.dir.y * d;
          this.wrapX(e);
          dist -= d;
        }
      }
    }
  }

  pacDecide(p) {
    const t = this.tileOf(p);
    if (this.desired && this.canPass(t.x + this.desired.x, t.y + this.desired.y)) {
      p.dir = { x: this.desired.x, y: this.desired.y };
      this.pacMoving = true;
      return true;
    }
    if (this.canPass(t.x + p.dir.x, t.y + p.dir.y)) { this.pacMoving = true; return true; }
    this.pacMoving = false;
    return false;
  }

  ghostTarget(g) {
    if (g.mode === 'eyes') return { x: 13, y: 11 };
    if (this.mode === 'scatter') return g.scatter;
    const pt = this.tileOf(this.pac), pd = this.pac.dir;
    switch (g.id) {
      case 'blinky': return pt;
      case 'pinky': return { x: pt.x + pd.x * 4, y: pt.y + pd.y * 4 };
      case 'inky': {
        const b = this.ghosts[0], bt = this.tileOf(b);
        const ax = pt.x + pd.x * 2, ay = pt.y + pd.y * 2;
        return { x: 2 * ax - bt.x, y: 2 * ay - bt.y };
      }
      case 'clyde': {
        const d2 = (pt.x - this.tileOf(g).x) ** 2 + (pt.y - this.tileOf(g).y) ** 2;
        return d2 > 64 ? pt : g.scatter;
      }
    }
    return pt;
  }

  ghostDecide(g) {
    const t = this.tileOf(g);
    if (g.mode === 'eyes' && t.y === 11 && (t.x === 13 || t.x === 14)) {
      g.mode = 'entering';
      g.x = 112; g.y = 92;
      return false;
    }
    const dirs = [{ x: 0, y: -1 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 0 }];
    const opts = [];
    for (const d of dirs) {
      if (d.x === -g.dir.x && d.y === -g.dir.y) continue;
      if (this.canPass(t.x + d.x, t.y + d.y)) opts.push(d);
    }
    if (!opts.length) { g.dir = { x: -g.dir.x, y: -g.dir.y }; return true; }
    if (g.fright && g.mode !== 'eyes') {
      g.dir = opts[Math.floor(Math.random() * opts.length)];
      return true;
    }
    const tgt = this.ghostTarget(g);
    let best = opts[0], bestD = Infinity;
    for (const d of opts) {
      const dd = (t.x + d.x - tgt.x) ** 2 + (t.y + d.y - tgt.y) ** 2;
      if (dd < bestD) { bestD = dd; best = d; }
    }
    g.dir = best;
    return true;
  }

  ghostSpeed(g) {
    const lvl = Math.min(1.22, 1 + (this.level - 1) * 0.035);
    if (g.mode === 'eyes') return 125;
    const t = this.tileOf(g);
    if (t.y === 14 && (t.x < 6 || t.x > 21)) return 33 * lvl;   // tunnel crawl
    if (g.fright) return 37 * lvl;
    return 57 * lvl;
  }

  /* ---------- events ---------- */

  key(e, down) {
    if (!down) return;
    const map = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 },
                  KeyA: { x: -1, y: 0 }, KeyD: { x: 1, y: 0 }, KeyW: { x: 0, y: -1 }, KeyS: { x: 0, y: 1 } };
    if (map[e.code]) this.desired = map[e.code];
    if (e.code === 'KeyP' && this.state !== 'over') {
      this.paused = !this.paused;
      this.syncLoops();
    }
    if (e.code === 'Enter' && this.state === 'over') this.newGame();
  }

  addScore(n) {
    this.score += n;
    if (!this.extraGiven && this.score >= 10000) {
      this.extraGiven = true;
      this.lives++;
      Sfx.playSeq([['C5', 1], ['E5', 1], ['G5', 1], ['C6', 1], ['E6', 2]], 0.08, { vol: 0.4 });
    }
    if (this.score > this.hi) { this.hi = this.score; saveHi('pacman', this.hi); }
  }

  eatDotAt(t) {
    const kind = this.dots[t.y][t.x];
    if (!kind) return;
    this.dots[t.y][t.x] = 0;
    this.dotsRemaining--;
    this.dotsEaten++;
    this.lastDotT = 0;
    this.wakaHi = !this.wakaHi;
    if (this.wakaHi) Sfx.tone({ f: 230, f1: 540, type: 'square', dur: 0.07, vol: 0.25 });
    else Sfx.tone({ f: 540, f1: 230, type: 'square', dur: 0.07, vol: 0.25 });
    if (kind === 2) {
      this.addScore(50);
      this.frightT = Math.max(1.5, 8 - this.level);
      this.eatChain = 0;
      for (const g of this.ghosts) {
        if (g.mode === 'eyes' || g.mode === 'entering') continue;
        g.fright = true;
        if (g.mode === 'out') g.dir = { x: -g.dir.x, y: -g.dir.y };
      }
    } else {
      this.addScore(10);
    }
    if ((this.dotsEaten === 70 || this.dotsEaten === 170) && !this.fruit) {
      this.fruit = { t: 9.5 };
    }
    if (this.dotsRemaining === 0) {
      this.state = 'clear';
      this.stateT = 0;
      this.syncLoops();
      Sfx.playSeq([['C5', 1], ['G5', 1], ['C6', 2]], 0.09, { vol: 0.35 });
    }
  }

  killPac() {
    this.state = 'dying';
    this.stateT = 0;
    this.syncLoops();
  }

  deathSound() {
    const t0 = Sfx.time;
    for (let k = 0; k < 5; k++) {
      Sfx.tone({ f: 640 - k * 88, f1: Math.max(60, 210 - k * 25), type: 'sawtooth', dur: 0.2, vol: 0.32, at: t0 + k * 0.18 });
    }
    Sfx.tone({ f: 110, f1: 460, type: 'square', dur: 0.12, vol: 0.38, at: t0 + 1.0 });
    Sfx.tone({ f: 110, f1: 460, type: 'square', dur: 0.12, vol: 0.38, at: t0 + 1.18 });
  }

  syncLoops() {
    const active = this.state === 'play' && !this.paused && this.freezeT <= 0;
    if (!active) { this.siren.stop(); this.frightLoop.stop(); return; }
    const anyFright = this.ghosts.some(g => g.fright && g.mode !== 'eyes' && g.mode !== 'entering');
    if (anyFright) {
      this.siren.stop();
      if (!this.frightLoop.playing) this.frightLoop.start();
    } else {
      this.frightLoop.stop();
      if (!this.siren.playing) this.siren.start();
      const prog = 1 - this.dotsRemaining / this.totalDots;
      this.siren.set(340 + prog * 240);
    }
  }

  /* ---------- update ---------- */

  update(dt) {
    if (this.paused) return;
    this.animT += dt;
    for (let i = this.popups.length - 1; i >= 0; i--) {
      this.popups[i].t -= dt;
      if (this.popups[i].t <= 0) this.popups.splice(i, 1);
    }

    if (this.state === 'ready') {
      this.stateT -= dt;
      if (this.stateT <= 0) { this.state = 'play'; this.syncLoops(); }
      return;
    }
    if (this.state === 'dying') {
      this.stateT += dt;
      if (this.stateT > 0.9 && !this.deathSoundPlayed) { this.deathSoundPlayed = true; this.deathSound(); }
      if (this.stateT >= 2.5) {
        this.deathSoundPlayed = false;
        this.lives--;
        if (this.lives <= 0) {
          this.state = 'over';
        } else {
          this.resetPositions();
          this.state = 'ready';
          this.stateT = 1.6;
        }
      }
      return;
    }
    if (this.state === 'clear') {
      this.stateT += dt;
      if (this.stateT >= 2.4) this.nextLevel();
      return;
    }
    if (this.state !== 'play') return;

    if (this.freezeT > 0) {
      this.freezeT -= dt;
      if (this.freezeT <= 0) this.syncLoops();
      return;
    }

    const lvl = Math.min(1.2, 1 + (this.level - 1) * 0.03);
    const anyFright = this.ghosts.some(g => g.fright);

    // instant reversal
    if (this.desired.x === -this.pac.dir.x && this.desired.y === -this.pac.dir.y &&
        (this.desired.x || this.desired.y)) {
      this.pac.dir = { x: this.desired.x, y: this.desired.y };
      this.pacMoving = true;
    }
    const pacSpeed = (anyFright ? 66 : 61) * lvl;
    if (this.pacMoving || this.pacDecide(this.pac)) {
      this.step(this.pac, pacSpeed * dt, (p) => this.pacDecide(p));
    }
    this.eatDotAt(this.tileOf(this.pac));
    if (this.state !== 'play') return;

    // fright timer
    if (this.frightT > 0) {
      this.frightT -= dt;
      if (this.frightT <= 0) {
        for (const g of this.ghosts) g.fright = false;
        this.eatChain = 0;
        this.syncLoops();
      }
    } else {
      // scatter/chase schedule
      this.modeT -= dt;
      if (this.modeT <= 0 && this.modeIdx < PacmanGame.SCHEDULE.length - 1) {
        this.modeIdx++;
        this.modeT = PacmanGame.SCHEDULE[this.modeIdx][0];
        for (const g of this.ghosts) {
          if (g.mode === 'out' && !g.fright) g.dir = { x: -g.dir.x, y: -g.dir.y };
        }
      }
    }

    // ghost-house release
    this.lastDotT += dt;
    const pending = this.ghosts.find(g => g.mode === 'home' && !g.released);
    if (pending && (this.dotsEaten >= pending.dotLimit || this.lastDotT > 4)) {
      pending.released = true;
      this.lastDotT = 0;
    }

    // ghosts
    for (const g of this.ghosts) {
      if (g.mode === 'home') {
        g.y += g.bob * 22 * dt;
        if (g.y > 119) { g.y = 119; g.bob = -1; }
        if (g.y < 113) { g.y = 113; g.bob = 1; }
        if (g.released && Math.abs(g.y - 116) < 1.5) { g.mode = 'leaving'; g.y = 116; }
      } else if (g.mode === 'leaving') {
        if (Math.abs(g.x - 112) > 1) {
          g.x += Math.sign(112 - g.x) * 38 * dt;
        } else {
          g.x = 112;
          g.y -= 38 * dt;
          if (g.y <= 92) { g.y = 92; g.mode = 'out'; g.dir = Math.random() < 0.5 ? { x: -1, y: 0 } : { x: 1, y: 0 }; }
        }
      } else if (g.mode === 'entering') {
        if (g.y < 116) {
          g.y += 90 * dt;
          if (g.y >= 116) {
            g.y = 116;
            g.mode = 'home';
            g.fright = false;
            g.released = true;
            g.bob = 1;
            this.syncLoops();
          }
        }
      } else {
        this.step(g, this.ghostSpeed(g) * dt, (gg) => this.ghostDecide(gg));
      }
    }

    // fruit
    if (this.fruit) {
      this.fruit.t -= dt;
      if (this.fruit.t <= 0) this.fruit = null;
      else if (Math.abs(this.pac.x - 112) < 6 && Math.abs(this.pac.y - 140) < 6) {
        const pts = [100, 300, 500, 700, 1000][Math.min(this.level - 1, 4)];
        this.addScore(pts);
        this.popups.push({ x: 112, y: 140, txt: String(pts), t: 1.4, color: '#ffb8de' });
        this.fruit = null;
        Sfx.tone({ f: 500, f1: 1200, type: 'square', dur: 0.25, vol: 0.35, curve: 'lin' });
      }
    }

    // pac vs ghosts
    for (const g of this.ghosts) {
      if (g.mode !== 'out') continue;
      const dx = g.x - this.pac.x, dy = g.y - this.pac.y;
      if (dx * dx + dy * dy > 36) continue;
      if (g.fright) {
        const pts = 200 * Math.pow(2, this.eatChain);
        this.eatChain = Math.min(3, this.eatChain + 1);
        this.addScore(pts);
        this.popups.push({ x: g.x, y: g.y, txt: String(pts), t: 1.1, color: '#00ffff' });
        g.mode = 'eyes';
        g.fright = false;
        this.freezeT = 0.45;
        this.siren.stop(); this.frightLoop.stop();
        Sfx.tone({ f: 190, f1: 950, type: 'square', dur: 0.3, vol: 0.45, curve: 'lin' });
        return;
      }
      this.killPac();
      return;
    }

    this.syncLoops();
  }

  /* ---------- draw ---------- */

  drawPacShape(ctx, x, y, dir, mouth, r = 6.5) {
    const base = dir.x === -1 ? Math.PI : dir.y === -1 ? -Math.PI / 2 : dir.y === 1 ? Math.PI / 2 : 0;
    ctx.fillStyle = '#ffe14d';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.arc(x, y, r, base + mouth, base - mouth + Math.PI * 2);
    ctx.closePath();
    ctx.fill();
  }

  drawGhost(ctx, g) {
    const x = g.x, y = g.y + this.OY;
    const eyesOnly = g.mode === 'eyes' || g.mode === 'entering';
    if (!eyesOnly) {
      let body = g.color;
      let flashWhite = false;
      if (g.fright) {
        flashWhite = this.frightT < 2 && Math.floor(this.animT * 5) % 2 === 0;
        body = flashWhite ? '#dedeff' : '#2121de';
      }
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.arc(x, y - 0.5, 6.2, Math.PI, 0);
      ctx.lineTo(x + 6.2, y + 5.2);
      ctx.lineTo(x + 4.1, y + 3.2);
      ctx.lineTo(x + 2.1, y + 5.2);
      ctx.lineTo(x, y + 3.2);
      ctx.lineTo(x - 2.1, y + 5.2);
      ctx.lineTo(x - 4.1, y + 3.2);
      ctx.lineTo(x - 6.2, y + 5.2);
      ctx.closePath();
      ctx.fill();
      if (g.fright) {
        const fc = flashWhite ? '#ff3355' : '#ffb8ae';
        ctx.fillStyle = fc;
        ctx.fillRect(x - 3.5, y - 2, 2, 2);
        ctx.fillRect(x + 1.5, y - 2, 2, 2);
        ctx.beginPath();
        ctx.strokeStyle = fc;
        ctx.lineWidth = 1;
        ctx.moveTo(x - 4.5, y + 3);
        for (let i = 0; i < 4; i++) {
          ctx.lineTo(x - 3.4 + i * 2.25, y + 1.8);
          ctx.lineTo(x - 2.2 + i * 2.25, y + 3);
        }
        ctx.stroke();
        return;
      }
    }
    // eyes
    const ox = g.dir.x * 1.4, oy = g.dir.y * 1.4;
    ctx.fillStyle = '#fff';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(x + s * 2.6 + ox, y - 1.5 + oy, 1.7, 2.2, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#2121de';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(x + s * 2.6 + ox * 1.6, y - 1.5 + oy * 1.6, 1, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawCherry(ctx, x, y) {
    ctx.strokeStyle = '#33ff44';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 3, y - 5);
    ctx.quadraticCurveTo(x - 1, y - 4, x - 2.5, y + 1);
    ctx.moveTo(x + 3, y - 5);
    ctx.quadraticCurveTo(x + 2.5, y - 2, x + 2.5, y + 2);
    ctx.stroke();
    ctx.fillStyle = '#ff3355';
    ctx.beginPath(); ctx.arc(x - 2.5, y + 2.5, 2.4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 2.5, y + 3, 2.4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffb8de';
    ctx.fillRect(x - 3.4, y + 1.6, 1, 1);
    ctx.fillRect(x + 1.6, y + 2.1, 1, 1);
  }

  draw() {
    const ctx = this.ctx, S = this.S;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 672, 840);
    ctx.setTransform(S, 0, 0, S, 0, 0);
    ctx.imageSmoothingEnabled = false;

    // maze (flashes on level clear)
    let maze = this.mazeBlue;
    if (this.state === 'clear' && this.stateT > 0.4 && Math.floor(this.stateT * 5) % 2 === 0) {
      maze = this.mazeWhite;
    }
    ctx.drawImage(maze, 0, this.OY);

    // pellets
    ctx.fillStyle = '#ffb8ae';
    const blinkOn = Math.floor(this.animT * 4) % 2 === 0;
    for (let y = 0; y < 31; y++) {
      for (let x = 0; x < 28; x++) {
        const k = this.dots[y][x];
        if (k === 1) {
          ctx.fillRect(x * 8 + 3, this.OY + y * 8 + 3, 2, 2);
        } else if (k === 2 && blinkOn) {
          ctx.beginPath();
          ctx.arc(x * 8 + 4, this.OY + y * 8 + 4, 3, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#ffb8ae';
        }
      }
    }

    // fruit
    if (this.fruit) this.drawCherry(ctx, 112, this.OY + 140);

    // pac-man
    const showGhosts = !(this.state === 'dying' && this.stateT > 0.9) && this.state !== 'clear';
    if (this.state === 'dying' && this.stateT > 0.9) {
      const t = Math.min(1, (this.stateT - 0.9) / 1.4);
      const mouth = 0.2 + t * (Math.PI - 0.2);
      if (t < 1) this.drawPacShape(ctx, this.pac.x, this.pac.y + this.OY, { x: 0, y: -1 }, mouth);
    } else if (this.state !== 'over') {
      const mouth = this.pacMoving ? 0.12 + 0.75 * Math.abs(Math.sin(this.animT * 11)) : 0.55;
      this.drawPacShape(ctx, this.pac.x, this.pac.y + this.OY, this.pac.dir, mouth);
    }

    // ghosts
    if (showGhosts && this.state !== 'over') {
      for (const g of this.ghosts) this.drawGhost(ctx, g);
    }

    // popups
    for (const p of this.popups) {
      retroText(ctx, p.txt, p.x, p.y + this.OY - 3, 7, p.color || '#00ffff', 'center');
    }

    // HUD
    retroText(ctx, '1UP', 24, 1, 8, '#fff');
    retroText(ctx, String(this.score).padStart(4, '0'), 24, 9, 8, '#ffe14d');
    retroText(ctx, 'HI SCORE', 112, 1, 8, '#fff', 'center');
    retroText(ctx, String(this.hi).padStart(4, '0'), 112, 9, 8, '#ff3355', 'center');
    retroText(ctx, 'LEVEL ' + this.level, 218, 5, 8, '#fff', 'right');

    // lives + fruit band
    for (let i = 0; i < Math.min(this.lives - 1, 5); i++) {
      this.drawPacShape(ctx, 14 + i * 15, this.OY + this.MH + 8, { x: -1, y: 0 }, 0.5, 5.5);
    }
    for (let i = 0; i < Math.min(this.level, 4); i++) {
      this.drawCherry(ctx, 210 - i * 14, this.OY + this.MH + 7);
    }

    if (this.state === 'ready') {
      retroText(ctx, 'READY!', 112, this.OY + 136, 9, '#ffe14d', 'center');
    }
    if (this.paused) {
      retroText(ctx, 'PAUSED', 112, this.OY + 136, 10, '#fff', 'center');
    }
    if (this.state === 'over') {
      retroText(ctx, 'GAME OVER', 112, this.OY + 134, 11, '#ff3355', 'center');
      retroText(ctx, 'ENTER = PLAY AGAIN', 112, this.OY + 170, 8, '#ffe14d', 'center');
      retroText(ctx, 'ESC = MENU', 112, this.OY + 182, 8, '#ffe14d', 'center');
    }
  }

  dispose() {
    this.siren.stop();
    this.frightLoop.stop();
  }
}

PacmanGame.JINGLE = [
  ['B4', 2], ['B5', 2], ['F#5', 2], ['D#5', 2], ['B5', 1], ['F#5', 3], ['D#5', 4],
  ['C5', 2], ['C6', 2], ['G5', 2], ['E5', 2], ['C6', 1], ['G5', 3], ['E5', 4],
  ['B4', 2], ['B5', 2], ['F#5', 2], ['D#5', 2], ['B5', 1], ['F#5', 3], ['D#5', 4],
  ['D#5', 1], ['E5', 1], ['F5', 1], [null, 1], ['F5', 1], ['F#5', 1], ['G5', 1], [null, 1],
  ['G5', 1], ['G#5', 1], ['A5', 1], [null, 1], ['B5', 4],
];
