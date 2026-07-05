/* nebulus.js — Nebulus. Pogo climbs a rotating tower rising from the sea.
   The signature illusion: Pogo stays centred while the whole cylindrical
   tower turns around him. Ledges, tunnels through the core, lifts,
   crumbling steps, bouncing baddies, and a clock. Internal 224x256 at 3x. */
'use strict';

class NebulusGame {
  constructor(api) {
    this.api = api;
    api.canvas.width = 672;
    api.canvas.height = 768;
    this.ctx = api.ctx;
    this.S = 3;
    this.W = 224;
    this.H = 256;
    this.COLS = 24;
    this.STEP = Math.PI * 2 / this.COLS;
    this.R = 70;
    this.TILE_W = 18.3;
    this.TILE_H = 9;
    this.hi = loadHi('nebulus');
    // an original two-voice bouncy chip tune (lead + walking octave bass)
    this.musLead = Sfx.makeTune([
      ['A4', 1], [null, 1], ['C5', 1], ['A4', 1], ['E5', 1], [null, 1], ['D5', 1], ['C5', 1],
      ['D5', 1], ['C5', 1], ['A4', 1], ['G4', 1], ['A4', 2], [null, 2],
      ['A4', 1], [null, 1], ['C5', 1], ['A4', 1], ['G5', 1], [null, 1], ['E5', 1], ['D5', 1],
      ['E5', 1], ['D5', 1], ['C5', 1], ['D5', 1], ['A4', 2], [null, 2],
    ], 0.115, { type: 'square', vol: 0.20, gap: 0.82 });
    this.musBass = Sfx.makeTune([
      ['A2', 1], ['A3', 1], ['A2', 1], ['A3', 1], ['G2', 1], ['G3', 1], ['G2', 1], ['G3', 1],
      ['F2', 1], ['F3', 1], ['F2', 1], ['F3', 1], ['E2', 1], ['E3', 1], ['E2', 1], ['E3', 1],
      ['A2', 1], ['A3', 1], ['A2', 1], ['A3', 1], ['G2', 1], ['G3', 1], ['G2', 1], ['G3', 1],
      ['F2', 1], ['F3', 1], ['C3', 1], ['C4', 1], ['E2', 1], ['E3', 1], ['E2', 1], ['E3', 1],
    ], 0.115, { type: 'triangle', vol: 0.30, gap: 0.92 });
    this.music = {
      start: () => { this.musLead.start(); this.musBass.start(); },
      stop: () => { this.musLead.stop(); this.musBass.stop(); },
    };
    this.TOWER_NAMES = ['THE OLD TOWER', 'TOWER OF WAVES', 'TOWER OF STORMS'];
    this.liftHum = Sfx.makeWarble({ f: 130, depth: 25, rate: 9, type: 'triangle', vol: 0.05 });
    this.clouds = [
      { x: 30, y: 34, w: 34 }, { x: 120, y: 22, w: 26 }, { x: 190, y: 46, w: 30 },
    ];
    this.newGame();
    // debug/screenshot helper: ?row=N starts Pogo higher up; ?fishing=1 jumps to the bonus
    if (typeof location !== 'undefined' && location.search) {
      if (new URLSearchParams(location.search).get('fishing')) {
        this.state = 'bonus';
        this.bonus = { t: 16, subY: 120, fish: [], bubbles: [], caught: 0, spawnT: 0.1, doneT: 0 };
      }
      const rq = Number(new URLSearchParams(location.search).get('row') || 0);
      if (rq > 0) {
        outer:
        for (let r = Math.min(rq, this.map.length - 2); r > 0; r--) {
          for (let c = 0; c < this.COLS; c++) {
            if (this.map[r][c] === '-') {
              this.pogo.row = r;
              this.pogo.c = c + 0.5;
              this.maxRow = r;
              this.camRow = r;
              break outer;
            }
          }
        }
      }
    }
  }

  /* ---------- tower generation (seeded, always climbable) ---------- */

  genTower(idx) {
    let seed = 987 + idx * 7717;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const H = 30 + idx * 5;
    const map = [];
    for (let r = 0; r < H; r++) map.push(new Array(this.COLS).fill('.'));
    for (let c = 0; c < this.COLS; c++) map[0][c] = '-';

    const put = (r, c, ch) => {
      c = ((c % this.COLS) + this.COLS) % this.COLS;
      if (map[r][c] === '.') map[r][c] = ch;
    };

    let col = 2, r = 1;
    while (r < H - 4) {
      const L = 4 + Math.floor(rnd() * 4);
      for (let k = 0; k < L; k++) {
        put(r, col + k, (k > 0 && k < L - 1 && r > 3 && rnd() < 0.16) ? '*' : '-');
      }
      const endc = ((col + L - 1) % this.COLS + this.COLS) % this.COLS;
      const roll = rnd();
      if (roll < 0.22 && r < H - 9) {
        // a lift up several floors
        const rise = 3 + Math.floor(rnd() * 2);
        map[r][endc] = 'E';
        put(r + rise, endc, 'v');
        put(r + rise, endc + 1, '-');
        put(r + rise, endc + 2, '-');
        r += rise;
        col = endc + 1;
      } else if (roll < 0.45) {
        // a tunnel through the core to the far side
        map[r][endc] = 'T';
        put(r, endc + 12, 'T');
        put(r, endc + 11, '-');
        put(r, endc + 13, '-');
        col = endc + 12;
        r += 1;
      } else {
        col = endc;
        r += 1;
      }
    }
    // crown: ring with the goal door
    for (let k = 0; k < 6; k++) put(r, col + k, '-');
    map[r][((col + 2) % this.COLS + this.COLS) % this.COLS] = 'G';
    const goalCol = ((col + 2) % this.COLS + this.COLS) % this.COLS;

    // enemies live on the ledges
    const bouncers = [], cruisers = [];
    const ledges = [];
    for (let rr = 3; rr < r - 1; rr++) {
      for (let cc = 0; cc < this.COLS; cc++) {
        if (map[rr][cc] === '-') ledges.push([rr, cc]);
      }
    }
    const nB = 3 + idx, nC = 1 + idx;
    for (let i = 0; i < nB && ledges.length; i++) {
      const [rr, cc] = ledges[Math.floor(rnd() * ledges.length)];
      bouncers.push({ c: cc + 0.5, base: rr, phase: rnd() * 6.28, alive: true });
    }
    for (let i = 0; i < nC; i++) {
      cruisers.push({
        c: rnd() * this.COLS,
        row: 4 + Math.floor(rnd() * (r - 7)),
        speed: (1.5 + idx * 0.35) * (rnd() < 0.5 ? -1 : 1),
      });
    }
    return { map, top: r, goalCol, bouncers, cruisers, height: H };
  }

  /* ---------- lifecycle ---------- */

  newGame() {
    this.score = 0;
    this.lives = 3;
    this.towerNum = 1;
    this.state = 'ready';
    this.stateT = 1.4;
    this.paused = false;
    this.keys = {};
    this.loadTower(0);
    this.music.start();
  }

  loadTower(idx) {
    this.towerIdx = idx;
    const t = this.genTower(idx);
    this.map = t.map;
    this.towerTop = t.top;
    this.goalCol = t.goalCol;
    this.bouncers = t.bouncers;
    this.cruisers = t.cruisers;
    this.lifts = [];
    for (let r = 0; r < this.map.length; r++) {
      for (let c = 0; c < this.COLS; c++) {
        if (this.map[r][c] === 'E') {
          let stop = -1;
          for (let r2 = r + 1; r2 < this.map.length; r2++) {
            if (this.map[r2][c] !== '.') { stop = r2; break; }
          }
          if (stop > 0) this.lifts.push({ col: c, base: r, stop, pos: r, state: 'idle', t: 0 });
        }
      }
    }
    this.time = 220 + idx * 30;
    this.resetPogo();
    this.shots = [];
    this.particles = [];
    this.sink = 0;
    this.maxRow = 0;
    this.camRow = 2.5;
  }

  resetPogo() {
    this.pogo = {
      c: 3.5, row: 0, vy: 0, grounded: true, dir: 1,
      state: 'play', stateT: 0, invulT: 1.2, walkT: 0, lift: null,
    };
    this.crumbleAt = null;
    this.crumbleT = 0;
  }

  wrapC(c) { return ((c % this.COLS) + this.COLS) % this.COLS; }

  dcol(a, b) {   // signed shortest distance around the tower, in columns
    let d = a - b;
    while (d > this.COLS / 2) d -= this.COLS;
    while (d < -this.COLS / 2) d += this.COLS;
    return d;
  }

  tile(r, c) {
    if (r < 0 || r >= this.map.length) return '.';
    return this.map[r][Math.floor(this.wrapC(c))];
  }

  walkable(r, c) {
    const t = this.tile(r, c);
    return t === '-' || t === '*' || t === 'E' || t === 'T' || t === 'G' || t === 'v';
  }

  /* ---------- input ---------- */

  key(e, down) {
    const k = e.code;
    if (k === 'ArrowLeft' || k === 'KeyA') this.keys.left = down;
    if (k === 'ArrowRight' || k === 'KeyD') this.keys.right = down;
    if (k === 'ArrowUp' || k === 'KeyW') this.keys.up = down;
    if (k === 'ArrowDown' || k === 'KeyS') this.keys.down = down;
    if (k === 'Space') this.keys.jump = down;
    if ((k === 'KeyZ' || k === 'KeyX') && down) this.shoot();
    if (k === 'KeyP' && down && this.state !== 'over') {
      this.paused = !this.paused;
      if (this.paused) { this.music.stop(); this.liftHum.stop(); }
      else this.music.start();
    }
    if (k === 'Enter' && down && this.state === 'over') this.newGame();
  }

  shoot() {
    if (this.state !== 'play' || this.paused || this.pogo.state !== 'play') return;
    if (this.shots.length) return;
    this.shots.push({ c: this.pogo.c, row: this.pogo.row + 0.55, dir: this.pogo.dir, dist: 0 });
    Sfx.tone({ f: 750, f1: 260, type: 'square', dur: 0.1, vol: 0.25 });
  }

  /* ---------- update ---------- */

  addScore(n) {
    this.score += n;
    if (this.score > this.hi) { this.hi = this.score; saveHi('nebulus', this.hi); }
  }

  loseLife(splash) {
    this.lives--;
    this.liftHum.stop();
    if (splash) {
      Sfx.noise({ dur: 0.5, vol: 0.55, fc: 500 });
      for (let i = 0; i < 14; i++) {
        this.particles.push({
          x: 112 + (Math.random() * 30 - 15), y: 0, vy: 2 + Math.random() * 3,
          vx: Math.random() * 2 - 1, t: 0.8, sea: true,
        });
      }
    }
    if (this.lives <= 0) {
      this.state = 'over';
      this.music.stop();
      Sfx.playSeq([['C4', 2], ['G3', 2], ['E3', 2], ['C3', 4]], 0.11, { type: 'sawtooth', vol: 0.35 });
    } else {
      this.state = 'dead';
      this.stateT = 1.2;
    }
  }

  update(dt) {
    if (this.paused) return;

    if (this.state === 'ready') {
      this.stateT -= dt;
      if (this.stateT <= 0) this.state = 'play';
      return;
    }
    if (this.state === 'dead') {
      this.stateT -= dt;
      if (this.stateT <= 0) {
        this.resetPogo();
        this.time = Math.max(this.time, 100);
        this.state = 'play';
      }
      return;
    }
    if (this.state === 'won') {
      this.sink += dt * 4;
      this.stateT -= dt;
      if (this.stateT <= 0) {
        // the famous fishing interlude before the next tower
        this.state = 'bonus';
        this.bonus = { t: 16, subY: 120, fish: [], bubbles: [], caught: 0, spawnT: 0.4, doneT: 0 };
      }
      return;
    }
    if (this.state === 'bonus') {
      this.updateBonus(dt);
      return;
    }
    if (this.state !== 'play') return;

    // clock
    this.time -= dt;
    if (this.time <= 0) { this.time = 180; this.loseLife(false); return; }
    if (this.time < 30 && Math.floor(this.time * 2) !== Math.floor((this.time + dt) * 2) && Math.floor(this.time * 2) % 2 === 0) {
      Sfx.tone({ f: 880, type: 'square', dur: 0.05, vol: 0.15 });
    }

    const p = this.pogo;
    p.invulT = Math.max(0, p.invulT - dt);

    // lifts drift home
    for (const l of this.lifts) {
      if (l.state === 'return') {
        l.pos = Math.max(l.base, l.pos - 2.5 * dt);
        if (l.pos <= l.base) l.state = 'idle';
      } else if (l.state === 'wait') {
        l.t -= dt;
        if (l.t <= 0) l.state = 'return';
      }
    }

    if (p.state === 'flat') {
      p.stateT -= dt;
      if (p.stateT <= 0) p.state = 'play';
    } else if (p.state === 'tunnel') {
      p.stateT -= dt;
      if (p.stateT <= 0) {
        if (!p.emerged) {
          p.c = this.wrapC(p.c + 12);
          p.emerged = true;
          p.stateT = 0.35;
        } else {
          p.state = 'play';
          p.tunnelCool = 0.6;
        }
      }
    } else if (p.state === 'lift') {
      const l = p.lift;
      l.pos += 2.2 * dt;
      p.row = l.pos;
      this.liftHum.set(130 + (l.pos - l.base) * 8);
      if (l.pos >= l.stop) {
        l.pos = l.stop;
        p.row = l.stop;
        p.state = 'play';
        p.grounded = true;
        l.state = 'wait';
        l.t = 2.5;
        p.lift = null;
        this.liftHum.stop();
      }
    } else if (p.state === 'stun') {
      p.vy -= 10 * dt;
      const old = p.row;
      p.row += p.vy * dt;
      p.stateT -= dt;
      if (p.vy < 0) {
        const cand = Math.floor(old);
        // knocked clean off his ledge: he cannot re-land on the one he was hit on
        if (p.row <= cand && cand >= 0 && cand !== p.stunFrom && this.walkable(cand, p.c) && cand < old) {
          p.row = cand;
          p.vy = 0;
          p.state = 'play';
          p.grounded = true;
          Sfx.noise({ dur: 0.07, vol: 0.25, fc: 320 });
        }
      }
      if (p.row < -0.4) { this.loseLife(true); return; }
    } else {
      // normal play: walking rotates the tower
      let move = 0;
      if (this.keys.left) move -= 1;
      if (this.keys.right) move += 1;
      if (move !== 0) {
        p.dir = move;
        p.c = this.wrapC(p.c + move * 5.2 * dt);
        p.walkT += dt;
      }

      if (p.grounded) {
        const here = this.tile(Math.floor(p.row), p.c);
        // crumbling steps
        if (here === '*') {
          const key = Math.floor(p.row) * 100 + Math.floor(this.wrapC(p.c));
          if (this.crumbleAt !== key) { this.crumbleAt = key; this.crumbleT = 0.4; }
          this.crumbleT -= dt;
          if (this.crumbleT <= 0) {
            this.map[Math.floor(p.row)][Math.floor(this.wrapC(p.c))] = '.';
            Sfx.noise({ dur: 0.15, vol: 0.3, fc: 700 });
            for (let i = 0; i < 5; i++) {
              this.particles.push({ x: 112, y: p.row, vy: -1 - Math.random() * 2, vx: Math.random() * 2 - 1, t: 0.5 });
            }
          }
        } else {
          this.crumbleAt = null;
        }
        // goal door
        if (here === 'G') {
          this.state = 'won';
          this.stateT = 2.6;
          this.addScore(500 + Math.floor(this.time) * 5);
          this.liftHum.stop();
          Sfx.playSeq([['C5', 1], ['E5', 1], ['G5', 1], ['C6', 1], ['E6', 1], ['G6', 3]], 0.09, { vol: 0.45 });
          return;
        }
        // doors and lifts work by walking into them, like the original
        p.tunnelCool = Math.max(0, (p.tunnelCool || 0) - dt);
        const frac = this.wrapC(p.c) - Math.floor(this.wrapC(p.c));
        if (here === 'T' && move !== 0 && p.tunnelCool <= 0 && Math.abs(frac - 0.5) < 0.12) {
          p.state = 'tunnel';
          p.stateT = 0.35;
          p.emerged = false;
          p.c = Math.floor(this.wrapC(p.c)) + 0.5;
          Sfx.noise({ dur: 0.2, vol: 0.3, fc: 900 });
        } else if (here === 'E' && Math.abs(frac - 0.5) < 0.12) {
          const l = this.lifts.find(x => x.base === Math.floor(p.row) && x.col === Math.floor(this.wrapC(p.c)) && x.state === 'idle');
          if (l) {
            p.state = 'lift';
            p.lift = l;
            p.c = l.col + 0.5;
            this.liftHum.start();
          }
        } else if (p.grounded && (this.keys.jump || this.keys.up)) {
          p.grounded = false;
          p.vy = 4.9;
          p.peak = p.row;
          Sfx.tone({ f: 300, f1: 540, type: 'square', dur: 0.09, vol: 0.22 });
        }
        // walked off the edge?
        if (p.grounded && p.state === 'play' && !this.walkable(Math.floor(p.row), p.c)) {
          p.grounded = false;
          p.vy = 0;
        }
      }

      if (!p.grounded) {
        p.vy -= 9.8 * dt;
        p.peak = Math.max(p.peak == null ? p.row : p.peak, p.row);
        const old = p.row;
        p.row += p.vy * dt;
        if (p.vy < 0) {
          const cand = Math.floor(old + 0.0001);
          for (let rr = cand; rr >= Math.floor(p.row); rr--) {
            if (rr >= 0 && this.walkable(rr, p.c) && old >= rr && p.row <= rr) {
              p.row = rr;
              p.vy = 0;
              p.grounded = true;
              const drop = (p.peak == null ? rr : p.peak) - rr;
              p.peak = null;
              if (drop >= 2.6) {
                // a long fall flattens poor Pogo for a moment
                p.state = 'flat';
                p.stateT = 0.7;
                Sfx.noise({ dur: 0.18, vol: 0.4, fc: 220 });
              } else {
                Sfx.noise({ dur: 0.05, vol: 0.18, fc: 350 });
              }
              if (rr > this.maxRow) { this.addScore((rr - this.maxRow) * 10); this.maxRow = rr; }
              break;
            }
          }
        }
        if (p.row < -0.4) { this.loseLife(true); return; }
      } else if (Math.floor(p.row) > this.maxRow) {
        this.addScore((Math.floor(p.row) - this.maxRow) * 10);
        this.maxRow = Math.floor(p.row);
      }
    }

    // enemies
    for (const b of this.bouncers) {
      if (!b.alive) continue;
      b.phase += dt * 3.1;
      b.row = b.base + Math.abs(Math.sin(b.phase)) * 1.7;
      b.c = this.wrapC(b.c + Math.sin(b.phase * 0.31) * dt * 0.7);
      if (p.invulT <= 0 && p.state === 'play' &&
          Math.abs(this.dcol(b.c, p.c)) < 0.5 && Math.abs(b.row - p.row) < 0.65) {
        this.knock();
      }
    }
    for (const cr of this.cruisers) {
      cr.c = this.wrapC(cr.c + cr.speed * dt);
      if (p.invulT <= 0 && p.state === 'play' &&
          Math.abs(this.dcol(cr.c, p.c)) < 0.5 && Math.abs(cr.row - p.row) < 0.65) {
        this.knock();
      }
    }

    // snowball
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i];
      const d = 11 * dt;
      s.c = this.wrapC(s.c + s.dir * d);
      s.dist += d;
      let dead = s.dist > 11;
      for (const b of this.bouncers) {
        if (b.alive && Math.abs(this.dcol(b.c, s.c)) < 0.55 && Math.abs(b.row - s.row) < 0.8) {
          b.alive = false;
          dead = true;
          this.addScore(100);
          Sfx.noise({ dur: 0.12, vol: 0.3, fc: 900 });
          Sfx.tone({ f: 600, f1: 900, type: 'square', dur: 0.08, vol: 0.2 });
        }
      }
      for (const cr of this.cruisers) {
        if (Math.abs(this.dcol(cr.c, s.c)) < 0.55 && Math.abs(cr.row - s.row) < 0.8) dead = true;
      }
      if (dead) this.shots.splice(i, 1);
    }

    // particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pt = this.particles[i];
      pt.t -= dt;
      pt.y += pt.vy * dt * (pt.sea ? -8 : 1);
      pt.x += pt.vx;
      pt.vy -= dt * (pt.sea ? 8 : 4);
      if (pt.t <= 0) this.particles.splice(i, 1);
    }

    // clouds drift
    for (const cl of this.clouds) {
      cl.x -= dt * 2.5;
      if (cl.x < -40) cl.x = 240;
    }

    // camera follows
    const target = Math.max(p.row, 2.2);
    this.camRow += (target - this.camRow) * Math.min(1, dt * 4);
  }

  /* ---------- the fishing bonus round ---------- */

  updateBonus(dt) {
    const b = this.bonus;
    if (b.doneT > 0) {
      b.doneT -= dt;
      if (b.doneT <= 0) {
        this.towerNum++;
        this.loadTower((this.towerIdx + 1) % 3);
        this.state = 'ready';
        this.stateT = 1.4;
      }
      return;
    }
    b.t -= dt;
    if (b.t <= 0) {
      b.doneT = 1.6;
      this.addScore(b.caught * 100);
      Sfx.playSeq([['C5', 1], ['E5', 1], ['G5', 1], ['C6', 2]], 0.08, { vol: 0.35 });
      return;
    }
    if (this.keys.up) b.subY -= 70 * dt;
    if (this.keys.down) b.subY += 70 * dt;
    b.subY = Math.max(58, Math.min(210, b.subY));
    if ((this.keys.jump || this.keys.fire) && b.bubbles.length < 2 && (b.shootCool || 0) <= 0) {
      b.bubbles.push({ x: 52, y: b.subY });
      b.shootCool = 0.35;
      Sfx.tone({ f: 220, f1: 480, type: 'sine', dur: 0.12, vol: 0.2 });
    }
    b.shootCool = Math.max(0, (b.shootCool || 0) - dt);
    b.spawnT -= dt;
    if (b.spawnT <= 0) {
      b.spawnT = 0.8 + Math.random() * 0.9;
      b.fish.push({
        x: 236, y: 60 + Math.random() * 145,
        v: 34 + Math.random() * 40, ph: Math.random() * 6.28, big: Math.random() < 0.25,
      });
    }
    for (let i = b.fish.length - 1; i >= 0; i--) {
      const f = b.fish[i];
      f.x -= f.v * dt;
      f.ph += dt * 6;
      if (f.x < -12) b.fish.splice(i, 1);
    }
    for (let i = b.bubbles.length - 1; i >= 0; i--) {
      const bl = b.bubbles[i];
      bl.x += 95 * dt;
      bl.y -= 6 * dt;
      let hit = false;
      for (let j = b.fish.length - 1; j >= 0; j--) {
        const f = b.fish[j];
        if (Math.abs(f.x - bl.x) < 8 && Math.abs(f.y + Math.sin(f.ph) * 4 - bl.y) < 7) {
          b.caught += f.big ? 3 : 1;
          b.fish.splice(j, 1);
          hit = true;
          Sfx.playSeq([['E5', 1], ['G5', 1]], 0.05, { vol: 0.25 });
          break;
        }
      }
      if (hit || bl.x > 230) b.bubbles.splice(i, 1);
    }
  }

  drawBonus(ctx) {
    const sea = ctx.createLinearGradient(0, 0, 0, this.H);
    sea.addColorStop(0, '#2a6ab0');
    sea.addColorStop(1, '#071c3d');
    ctx.fillStyle = sea;
    ctx.fillRect(0, 0, this.W, this.H);
    const t = performance.now() / 1000;
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    for (let i = 0; i < 4; i++) {
      for (let x = 0; x < this.W; x += 20) {
        ctx.fillRect(x + ((Math.sin(t + i + x * 0.04) * 6) | 0), 26 + i * 3, 8, 1);
      }
    }
    // seabed
    ctx.fillStyle = '#c8b06a';
    ctx.fillRect(0, 228, this.W, 28);
    ctx.fillStyle = '#a89050';
    for (let x = 8; x < this.W; x += 26) ctx.fillRect(x, 232, 10, 2);
    ctx.fillStyle = '#2f7a4f';
    for (let x = 18; x < this.W; x += 46) {
      ctx.fillRect(x, 214, 2, 14);
      ctx.fillRect(x - 3, 218 + Math.sin(t * 2 + x) * 2, 2, 8);
      ctx.fillRect(x + 3, 220 - Math.sin(t * 2 + x) * 2, 2, 8);
    }
    const b = this.bonus;
    // the submarine
    ctx.fillStyle = '#ffd24d';
    ctx.beginPath();
    ctx.ellipse(38, b.subY, 16, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e0a800';
    ctx.fillRect(30, b.subY - 13, 9, 6);
    ctx.fillRect(22, b.subY - 3, 4, 6);
    ctx.fillStyle = '#7fd4ff';
    ctx.beginPath();
    ctx.arc(42, b.subY - 1, 3.4, 0, Math.PI * 2);
    ctx.fill();
    // propeller wash
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    for (let i = 0; i < 3; i++) {
      ctx.fillRect(16 - i * 5, b.subY - 2 + Math.sin(t * 10 + i) * 3, 3, 2);
    }
    // fish
    for (const f of b.fish) {
      const fy = f.y + Math.sin(f.ph) * 4;
      ctx.fillStyle = f.big ? '#ff8de1' : '#8fd4ff';
      ctx.beginPath();
      ctx.ellipse(f.x, fy, f.big ? 8 : 5.5, f.big ? 5 : 3.4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(f.x + (f.big ? 7 : 5), fy);
      ctx.lineTo(f.x + (f.big ? 13 : 10), fy - 4);
      ctx.lineTo(f.x + (f.big ? 13 : 10), fy + 4);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#123';
      ctx.fillRect(f.x - (f.big ? 4 : 2.5), fy - 1.5, 1.6, 1.6);
    }
    // bubbles
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1;
    for (const bl of b.bubbles) {
      ctx.beginPath();
      ctx.arc(bl.x, bl.y, 3, 0, Math.PI * 2);
      ctx.stroke();
    }
    // HUD
    retroText(ctx, 'BONUS ROUND — GONE FISHING!', 112, 4, 9, '#ffe14d', 'center');
    retroText(ctx, 'CATCH ' + b.caught, 6, 16, 8, '#fff');
    retroText(ctx, 'TIME ' + Math.max(0, Math.ceil(b.t)), 218, 16, 8, '#fff', 'right');
    retroText(ctx, 'UP/DOWN STEER · SPACE BUBBLE', 112, 244, 8, '#cde', 'center');
    if (b.doneT > 0) {
      retroText(ctx, 'BONUS ' + (b.caught * 100), 112, 116, 12, '#7cfc6a', 'center');
    }
  }

  knock() {
    const p = this.pogo;
    p.state = 'stun';
    p.stateT = 1;
    p.vy = 1.6;
    p.grounded = false;
    p.invulT = 1.6;
    p.stunFrom = Math.floor(p.row);
    Sfx.tone({ f: 420, f1: 110, type: 'sawtooth', dur: 0.3, vol: 0.35 });
  }

  /* ---------- draw ---------- */

  yOf(row) { return 150 + (this.camRow - row) * this.TILE_H + this.sink * this.TILE_H; }

  draw() {
    const ctx = this.ctx, S = this.S;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(S, 0, 0, S, 0, 0);

    if (this.state === 'bonus') {
      this.drawBonus(ctx);
      if (this.paused) retroText(ctx, 'PAUSED', 112, 110, 12, '#fff', 'center');
      return;
    }

    // sky
    const sky = ctx.createLinearGradient(0, 0, 0, this.H);
    sky.addColorStop(0, '#1a2a6e');
    sky.addColorStop(0.55, '#3f6ab8');
    sky.addColorStop(1, '#7fb2e0');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, this.W, this.H);

    // sun + clouds
    ctx.fillStyle = '#ffe9a0';
    ctx.beginPath();
    ctx.arc(186, 34, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    for (const cl of this.clouds) {
      ctx.fillRect(cl.x, cl.y, cl.w, 5);
      ctx.fillRect(cl.x + 5, cl.y - 4, cl.w - 12, 5);
    }

    // sea
    const seaY = this.yOf(-0.55);
    if (seaY < this.H) {
      const sea = ctx.createLinearGradient(0, seaY, 0, this.H);
      sea.addColorStop(0, '#2a6ab0');
      sea.addColorStop(1, '#0c2a56');
      ctx.fillStyle = sea;
      ctx.fillRect(0, seaY, this.W, this.H - seaY);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      const t = performance.now() / 1000;
      for (let i = 0; i < 5; i++) {
        const wy = seaY + 3 + i * 7;
        if (wy > this.H) break;
        for (let x = 0; x < this.W; x += 16) {
          ctx.fillRect(x + ((Math.sin(t * 1.5 + i + x * 0.05) * 5) | 0), wy, 7, 1);
        }
      }
    }

    // tower
    const p = this.pogo;
    const rLo = Math.max(0, Math.floor(this.camRow - 12));
    const rHi = Math.min(this.map.length - 1, Math.ceil(this.camRow + 13));
    const order = [];
    for (let k = 0; k < this.COLS; k++) {
      const dc = this.dcol(k + 0.5, p.c);
      const cosA = Math.cos(dc * this.STEP);
      if (cosA < 0.06) continue;
      order.push({ k, dc, cosA, x: 112 + Math.sin(dc * this.STEP) * this.R });
    }
    order.sort((a, b) => a.cosA - b.cosA);

    for (const oc of order) {
      const w = Math.max(2.5, this.TILE_W * oc.cosA);
      const shade = 0.30 + 0.70 * oc.cosA;
      const bR = Math.round(196 * shade), bG = Math.round(150 * shade), bB = Math.round(88 * shade);
      for (let r = rLo; r <= rHi; r++) {
        if (r > this.towerTop) continue;
        const y = this.yOf(r);
        if (y < -12 || y > this.H + 12) continue;
        const t = this.map[r][oc.k];
        // core
        ctx.fillStyle = `rgb(${bR},${bG},${bB})`;
        ctx.fillRect(oc.x - w / 2, y - this.TILE_H, w, this.TILE_H);
        ctx.fillStyle = 'rgba(60,30,10,0.5)';
        ctx.fillRect(oc.x - w / 2, y - 1, w, 1);
        if (r % 2 === 0) ctx.fillRect(oc.x - 1, y - this.TILE_H, 1, this.TILE_H);
        // attachments
        if (t === 'T') {
          ctx.fillStyle = '#140a04';
          ctx.fillRect(oc.x - w / 2 + 1, y - this.TILE_H + 1, w - 2, this.TILE_H - 2);
        } else if (t === '-' || t === '*' || t === 'v' || t === 'G') {
          const lw = w + 4;
          ctx.fillStyle = t === '*' ? `rgb(${Math.round(150 * shade)},${Math.round(150 * shade)},${Math.round(160 * shade)})`
                                    : `rgb(${Math.round(96 * shade)},${Math.round(210 * shade)},${Math.round(120 * shade)})`;
          ctx.fillRect(oc.x - lw / 2, y - 3, lw, 3);
          ctx.fillStyle = 'rgba(255,255,255,0.5)';
          ctx.fillRect(oc.x - lw / 2, y - 3, lw, 1);
          if (t === 'G') {
            ctx.fillStyle = '#1a0a2a';
            ctx.fillRect(oc.x - 4, y - this.TILE_H - 3, 8, this.TILE_H);
            const gl = (Math.floor(performance.now() / 180) % 2) === 0;
            ctx.fillStyle = gl ? '#ffe14d' : '#ff8de1';
            ctx.fillRect(oc.x - 5, y - this.TILE_H - 4, 10, 1);
            ctx.fillRect(oc.x - 1, y - this.TILE_H, 2, 2);
          }
        } else if (t === 'E') {
          ctx.fillStyle = `rgb(${Math.round(170 * shade)},${Math.round(170 * shade)},${Math.round(185 * shade)})`;
          ctx.fillRect(oc.x - w / 2 - 2, y - 2, w + 4, 2);
        }
      }
      // tower cap
      const capY = this.yOf(this.towerTop + 1);
      if (capY > -10 && capY < this.H + 10) {
        ctx.fillStyle = `rgb(${Math.round(120 * shade)},${Math.round(70 * shade)},${Math.round(40 * shade)})`;
        ctx.fillRect(oc.x - w / 2, capY - 4, w, 4);
      }
    }

    // moving lift platforms
    for (const l of this.lifts) {
      if (l.state === 'idle') continue;
      const dc = this.dcol(l.col + 0.5, p.c);
      const cosA = Math.cos(dc * this.STEP);
      if (cosA < 0.06) continue;
      const x = 112 + Math.sin(dc * this.STEP) * this.R;
      const w = Math.max(2.5, this.TILE_W * cosA) + 4;
      const y = this.yOf(l.pos);
      ctx.fillStyle = '#b8b8cc';
      ctx.fillRect(x - w / 2, y - 2, w, 2);
    }

    // bouncers (flashing, like the original's blinking balls) & cruisers
    for (const b of this.bouncers) {
      if (!b.alive) continue;
      const dc = this.dcol(b.c, p.c);
      if (Math.cos(dc * this.STEP) < 0.1) continue;
      const x = 112 + Math.sin(dc * this.STEP) * this.R;
      const y = this.yOf(b.row) - 4;
      ctx.fillStyle = ['#ff4455', '#ffd24d', '#ff8de1'][Math.floor(b.phase * 4) % 3];
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillRect(x - 2, y - 2, 2, 2);
    }
    for (const cr of this.cruisers) {
      const dc = this.dcol(cr.c, p.c);
      if (Math.cos(dc * this.STEP) < 0.1) continue;
      const x = 112 + Math.sin(dc * this.STEP) * this.R;
      const y = this.yOf(cr.row) - 4;
      ctx.fillStyle = '#dddde8';
      ctx.fillRect(x - 4, y - 3, 8, 6);
      ctx.fillStyle = '#ff3355';
      ctx.fillRect(x - 2, y - 1, 4, 2);
    }

    // snowballs
    ctx.fillStyle = '#ffffff';
    for (const s of this.shots) {
      const dc = this.dcol(s.c, p.c);
      if (Math.cos(dc * this.STEP) < 0.06) continue;
      const x = 112 + Math.sin(dc * this.STEP) * this.R;
      ctx.beginPath();
      ctx.arc(x, this.yOf(s.row), 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // particles
    for (const pt of this.particles) {
      ctx.fillStyle = pt.sea ? '#bfe8ff' : '#c8c8d8';
      const py = pt.sea ? (seaY - pt.y) : this.yOf(pt.y);
      ctx.fillRect(pt.x, py, 2, 2);
    }

    // Pogo
    if (this.state !== 'over' && !(p.invulT > 0 && Math.floor(p.invulT * 12) % 2 === 1)) {
      const y = (p.state === 'tunnel')
        ? this.yOf(p.row) - 4
        : this.yOf(p.row) - 5;
      const flat = p.state === 'flat';
      const squish = flat ? 2.4 : (p.grounded && p.walkT > 0 ? Math.sin(p.walkT * 18) * 0.6 : 0);
      const wide = flat ? 1.5 : 1;
      const tunnelShrink = p.state === 'tunnel' ? Math.max(0.25, Math.abs(p.stateT / 0.35)) : 1;
      ctx.fillStyle = '#1a4a1c';
      ctx.beginPath();
      ctx.ellipse(112, y + squish, 5.4 * tunnelShrink * wide, (5.8 - squish) * tunnelShrink, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#46d848';
      ctx.beginPath();
      ctx.ellipse(112, y + squish, 4.6 * tunnelShrink * wide, (5 - squish) * tunnelShrink, 0, 0, Math.PI * 2);
      ctx.fill();
      if (tunnelShrink > 0.5 && !flat) {
        ctx.fillStyle = '#fff';
        ctx.fillRect(110 + p.dir * 1.5, y - 2.5, 2, 2.5);
        ctx.fillRect(113 + p.dir * 1.5, y - 2.5, 2, 2.5);
        ctx.fillStyle = '#123';
        ctx.fillRect(110.7 + p.dir * 2, y - 2, 1, 1.4);
        ctx.fillRect(113.7 + p.dir * 2, y - 2, 1, 1.4);
        ctx.fillStyle = '#ff8060';
        ctx.beginPath();
        ctx.arc(112 + p.dir * 3.4, y + 0.6, 1.4, 0, Math.PI * 2);   // the little snout
        ctx.fill();
        ctx.fillStyle = '#2a9c2c';
        const ft = p.walkT > 0 ? Math.sin(p.walkT * 18) * 1.5 : 0;
        ctx.fillRect(109 + ft, this.yOf(p.row) - 1, 2.4, 1.6);
        ctx.fillRect(112.6 - ft, this.yOf(p.row) - 1, 2.4, 1.6);
      }
      if (flat) {
        ctx.fillStyle = '#fff';
        ctx.fillRect(109.5, y + 0.8, 2, 1.4);
        ctx.fillRect(112.8, y + 0.8, 2, 1.4);
      }
    }
    if (!this.keys.left && !this.keys.right) p.walkT = 0;

    // HUD
    retroText(ctx, 'SCORE ' + String(this.score).padStart(6, '0'), 6, 3, 8, '#fff');
    retroText(ctx, 'HI ' + String(this.hi).padStart(6, '0'), 218, 3, 8, '#ffe14d', 'right');
    retroText(ctx, 'TOWER ' + this.towerNum, 6, 14, 8, '#7cfc6a');
    const tCol = this.time < 30 ? '#ff4455' : '#fff';
    retroText(ctx, 'TIME ' + String(Math.max(0, Math.ceil(this.time))), 218, 14, 8, tCol, 'right');
    for (let i = 0; i < Math.min(this.lives - 1, 4); i++) {
      ctx.fillStyle = '#46d848';
      ctx.beginPath();
      ctx.arc(10 + i * 11, 30, 3.6, 0, Math.PI * 2);
      ctx.fill();
    }

    // banners
    if (this.state === 'ready') {
      retroText(ctx, this.TOWER_NAMES[this.towerIdx] || ('TOWER ' + this.towerNum), 112, 90, 11, '#ffe14d', 'center');
      retroText(ctx, 'TOWER ' + this.towerNum + ' — CLIMB!', 112, 108, 9, '#fff', 'center');
    } else if (this.state === 'won') {
      retroText(ctx, 'TOWER CONQUERED!', 112, 96, 11, '#7cfc6a', 'center');
    } else if (this.state === 'dead') {
      retroText(ctx, 'OOPS...', 112, 96, 11, '#ff4455', 'center');
    } else if (this.state === 'over') {
      retroText(ctx, 'GAME OVER', 112, 90, 14, '#ff4455', 'center');
      retroText(ctx, 'SCORE ' + this.score, 112, 112, 9, '#fff', 'center');
      retroText(ctx, 'ENTER = PLAY AGAIN', 112, 128, 8, '#7cfc6a', 'center');
      retroText(ctx, 'ESC = MENU', 112, 139, 8, '#7cfc6a', 'center');
    }
    if (this.paused) {
      retroText(ctx, 'PAUSED', 112, 96, 12, '#fff', 'center');
    }
  }

  dispose() {
    this.music.stop();
    this.liftHum.stop();
  }
}
