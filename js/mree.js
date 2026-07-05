/* mree.js — MR EE! A loving tribute to the BBC Micro classic (and Mr. Do!).
   Dig tunnels through the garden, eat the cherries, drop apples on the
   creeps, and throw your bouncing power-ball. Internal 224x256 at 3x. */
'use strict';

class MrEeGame {
  constructor(api) {
    this.api = api;
    api.canvas.width = 672;
    api.canvas.height = 768;
    this.ctx = api.ctx;
    this.S = 3;
    this.CW = 16;            // grid 16 x 14, cell 14px, field y-offset 20
    this.CH = 14;
    this.CELL = 14;
    this.OY = 20;
    this.hi = loadHi('mree');
    this.music = Sfx.makeTune([
      ['C5', 1], ['E5', 1], ['G5', 1], ['E5', 1], ['C5', 1], ['E5', 1], ['G5', 1], ['E5', 1],
      ['D5', 1], ['F5', 1], ['A5', 1], ['F5', 1], ['G5', 1], ['E5', 1], ['C5', 1], [null, 1],
      ['C5', 1], ['E5', 1], ['G5', 1], ['E5', 1], ['A5', 1], ['G5', 1], ['E5', 1], ['C5', 1],
      ['D5', 1], ['B4', 1], ['D5', 1], ['F5', 1], ['E5', 2], [null, 2],
    ], 0.125, { type: 'square', vol: 0.16, gap: 0.8 });
    this.newGame();
  }

  /* ---------- level ---------- */

  genLevel(level) {
    let seed = 4242 + level * 1337;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    // dirt: true = solid earth
    this.dirt = [];
    this.cherry = [];
    for (let r = 0; r < this.CH; r++) {
      this.dirt.push(new Array(this.CW).fill(true));
      this.cherry.push(new Array(this.CW).fill(false));
    }
    // monster den at top centre
    for (let r = 0; r < 2; r++) for (let c = 6; c < 10; c++) this.dirt[r][c] = false;
    // starting tunnels: a drop from the den and a home row
    for (let r = 2; r <= 11; r++) this.dirt[r][8] = false;
    for (let c = 5; c <= 10; c++) this.dirt[11][c] = false;
    // cherry clusters (2x4)
    let placed = 0, guard = 0;
    while (placed < 5 && guard++ < 200) {
      const r = 2 + Math.floor(rnd() * (this.CH - 5));
      const c = Math.floor(rnd() * (this.CW - 4));
      let ok = true;
      for (let dr = 0; dr < 2; dr++) for (let dc = 0; dc < 4; dc++) {
        if (!this.dirt[r + dr][c + dc] || this.cherry[r + dr][c + dc]) ok = false;
      }
      if (!ok) continue;
      for (let dr = 0; dr < 2; dr++) for (let dc = 0; dc < 4; dc++) this.cherry[r + dr][c + dc] = true;
      placed++;
    }
    this.cherriesLeft = placed * 8;
    // apples resting in the dirt
    this.apples = [];
    guard = 0;
    while (this.apples.length < 7 && guard++ < 200) {
      const r = 2 + Math.floor(rnd() * 9);
      const c = Math.floor(rnd() * this.CW);
      if (!this.dirt[r][c] || this.cherry[r][c]) continue;
      if (this.apples.some(a => a.c === c && Math.abs(a.r - r) < 2)) continue;
      this.apples.push({ c, r, state: 'idle', t: 0, fell: 0, x: 0, y: 0 });
    }
    this.monstersToSpawn = 4 + Math.min(level, 5);
    this.spawnT = 2.5;
    this.monsters = [];
    this.speedMul = 1 + (level - 1) * 0.06;
  }

  newGame() {
    this.score = 0;
    this.lives = 3;
    this.level = 1;
    this.paused = false;
    this.state = 'ready';
    this.stateT = 1.6;
    this.genLevel(1);
    this.resetActors();
    this.music.start();
  }

  resetActors() {
    this.player = { x: 8.5 * this.CELL, y: 11.5 * this.CELL, dir: { x: 0, y: 0 }, desired: null, face: { x: 0, y: 1 } };
    this.ball = null;
    this.ballCool = 0;
    this.streak = 0;
    this.streakT = 0;
    this.parts = [];
  }

  /* ---------- helpers ---------- */

  cellAt(x, y) { return { c: Math.floor(x / this.CELL), r: Math.floor(y / this.CELL) }; }

  inGrid(r, c) { return r >= 0 && r < this.CH && c >= 0 && c < this.CW; }

  appleAt(r, c) {
    return this.apples.find(a => {
      if (a.state === 'break') return false;
      if (a.state === 'fall') return Math.floor(a.y / this.CELL) === r && a.c === c;
      if (a.state === 'slide') return a.r === r && (a.c === c || a.toC === c);
      return a.r === r && a.c === c;
    });
  }

  open(r, c) {   // a cell creatures can walk through
    return this.inGrid(r, c) && !this.dirt[r][c] && !this.appleAt(r, c);
  }

  /* ---------- input ---------- */

  key(e, down) {
    const k = e.code;
    const map = {
      ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 },
      ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 },
      KeyA: { x: -1, y: 0 }, KeyD: { x: 1, y: 0 }, KeyW: { x: 0, y: -1 }, KeyS: { x: 0, y: 1 },
    };
    if (map[k]) {
      if (down) this.player.desired = map[k];
      else if (this.player.desired && this.player.desired.x === map[k].x && this.player.desired.y === map[k].y) {
        this.player.desired = null;
      }
      return;
    }
    if (k === 'Space' && down) this.throwBall();
    if (k === 'KeyP' && down && this.state !== 'over') {
      this.paused = !this.paused;
      if (this.paused) this.music.stop(); else this.music.start();
    }
    if (k === 'Enter' && down && this.state === 'over') this.newGame();
  }

  throwBall() {
    if (this.state !== 'play' || this.paused || this.ball || this.ballCool > 0) return;
    const f = this.player.face;
    this.ball = {
      x: this.player.x + f.x * 6, y: this.player.y + f.y * 6,
      vx: f.x !== 0 ? f.x * 78 : 42,
      vy: f.y !== 0 ? f.y * 78 : -42,
      t: 6,
    };
    Sfx.tone({ f: 700, f1: 320, type: 'square', dur: 0.09, vol: 0.25 });
  }

  addScore(n) {
    this.score += n;
    if (this.score > this.hi) { this.hi = this.score; saveHi('mree', this.hi); }
  }

  /* ---------- update ---------- */

  bfsFromPlayer() {
    // distance map through open cells, for the creeps' chase
    const dist = [];
    for (let r = 0; r < this.CH; r++) dist.push(new Array(this.CW).fill(-1));
    const pc = this.cellAt(this.player.x, this.player.y);
    if (!this.inGrid(pc.r, pc.c)) return dist;
    const q = [[pc.r, pc.c]];
    dist[pc.r][pc.c] = 0;
    while (q.length) {
      const [r, c] = q.shift();
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nr = r + dr, nc = c + dc;
        if (this.inGrid(nr, nc) && dist[nr][nc] < 0 && !this.dirt[nr][nc] && !this.appleAt(nr, nc)) {
          dist[nr][nc] = dist[r][c] + 1;
          q.push([nr, nc]);
        }
      }
    }
    return dist;
  }

  moveGrid(e, speed, dt, canDig, isPlayer) {
    // centre-snapped 4-way grid movement
    let rem = speed * dt;
    let guard = 0;
    while (rem > 0.01 && guard++ < 20) {
      const cx = (Math.floor(e.x / this.CELL) + 0.5) * this.CELL;
      const cy = (Math.floor(e.y / this.CELL) + 0.5) * this.CELL;
      const atC = Math.abs(e.x - cx) < 0.01 && Math.abs(e.y - cy) < 0.01;
      if (atC) {
        const pick = isPlayer ? this.playerPick() : this.monsterPick(e);
        if (!pick) return;
        e.dir = pick;
        const { r, c } = this.cellAt(e.x + e.dir.x * this.CELL, e.y + e.dir.y * this.CELL);
        if (!this.inGrid(r, c)) { e.dir = { x: 0, y: 0 }; return; }
        const apple = this.appleAt(r, c);
        if (apple) {
          if (isPlayer && e.dir.y === 0 && apple.state === 'idle') {
            // push it!
            const br = apple.r, bc = apple.c + e.dir.x;
            if (this.inGrid(br, bc) && !this.dirt[br][bc] && !this.appleAt(br, bc) && !this.cellHasMonster(br, bc)) {
              apple.state = 'slide';
              apple.t = 0.16;
              apple.toC = bc;
              Sfx.noise({ dur: 0.08, vol: 0.15, fc: 400 });
            }
          }
          return;
        }
        if (this.dirt[r][c] && !canDig) return;
      }
      // step toward the next centre strictly ahead (and snap exactly onto it)
      if (e.dir.x === 0 && e.dir.y === 0) return;
      const axisX = e.dir.x !== 0;
      const cur = axisX ? e.x : e.y;
      const sgn = axisX ? e.dir.x : e.dir.y;
      let targetC = (Math.floor(cur / this.CELL) + 0.5) * this.CELL;
      if ((targetC - cur) * sgn <= 1e-9) targetC += sgn * this.CELL;
      const distC = Math.abs(targetC - cur);
      const step = Math.min(rem, distC);
      if (axisX) e.x += sgn * step; else e.y += sgn * step;
      rem -= step;
      if (step >= distC - 1e-9) {
        if (axisX) e.x = targetC; else e.y = targetC;
      }
      // dig as we enter
      const here = this.cellAt(e.x, e.y);
      if (this.dirt[here.r] && this.dirt[here.r][here.c]) {
        if (canDig) {
          this.dirt[here.r][here.c] = false;
          if (isPlayer && Math.random() < 0.4) Sfx.noise({ dur: 0.05, vol: 0.1, fc: 600 });
          if (this.cherry[here.r][here.c] && isPlayer) this.eatCherry(here.r, here.c);
        }
      } else if (isPlayer && this.cherry[here.r] && this.cherry[here.r][here.c]) {
        this.eatCherry(here.r, here.c);
      }
    }
  }

  playerPick() {
    const p = this.player;
    const test = (d) => {
      if (!d) return false;
      const { r, c } = this.cellAt(p.x + d.x * this.CELL, p.y + d.y * this.CELL);
      if (!this.inGrid(r, c)) return false;
      return true;   // dirt is diggable, apples handled in mover
    };
    if (p.desired && test(p.desired)) { p.face = p.desired; return p.desired; }
    if ((p.dir.x || p.dir.y) && this.player.desired == null) return null;   // stop when key released
    if ((p.dir.x || p.dir.y) && test(p.dir)) return p.dir;
    return null;
  }

  monsterPick(m) {
    const { r, c } = this.cellAt(m.x, m.y);
    const dirs = [[0, -1], [-1, 0], [0, 1], [1, 0]];
    if (m.digger) {
      // burrow straight toward the clown
      const dx = this.player.x - m.x, dy = this.player.y - m.y;
      const opts = Math.abs(dx) > Math.abs(dy)
        ? [{ x: Math.sign(dx), y: 0 }, { x: 0, y: Math.sign(dy) || 1 }]
        : [{ x: 0, y: Math.sign(dy) }, { x: Math.sign(dx) || 1, y: 0 }];
      for (const d of opts) {
        const nr = r + d.y, nc = c + d.x;
        if (this.inGrid(nr, nc) && !this.appleAt(nr, nc)) return d;
      }
      return { x: 0, y: 0 };
    }
    let best = null, bestD = 1e9;
    for (const [dc, dr] of dirs) {
      const nr = r + dr, nc = c + dc;
      if (!this.inGrid(nr, nc) || this.dirt[nr][nc] || this.appleAt(nr, nc)) continue;
      if (m.dir.x === -dc && m.dir.y === -dr && Math.random() < 0.8) continue;   // avoid dithering
      const d = this.dist[nr][nc];
      if (d >= 0 && d < bestD) { bestD = d; best = { x: dc, y: dr }; }
    }
    if (best) { m.stuckT = 0; return best; }
    // no path: wander, and grow impatient
    const opts = [];
    for (const [dc, dr] of dirs) {
      const nr = r + dr, nc = c + dc;
      if (this.inGrid(nr, nc) && !this.dirt[nr][nc] && !this.appleAt(nr, nc)) opts.push({ x: dc, y: dr });
    }
    if (opts.length) return opts[Math.floor(Math.random() * opts.length)];
    return { x: 0, y: 0 };
  }

  cellHasMonster(r, c) {
    return this.monsters.some(m => {
      const mc = this.cellAt(m.x, m.y);
      return mc.r === r && mc.c === c;
    });
  }

  eatCherry(r, c) {
    this.cherry[r][c] = false;
    this.cherriesLeft--;
    this.streak = (this.streakT > 0) ? this.streak + 1 : 1;
    this.streakT = 1.4;
    this.addScore(50);
    Sfx.tone({ f: 500 + this.streak * 90, f1: 700 + this.streak * 90, type: 'square', dur: 0.07, vol: 0.25 });
    if (this.streak === 8) {
      this.addScore(500);
      Sfx.playSeq([['C6', 1], ['E6', 1], ['G6', 2]], 0.06, { vol: 0.35 });
      this.streak = 0;
    }
    if (this.cherriesLeft <= 0) this.winLevel();
  }

  winLevel() {
    this.state = 'clear';
    this.stateT = 2.2;
    this.addScore(300 + this.level * 100);
    this.music.stop();
    Sfx.playSeq([['C5', 1], ['E5', 1], ['G5', 1], ['C6', 1], ['E6', 2]], 0.09, { vol: 0.4 });
  }

  die() {
    if (this.state !== 'play') return;
    this.state = 'dying';
    this.stateT = 1.6;
    this.music.stop();
    Sfx.playSeq([['E5', 1], ['C5', 1], ['A4', 1], ['F4', 2], ['C4', 3]], 0.1, { type: 'sawtooth', vol: 0.35 });
  }

  update(dt) {
    if (this.paused) return;

    if (this.state === 'ready') {
      this.stateT -= dt;
      if (this.stateT <= 0) { this.state = 'play'; this.music.start(); }
      return;
    }
    if (this.state === 'dying') {
      this.stateT -= dt;
      if (this.stateT <= 0) {
        this.lives--;
        if (this.lives <= 0) {
          this.state = 'over';
        } else {
          this.resetActors();
          this.monsters = [];
          this.monstersToSpawn = Math.max(2, this.monstersToSpawn);
          this.state = 'ready';
          this.stateT = 1.3;
        }
      }
      return;
    }
    if (this.state === 'clear') {
      this.stateT -= dt;
      if (this.stateT <= 0) {
        this.level++;
        this.genLevel(this.level);
        this.resetActors();
        this.state = 'ready';
        this.stateT = 1.5;
        this.music.start();
      }
      return;
    }
    if (this.state !== 'play') return;

    this.streakT -= dt;
    if (this.streakT <= 0) this.streak = 0;
    this.ballCool = Math.max(0, this.ballCool - dt);

    // the clown
    this.moveGrid(this.player, (this.dirtAtEntity(this.player) ? 30 : 56) * 1, dt, true, true);
    this.fence(this.player);

    // spawn creeps from the den
    if (this.monstersToSpawn > 0) {
      this.spawnT -= dt;
      if (this.spawnT <= 0) {
        this.spawnT = 3.6;
        this.monstersToSpawn--;
        this.monsters.push({
          x: 8 * this.CELL - 7, y: 1.5 * this.CELL, dir: { x: 0, y: 1 },
          digger: false, stuckT: 0, wob: Math.random() * 6,
        });
      }
    }

    // creeps
    this.dist = this.bfsFromPlayer();
    for (const m of this.monsters) {
      m.wob += dt * 6;
      const pc = this.cellAt(m.x, m.y);
      if (this.dist[pc.r] && this.dist[pc.r][pc.c] < 0 && !m.digger) {
        m.stuckT += dt;
        if (m.stuckT > 5 && !m.digger) {
          m.digger = true;
          Sfx.tone({ f: 200, f1: 340, type: 'sawtooth', dur: 0.25, vol: 0.2 });
        }
      }
      const inDirt = this.dirtAtEntity(m);
      const sp = (m.digger ? (inDirt ? 18 : 40) : 42) * this.speedMul;
      this.moveGrid(m, sp, dt, m.digger, false);
      this.fence(m);
      // caught the clown?
      if (Math.hypot(m.x - this.player.x, m.y - this.player.y) < 8) {
        this.die();
        return;
      }
    }

    // apples
    for (let i = this.apples.length - 1; i >= 0; i--) {
      const a = this.apples[i];
      if (a.state === 'idle') {
        const below = { r: a.r + 1, c: a.c };
        const support = !this.inGrid(below.r, below.c) || this.dirt[below.r][below.c] || this.appleAt(below.r, below.c);
        if (!support) {
          a.state = 'wobble';
          a.t = 0.55;
          Sfx.tone({ f: 180, f1: 150, type: 'triangle', dur: 0.3, vol: 0.2 });
        }
      } else if (a.state === 'wobble') {
        a.t -= dt;
        if (a.t <= 0) {
          a.state = 'fall';
          a.y = (a.r + 0.5) * this.CELL;
          a.fell = 0;
        }
      } else if (a.state === 'slide') {
        a.t -= dt;
        if (a.t <= 0) { a.c = a.toC; a.state = 'idle'; }
      } else if (a.state === 'fall') {
        const oldY = a.y;
        a.y += 95 * dt;
        a.fell += (a.y - oldY) / this.CELL;
        const rNow = Math.floor(a.y / this.CELL);
        // squash things beneath
        for (let j = this.monsters.length - 1; j >= 0; j--) {
          const m = this.monsters[j];
          if (Math.abs(m.x - (a.c + 0.5) * this.CELL) < 8 && Math.abs(m.y - a.y) < 10 && m.y > a.y - 4) {
            this.monsters.splice(j, 1);
            this.addScore(500);
            this.splat((a.c + 0.5) * this.CELL, m.y, '#ff4455');
            Sfx.noise({ dur: 0.2, vol: 0.4, fc: 500 });
            this.checkAllDead();
          }
        }
        if (Math.abs(this.player.x - (a.c + 0.5) * this.CELL) < 8 && Math.abs(this.player.y - a.y) < 10 && this.player.y > a.y - 4) {
          this.die();
          return;
        }
        // landing?
        const nr = rNow + 1;
        const blocked = nr >= this.CH || this.dirt[nr][a.c] || (this.appleAt(nr, a.c) && this.appleAt(nr, a.c) !== a);
        if (blocked && a.y >= (rNow + 0.5) * this.CELL) {
          a.y = (rNow + 0.5) * this.CELL;
          a.r = rNow;
          if (a.fell >= 1.9) {
            a.state = 'break';
            a.t = 0.45;
            this.splat((a.c + 0.5) * this.CELL, a.y, '#8fd44a');
            Sfx.noise({ dur: 0.25, vol: 0.45, fc: 350 });
          } else {
            a.state = 'idle';
            Sfx.noise({ dur: 0.1, vol: 0.3, fc: 250 });
          }
        }
      } else if (a.state === 'break') {
        a.t -= dt;
        if (a.t <= 0) this.apples.splice(i, 1);
      }
    }

    // the power ball
    if (this.ball) {
      const b = this.ball;
      b.t -= dt;
      let nx = b.x + b.vx * dt, ny = b.y + b.vy * dt;
      const cellX = this.cellAt(nx, b.y), cellY = this.cellAt(b.x, ny);
      if (!this.inGrid(cellX.r, cellX.c) || this.dirt[cellX.r][cellX.c] || this.appleAt(cellX.r, cellX.c)) {
        b.vx *= -1; nx = b.x;
        Sfx.tone({ f: 300, type: 'square', dur: 0.03, vol: 0.12 });
      }
      if (!this.inGrid(cellY.r, cellY.c) || this.dirt[cellY.r][cellY.c] || this.appleAt(cellY.r, cellY.c)) {
        b.vy *= -1; ny = b.y;
        Sfx.tone({ f: 340, type: 'square', dur: 0.03, vol: 0.12 });
      }
      b.x = nx; b.y = ny;
      for (let j = this.monsters.length - 1; j >= 0; j--) {
        const m = this.monsters[j];
        if (Math.hypot(m.x - b.x, m.y - b.y) < 8) {
          this.monsters.splice(j, 1);
          this.addScore(500);
          this.splat(m.x, m.y, '#ff4455');
          Sfx.playSeq([['G5', 1], ['C6', 1]], 0.06, { vol: 0.3 });
          this.ball = null;
          this.ballCool = 1.6;
          this.checkAllDead();
          break;
        }
      }
      if (this.ball && b.t <= 0) { this.ball = null; this.ballCool = 1.2; }
    }

    // particles
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.t -= dt;
      p.x += p.vx * dt * 30;
      p.y += p.vy * dt * 30;
      p.vy += dt * 3;
      if (p.t <= 0) this.parts.splice(i, 1);
    }
  }

  dirtAtEntity(e) {
    const { r, c } = this.cellAt(e.x, e.y);
    return this.inGrid(r, c) && this.dirt[r][c];
  }

  // belt-and-braces: nobody ever leaves the garden
  fence(e) {
    const lo = 0.5 * this.CELL, hiX = (this.CW - 0.5) * this.CELL, hiY = (this.CH - 0.5) * this.CELL;
    if (e.x < lo) { e.x = lo; e.dir = { x: 0, y: 0 }; }
    if (e.x > hiX) { e.x = hiX; e.dir = { x: 0, y: 0 }; }
    if (e.y < lo) { e.y = lo; e.dir = { x: 0, y: 0 }; }
    if (e.y > hiY) { e.y = hiY; e.dir = { x: 0, y: 0 }; }
  }

  checkAllDead() {
    if (this.monsters.length === 0 && this.monstersToSpawn === 0 && this.state === 'play') {
      this.winLevel();
    }
  }

  splat(x, y, col) {
    for (let i = 0; i < 8; i++) {
      this.parts.push({ x, y, vx: Math.random() * 2 - 1, vy: -Math.random() * 2, t: 0.5, col });
    }
  }

  /* ---------- draw ---------- */

  draw() {
    const ctx = this.ctx, S = this.S, CELL = this.CELL, OY = this.OY;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 672, 768);
    ctx.setTransform(S, 0, 0, S, 0, 0);
    ctx.imageSmoothingEnabled = false;

    // garden field
    for (let r = 0; r < this.CH; r++) {
      for (let c = 0; c < this.CW; c++) {
        const x = c * CELL, y = OY + r * CELL;
        if (this.dirt[r][c]) {
          ctx.fillStyle = '#7a4a22';
          ctx.fillRect(x, y, CELL, CELL);
          ctx.fillStyle = '#5e3618';
          const h = (r * 31 + c * 17) % 7;
          ctx.fillRect(x + 2 + h, y + 3, 2, 2);
          ctx.fillRect(x + 9 - h % 4, y + 9, 2, 2);
          ctx.fillRect(x + 5, y + 6 + h % 3, 1, 1);
          if (this.cherry[r][c]) {
            ctx.fillStyle = '#ff2244';
            ctx.beginPath();
            ctx.arc(x + 5, y + 8, 2.4, 0, Math.PI * 2);
            ctx.arc(x + 9.5, y + 8.5, 2.4, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#3faa3f';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x + 5, y + 6);
            ctx.quadraticCurveTo(x + 7, y + 2, x + 9.5, y + 6.5);
            ctx.stroke();
          }
        } else {
          ctx.fillStyle = '#1a0e06';
          ctx.fillRect(x, y, CELL, CELL);
        }
      }
    }

    // apples
    for (const a of this.apples) {
      let ax = (a.c + 0.5) * CELL, ay;
      if (a.state === 'fall' || a.state === 'break') ay = OY + a.y;
      else ay = OY + (a.r + 0.5) * CELL;
      if (a.state === 'slide') ax += (a.toC - a.c) * CELL * (1 - a.t / 0.16);
      if (a.state === 'wobble') ax += Math.sin(a.t * 40) * 1.5;
      if (a.state === 'break') {
        ctx.fillStyle = '#8fd44a';
        ctx.fillRect(ax - 6, ay + 1, 12, 4);
        continue;
      }
      ctx.fillStyle = '#e02030';
      ctx.beginPath();
      ctx.arc(ax, ay + 1, 5.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ff7788';
      ctx.fillRect(ax - 3, ay - 2, 2, 2);
      ctx.fillStyle = '#3faa3f';
      ctx.fillRect(ax - 0.5, ay - 5.5, 1.5, 3);
      ctx.fillRect(ax + 1, ay - 5.5, 3, 2);
    }

    // ball
    if (this.ball) {
      ctx.fillStyle = '#ffd24d';
      ctx.beginPath();
      ctx.arc(this.ball.x, OY + this.ball.y, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }

    // creeps
    for (const m of this.monsters) {
      const x = m.x, y = OY + m.y;
      ctx.fillStyle = m.digger ? '#ff8833' : '#ff4455';
      ctx.beginPath();
      ctx.arc(x, y - 1, 5.5, Math.PI, 0);
      const wob = Math.sin(m.wob) * 1.2;
      ctx.lineTo(x + 5.5, y + 4);
      ctx.lineTo(x + 3, y + 3 + wob);
      ctx.lineTo(x, y + 4);
      ctx.lineTo(x - 3, y + 3 - wob);
      ctx.lineTo(x - 5.5, y + 4);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillRect(x - 3.4, y - 3.4, 2.6, 3);
      ctx.fillRect(x + 0.8, y - 3.4, 2.6, 3);
      ctx.fillStyle = '#102';
      ctx.fillRect(x - 2.6 + m.dir.x, y - 2.6, 1.4, 1.8);
      ctx.fillRect(x + 1.6 + m.dir.x, y - 2.6, 1.4, 1.8);
    }

    // the clown
    if (this.state !== 'over' && !(this.state === 'dying' && Math.floor(this.stateT * 8) % 2 === 0)) {
      const x = this.player.x, y = OY + this.player.y;
      ctx.fillStyle = '#f4f4f8';
      ctx.beginPath();
      ctx.arc(x, y + 0.5, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ff4455';
      ctx.beginPath();
      ctx.arc(x, y - 4.5, 3.4, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = '#ffd24d';
      ctx.fillRect(x - 1, y - 8.5, 2, 2);
      ctx.fillStyle = '#ff4455';
      ctx.beginPath();
      ctx.arc(x + this.player.face.x * 1.5, y + 0.5 + this.player.face.y, 1.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#102';
      ctx.fillRect(x - 2.6, y - 2.4, 1.4, 1.6);
      ctx.fillRect(x + 1.2, y - 2.4, 1.4, 1.6);
    }

    // particles
    for (const p of this.parts) {
      ctx.fillStyle = p.col;
      ctx.fillRect(p.x - 1, OY + p.y - 1, 2, 2);
    }

    // HUD
    ctx.fillStyle = '#0c2a0c';
    ctx.fillRect(0, 0, this.W, OY);
    for (let x = 4; x < 224; x += 18) {
      ctx.fillStyle = '#3faa3f';
      ctx.fillRect(x + 3, 12, 2, 6);
      ctx.fillStyle = ['#ff77aa', '#ffd24d', '#7cf'][Math.floor(x / 18) % 3];
      ctx.beginPath();
      ctx.arc(x + 4, 10, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
    retroText(ctx, 'SCORE ' + String(this.score).padStart(6, '0'), 4, 1, 8, '#fff');
    retroText(ctx, 'HI ' + String(this.hi).padStart(6, '0'), 220, 1, 8, '#ffe14d', 'right');

    const by = OY + this.CH * this.CELL;
    ctx.fillStyle = '#0c2a0c';
    ctx.fillRect(0, by, this.W, 256 - by);
    for (let i = 0; i < Math.min(this.lives - 1, 4); i++) {
      const x = 10 + i * 14, y = by + 10;
      ctx.fillStyle = '#f4f4f8';
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ff4455';
      ctx.beginPath();
      ctx.arc(x, y - 3.6, 2.6, Math.PI, 0);
      ctx.fill();
    }
    retroText(ctx, 'LEVEL ' + this.level, 112, by + 5, 8, '#7cfc6a', 'center');
    retroText(ctx, 'CHERRIES ' + this.cherriesLeft, 112, by + 16, 8, '#ff77aa', 'center');
    retroText(ctx, (this.ball || this.ballCool > 0) ? 'BALL ...' : 'BALL OK', 220, by + 5, 8,
      (this.ball || this.ballCool > 0) ? '#667' : '#ffd24d', 'right');
    retroText(ctx, 'SPACE = THROW', 220, by + 16, 8, '#667', 'right');

    // banners
    if (this.state === 'ready') {
      retroText(ctx, 'LEVEL ' + this.level, 112, 108, 11, '#ffe14d', 'center');
      retroText(ctx, 'GO!', 112, 126, 10, '#fff', 'center');
    } else if (this.state === 'clear') {
      retroText(ctx, 'GARDEN CLEARED!', 112, 112, 11, '#7cfc6a', 'center');
    } else if (this.state === 'over') {
      retroText(ctx, 'GAME OVER', 112, 100, 14, '#ff4455', 'center');
      retroText(ctx, 'SCORE ' + this.score, 112, 122, 9, '#fff', 'center');
      retroText(ctx, 'ENTER = PLAY AGAIN', 112, 138, 8, '#7cfc6a', 'center');
      retroText(ctx, 'ESC = MENU', 112, 149, 8, '#7cfc6a', 'center');
    }
    if (this.paused) {
      retroText(ctx, 'PAUSED', 112, 112, 12, '#fff', 'center');
    }
  }

  dispose() {
    this.music.stop();
  }
}
MrEeGame.prototype.W = 224;
