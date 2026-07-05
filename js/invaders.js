/* invaders.js — Space Invaders. Internal resolution 224x256, drawn at 3x. */
'use strict';

class InvadersGame {
  constructor(api) {
    this.api = api;
    api.canvas.width = 672;
    api.canvas.height = 768;
    this.ctx = api.ctx;
    this.S = 3;
    this.W = 224;
    this.H = 256;

    const white = '#ffffff', green = '#33ff44', red = '#ff3355';
    this.sprites = {
      squid: [
        makeSprite([
          '...XX...', '..XXXX..', '.XXXXXX.', 'XX.XX.XX',
          'XXXXXXXX', '..X..X..', '.X.XX.X.', 'X.X..X.X'], '#e066ff'),
        makeSprite([
          '...XX...', '..XXXX..', '.XXXXXX.', 'XX.XX.XX',
          'XXXXXXXX', '.X.XX.X.', 'X......X', '.X....X.'], '#e066ff'),
      ],
      crab: [
        makeSprite([
          '..X.....X..', '...X...X...', '..XXXXXXX..', '.XX.XXX.XX.',
          'XXXXXXXXXXX', 'X.XXXXXXX.X', 'X.X.....X.X', '...XX.XX...'], '#5cd6ff'),
        makeSprite([
          '..X.....X..', 'X..X...X..X', 'X.XXXXXXX.X', 'XXX.XXX.XXX',
          'XXXXXXXXXXX', '.XXXXXXXXX.', '..X.....X..', '.X.......X.'], '#5cd6ff'),
      ],
      octo: [
        makeSprite([
          '....XXXX....', '.XXXXXXXXXX.', 'XXXXXXXXXXXX', 'XXX..XX..XXX',
          'XXXXXXXXXXXX', '...XX..XX...', '..XX.XX.XX..', 'XX........XX'], '#ffd24d'),
        makeSprite([
          '....XXXX....', '.XXXXXXXXXX.', 'XXXXXXXXXXXX', 'XXX..XX..XXX',
          'XXXXXXXXXXXX', '..XXX..XXX..', '.XX..XX..XX.', '..XX....XX..'], '#ffd24d'),
      ],
      player: makeSprite([
        '......X......', '.....XXX.....', '.....XXX.....', '.XXXXXXXXXXX.',
        'XXXXXXXXXXXXX', 'XXXXXXXXXXXXX', 'XXXXXXXXXXXXX', 'XXXXXXXXXXXXX'], green),
      ufo: makeSprite([
        '.....XXXXXX.....', '...XXXXXXXXXX...', '..XXXXXXXXXXXX..',
        '.XX.XX.XX.XX.XX.', 'XXXXXXXXXXXXXXXX', '..XXX..XX..XXX..',
        '...X........X...'], red),
      burst: makeSprite([
        '....X..X.....', '.X...XX...X..', '..X.X..X.X...', '...X....X....',
        'X..........X.', '...X....X....', '..X.X..X.X...', '.X...XX...X..'], white),
      playerBoom: [
        makeSprite([
          '.....X..X....', '.X..X.......X', '...X....X.X..', 'X..X.XX......',
          '....XXXX..X..', '.X.XXXXXX....', '..XXXXXXXX.X.', '.XXXXXXXXXX..'], green),
        makeSprite([
          'X...X....X..X', '..X....X.....', '.....X....X..', '..X.X.X...X.X',
          '.X..XXXX.....', '...XXXXXX..X.', '.XXXXXXXXX...', 'XXXXXXXXXXXX.'], green),
      ],
    };
    // type per row: widths used for collision + edge detection
    this.rowType = ['squid', 'crab', 'crab', 'octo', 'octo'];
    this.typeW = { squid: 8, crab: 11, octo: 12 };
    this.rowPts = [30, 20, 20, 10, 10];

    this.beatNotes = [110, 98, 87.3, 77.8];
    this.ufoWarble = Sfx.makeWarble({ f: 850, depth: 260, rate: 16, type: 'square', vol: 0.07 });

    this.hi = loadHi('invaders');
    this.newGame();
  }

  newGame() {
    this.score = 0;
    this.lives = 3;
    this.wave = 1;
    this.extraGiven = false;
    this.state = 'play';
    this.paused = false;
    this.keys = {};
    this.startWave();
  }

  startWave() {
    this.cols = 11; this.rows = 5;
    this.alive = [];
    for (let r = 0; r < this.rows; r++) this.alive.push(new Array(this.cols).fill(true));
    this.aliveCount = this.rows * this.cols;
    this.gx = 10;
    this.gy = 46 + 8 * Math.min(this.wave - 1, 5);
    this.dir = 1;
    this.frame = 0;
    this.beatIdx = 0;
    this.beatTimer = 0;
    this.px = 105;              // player x (left edge, 13 wide)
    this.bullet = null;
    this.bombs = [];
    this.bombTimer = this.rand(0.6, 1.2);
    this.explosions = [];
    this.popups = [];
    this.ufo = null;
    this.ufoTimer = this.rand(14, 24);
    this.ufoWarble.stop();
    this.banner = 1.6;
    this.makeBunkers();
  }

  rand(a, b) { return a + Math.random() * (b - a); }

  stepInterval() { return (this.aliveCount / 55) * 0.8 + 0.045; }

  makeBunkers() {
    this.bunkers = [];
    for (let i = 0; i < 4; i++) {
      const w = 22, h = 16;
      const grid = new Uint8Array(w * h);
      for (let r = 0; r < h; r++) {
        for (let c = 0; c < w; c++) {
          let solid = true;
          if (c + r < 4) solid = false;                    // top-left slope
          if ((w - 1 - c) + r < 4) solid = false;          // top-right slope
          if (r >= 12) {                                    // bottom arch
            const hw = [2, 4, 5, 6][r - 12];
            if (c >= 11 - hw && c <= 10 + hw) solid = false;
          }
          grid[r * w + c] = solid ? 1 : 0;
        }
      }
      const cnv = document.createElement('canvas');
      cnv.width = w; cnv.height = h;
      const g = cnv.getContext('2d');
      g.fillStyle = '#33ff44';
      for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) if (grid[r * w + c]) g.fillRect(c, r, 1, 1);
      this.bunkers.push({ x: 27 + i * 49, y: 192, w, h, grid, cnv, g });
    }
  }

  bunkerAt(x, y) {
    for (const b of this.bunkers) {
      if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) {
        const lx = Math.floor(x - b.x), ly = Math.floor(y - b.y);
        if (b.grid[ly * b.w + lx]) return { b, lx, ly };
      }
    }
    return null;
  }

  blast(b, lx, ly, r) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = lx + dx, y = ly + dy;
        if (x < 0 || y < 0 || x >= b.w || y >= b.h) continue;
        const d2 = dx * dx + dy * dy;
        if (d2 <= r * r || (d2 <= (r + 1.5) * (r + 1.5) && Math.random() < 0.45)) {
          if (b.grid[y * b.w + x]) { b.grid[y * b.w + x] = 0; b.g.clearRect(x, y, 1, 1); }
        }
      }
    }
  }

  damageRect(x, y, w, h) {
    for (const b of this.bunkers) {
      const x0 = Math.max(x, b.x), x1 = Math.min(x + w, b.x + b.w);
      const y0 = Math.max(y, b.y), y1 = Math.min(y + h, b.y + b.h);
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const lx = Math.floor(xx - b.x), ly = Math.floor(yy - b.y);
          if (b.grid[ly * b.w + lx]) { b.grid[ly * b.w + lx] = 0; b.g.clearRect(lx, ly, 1, 1); }
        }
      }
    }
  }

  alienRect(r, c) {
    const t = this.rowType[r], w = this.typeW[t];
    return { x: this.gx + c * 16 + Math.floor((16 - w) / 2), y: this.gy + r * 16, w, h: 8 };
  }

  key(e, down) {
    const k = e.code;
    if (k === 'ArrowLeft' || k === 'KeyA') this.keys.left = down;
    if (k === 'ArrowRight' || k === 'KeyD') this.keys.right = down;
    if (k === 'Space') this.keys.fire = down;
    if (down && k === 'KeyP' && this.state !== 'over') this.paused = !this.paused;
    if (down && k === 'Enter' && this.state === 'over') this.newGame();
  }

  fire() {
    this.bullet = { x: this.px + 6, y: 222 };
    Sfx.tone({ f: 950, f1: 120, type: 'square', dur: 0.18, vol: 0.35 });
  }

  addScore(n) {
    this.score += n;
    if (!this.extraGiven && this.score >= 1500) {
      this.extraGiven = true;
      this.lives++;
      Sfx.playSeq([['C5', 1], ['E5', 1], ['G5', 1], ['C6', 2]], 0.09, { vol: 0.4 });
    }
    if (this.score > this.hi) { this.hi = this.score; saveHi('invaders', this.hi); }
  }

  stepAliens() {
    // probe next horizontal position for edge contact
    let minX = 999, maxX = -999;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (!this.alive[r][c]) continue;
        const a = this.alienRect(r, c);
        minX = Math.min(minX, a.x); maxX = Math.max(maxX, a.x + a.w);
      }
    }
    if ((this.dir > 0 && maxX + 2 > 222) || (this.dir < 0 && minX - 2 < 2)) {
      this.dir *= -1;
      this.gy += 8;
    } else {
      this.gx += 2 * this.dir;
    }
    this.frame ^= 1;
    Sfx.tone({ f: this.beatNotes[this.beatIdx], type: 'square', dur: 0.09, vol: 0.5 });
    this.beatIdx = (this.beatIdx + 1) % 4;

    // aliens chew through bunkers as they descend
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (!this.alive[r][c]) continue;
        const a = this.alienRect(r, c);
        if (a.y + a.h >= 192 && a.y <= 208) this.damageRect(a.x, a.y, a.w, a.h);
      }
    }
    // invasion complete?
    for (let r = this.rows - 1; r >= 0; r--) {
      for (let c = 0; c < this.cols; c++) {
        if (this.alive[r][c] && this.gy + r * 16 + 8 >= 224) { this.gameOver(); return; }
      }
    }
  }

  gameOver() {
    this.state = 'over';
    this.ufoWarble.stop();
    this.bombs = [];
    Sfx.noise({ dur: 0.9, vol: 0.8, fc: 350 });
    Sfx.tone({ f: 300, f1: 40, type: 'sawtooth', dur: 1.1, vol: 0.4 });
  }

  dropBomb() {
    if (this.bombs.length >= 3) return;
    const cols = [];
    for (let c = 0; c < this.cols; c++) {
      for (let r = this.rows - 1; r >= 0; r--) {
        if (this.alive[r][c]) { cols.push({ r, c }); break; }
      }
    }
    if (!cols.length) return;
    const pick = cols[Math.floor(Math.random() * cols.length)];
    const a = this.alienRect(pick.r, pick.c);
    this.bombs.push({ x: a.x + Math.floor(a.w / 2), y: a.y + 8, phase: 0 });
  }

  killAlien(r, c) {
    this.alive[r][c] = false;
    this.aliveCount--;
    const a = this.alienRect(r, c);
    this.explosions.push({ x: a.x + a.w / 2 - 6, y: a.y, t: 0.25 });
    this.addScore(this.rowPts[r]);
    Sfx.noise({ dur: 0.25, vol: 0.6, fc: 900 });
    if (this.aliveCount === 0) {
      this.state = 'wave';
      this.stateT = 2.0;
      this.ufoWarble.stop();
    }
  }

  playerHit() {
    this.state = 'dying';
    this.stateT = 1.3;
    this.bombs = [];
    this.bullet = null;
    this.ufoWarble.stop();
    Sfx.noise({ dur: 0.8, vol: 0.9, fc: 420 });
  }

  update(dt) {
    if (this.paused || this.state === 'over') return;

    if (this.state === 'wave') {
      this.stateT -= dt;
      if (this.stateT <= 0) {
        this.wave++;
        this.state = 'play';
        this.startWave();
      }
      return;
    }
    if (this.state === 'dying') {
      this.stateT -= dt;
      if (this.stateT <= 0) {
        this.lives--;
        if (this.lives <= 0) { this.gameOver(); }
        else { this.state = 'play'; this.px = 105; }
      }
      return;
    }

    if (this.banner > 0) { this.banner -= dt; return; }

    // player
    if (this.keys.left) this.px -= 85 * dt;
    if (this.keys.right) this.px += 85 * dt;
    this.px = Math.max(6, Math.min(this.W - 19, this.px));
    if (this.keys.fire && !this.bullet) this.fire();

    // alien march
    this.beatTimer += dt;
    const iv = this.stepInterval();
    while (this.beatTimer >= iv && this.state === 'play') {
      this.beatTimer -= iv;
      this.stepAliens();
    }
    if (this.state !== 'play') return;

    // bombs
    this.bombTimer -= dt;
    if (this.bombTimer <= 0) {
      this.dropBomb();
      this.bombTimer = this.rand(0.35, Math.max(0.55, 1.35 - this.wave * 0.09));
    }
    const bombSpeed = Math.min(130, 68 + this.wave * 8);
    for (let i = this.bombs.length - 1; i >= 0; i--) {
      const bm = this.bombs[i];
      const ny = bm.y + bombSpeed * dt;
      let dead = false;
      for (let y = bm.y; y <= ny && !dead; y += 1) {
        const hit = this.bunkerAt(bm.x + 1, y + 6);
        if (hit) {
          this.blast(hit.b, hit.lx, hit.ly, 2);
          dead = true;
        } else if (y + 6 >= 224 && y + 6 <= 232 && bm.x + 1 >= this.px && bm.x + 1 <= this.px + 13) {
          this.playerHit();
          return;
        } else if (y + 6 >= 239) {
          this.explosions.push({ x: bm.x - 5, y: 233, t: 0.2 });
          dead = true;
        }
      }
      bm.y = ny;
      bm.phase += dt * 14;
      if (dead) this.bombs.splice(i, 1);
    }

    // player bullet
    if (this.bullet) {
      const bu = this.bullet;
      const ny = bu.y - 330 * dt;
      let consumed = false;
      for (let y = bu.y; y >= ny && !consumed; y -= 1) {
        // bunkers
        const hit = this.bunkerAt(bu.x, y);
        if (hit) { this.blast(hit.b, hit.lx, hit.ly, 2); consumed = true; break; }
        // aliens
        for (let r = 0; r < this.rows && !consumed; r++) {
          for (let c = 0; c < this.cols; c++) {
            if (!this.alive[r][c]) continue;
            const a = this.alienRect(r, c);
            if (bu.x >= a.x && bu.x < a.x + a.w && y >= a.y && y < a.y + a.h) {
              this.killAlien(r, c);
              consumed = true;
              break;
            }
          }
        }
        if (consumed) break;
        // ufo
        if (this.ufo && y >= 30 && y <= 37 && bu.x >= this.ufo.x && bu.x <= this.ufo.x + 16) {
          const pts = [50, 100, 150, 300][Math.floor(Math.random() * 4)];
          this.addScore(pts);
          this.popups.push({ x: this.ufo.x, y: 30, txt: String(pts), t: 1.2 });
          this.explosions.push({ x: this.ufo.x + 2, y: 29, t: 0.3 });
          this.ufo = null;
          this.ufoWarble.stop();
          Sfx.playSeq([['C6', 1], ['E6', 1], ['G6', 1]], 0.07, { vol: 0.4 });
          consumed = true;
          break;
        }
        // enemy bombs (bullets can shoot them down)
        for (let i = this.bombs.length - 1; i >= 0; i--) {
          const bm = this.bombs[i];
          if (Math.abs(bu.x - (bm.x + 1)) <= 2 && y >= bm.y && y <= bm.y + 7) {
            this.bombs.splice(i, 1);
            this.explosions.push({ x: bu.x - 6, y: y - 4, t: 0.2 });
            Sfx.noise({ dur: 0.12, vol: 0.3, fc: 1500 });
            consumed = true;
            break;
          }
        }
        if (y <= 26) { this.explosions.push({ x: bu.x - 6, y: 24, t: 0.2 }); consumed = true; }
      }
      if (consumed) this.bullet = null; else bu.y = ny;
    }

    // UFO
    if (this.ufo) {
      this.ufo.x += this.ufo.vx * dt;
      if (this.ufo.x < -18 || this.ufo.x > this.W + 2) { this.ufo = null; this.ufoWarble.stop(); }
    } else {
      this.ufoTimer -= dt;
      if (this.ufoTimer <= 0 && this.aliveCount >= 8) {
        const fromLeft = Math.random() < 0.5;
        this.ufo = { x: fromLeft ? -16 : this.W, vx: fromLeft ? 34 : -34 };
        this.ufoTimer = this.rand(16, 26);
        this.ufoWarble.start();
      }
    }

    // timers
    for (let i = this.explosions.length - 1; i >= 0; i--) {
      this.explosions[i].t -= dt;
      if (this.explosions[i].t <= 0) this.explosions.splice(i, 1);
    }
    for (let i = this.popups.length - 1; i >= 0; i--) {
      this.popups[i].t -= dt;
      if (this.popups[i].t <= 0) this.popups.splice(i, 1);
    }
  }

  draw() {
    const ctx = this.ctx, S = this.S;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 672, 768);
    ctx.setTransform(S, 0, 0, S, 0, 0);
    ctx.imageSmoothingEnabled = false;

    // HUD
    retroText(ctx, 'SCORE', 10, 4, 8, '#fff');
    retroText(ctx, String(this.score).padStart(4, '0'), 10, 14, 8, '#33ff44');
    retroText(ctx, 'HI-SCORE', 84, 4, 8, '#fff');
    retroText(ctx, String(this.hi).padStart(4, '0'), 84, 14, 8, '#ff3355');
    retroText(ctx, 'WAVE ' + this.wave, 214, 4, 8, '#fff', 'right');

    // UFO
    if (this.ufo) ctx.drawImage(this.sprites.ufo, Math.round(this.ufo.x), 30);

    // aliens
    for (let r = 0; r < this.rows; r++) {
      const spr = this.sprites[this.rowType[r]][this.frame];
      for (let c = 0; c < this.cols; c++) {
        if (!this.alive[r][c]) continue;
        const a = this.alienRect(r, c);
        ctx.drawImage(spr, a.x, a.y);
      }
    }

    // bunkers
    for (const b of this.bunkers) ctx.drawImage(b.cnv, b.x, b.y);

    // player
    if (this.state === 'dying') {
      const f = Math.floor(this.stateT * 12) % 2;
      ctx.drawImage(this.sprites.playerBoom[f], Math.round(this.px), 224);
    } else if (this.state !== 'over') {
      ctx.drawImage(this.sprites.player, Math.round(this.px), 224);
    }

    // bullet & bombs
    ctx.fillStyle = '#fff';
    if (this.bullet) ctx.fillRect(Math.round(this.bullet.x), Math.round(this.bullet.y), 1, 4);
    for (const bm of this.bombs) {
      const ph = Math.floor(bm.phase);
      for (let i = 0; i < 7; i++) {
        ctx.fillRect(bm.x + [1, 0, 1, 2][(i + ph) % 4], Math.round(bm.y) + i, 1, 1);
      }
    }

    // explosions
    for (const ex of this.explosions) ctx.drawImage(this.sprites.burst, Math.round(ex.x), Math.round(ex.y));

    // popups
    for (const p of this.popups) retroText(ctx, p.txt, p.x, p.y, 8, '#ff3355');

    // baseline + lives
    ctx.fillStyle = '#33ff44';
    ctx.fillRect(0, 239, this.W, 1);
    retroText(ctx, String(this.lives), 8, 243, 8, '#fff');
    for (let i = 0; i < Math.min(this.lives - 1, 5); i++) {
      ctx.drawImage(this.sprites.player, 22 + i * 18, 244);
    }
    retroText(ctx, 'CREDIT 01', 214, 243, 8, '#fff', 'right');

    // banners
    if (this.banner > 0 && this.state === 'play') {
      retroText(ctx, 'WAVE ' + this.wave, this.W / 2, 120, 10, '#33ff44', 'center');
    }
    if (this.state === 'wave') {
      retroText(ctx, 'WAVE CLEARED!', this.W / 2, 120, 10, '#33ff44', 'center');
    }
    if (this.paused) {
      retroText(ctx, 'PAUSED', this.W / 2, 120, 12, '#fff', 'center');
    }
    if (this.state === 'over') {
      retroText(ctx, 'GAME OVER', this.W / 2, 104, 16, '#ff3355', 'center');
      retroText(ctx, 'SCORE ' + this.score, this.W / 2, 128, 9, '#fff', 'center');
      retroText(ctx, 'ENTER = PLAY AGAIN', this.W / 2, 148, 8, '#33ff44', 'center');
      retroText(ctx, 'ESC = MENU', this.W / 2, 160, 8, '#33ff44', 'center');
    }
  }

  dispose() {
    this.ufoWarble.stop();
  }
}
