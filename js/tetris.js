/* tetris.js — Tetris. 10x20 well, NES-style scoring, Korobeiniki on square wave. */
'use strict';

const TET_PIECES = {
  I: { m: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]], c: '#00e6e6' },
  J: { m: [[1, 0, 0], [1, 1, 1], [0, 0, 0]], c: '#4466ff' },
  L: { m: [[0, 0, 1], [1, 1, 1], [0, 0, 0]], c: '#ff9933' },
  O: { m: [[1, 1], [1, 1]], c: '#ffd633' },
  S: { m: [[0, 1, 1], [1, 1, 0], [0, 0, 0]], c: '#33dd55' },
  T: { m: [[0, 1, 0], [1, 1, 1], [0, 0, 0]], c: '#bb44ee' },
  Z: { m: [[1, 1, 0], [0, 1, 1], [0, 0, 0]], c: '#ff4455' },
};

const TET_MELODY = [
  ['E5', 2], ['B4', 1], ['C5', 1], ['D5', 2], ['C5', 1], ['B4', 1],
  ['A4', 2], ['A4', 1], ['C5', 1], ['E5', 2], ['D5', 1], ['C5', 1],
  ['B4', 3], ['C5', 1], ['D5', 2], ['E5', 2],
  ['C5', 2], ['A4', 2], ['A4', 2], [null, 2],
  ['D5', 3], ['F5', 1], ['A5', 2], ['G5', 1], ['F5', 1],
  ['E5', 3], ['C5', 1], ['E5', 2], ['D5', 1], ['C5', 1],
  ['B4', 2], ['B4', 1], ['C5', 1], ['D5', 2], ['E5', 2],
  ['C5', 2], ['A4', 2], ['A4', 2], [null, 2],
];

class TetrisGame {
  constructor(api) {
    this.api = api;
    api.canvas.width = 672;
    api.canvas.height = 768;
    this.ctx = api.ctx;
    this.BX = 60;   // board origin (px)
    this.BY = 92;
    this.CELL = 30;
    this.music = Sfx.makeTune(TET_MELODY, 0.185, { type: 'square', vol: 0.28, gap: 0.88 });
    this.hi = loadHi('tetris');
    this.newGame();
  }

  newGame() {
    this.board = [];
    for (let r = 0; r < 20; r++) this.board.push(new Array(10).fill(0));
    this.score = 0;
    this.lines = 0;
    this.level = 1;
    this.bag = [];
    this.next = this.drawFromBag();
    this.state = 'play';
    this.paused = false;
    this.fallT = 0;
    this.lockT = 0;
    this.lockResets = 0;
    this.das = { dir: 0, t: 0 };
    this.soft = false;
    this.clearingRows = [];
    this.clearT = 0;
    this.overT = 0;
    this.animT = 0;
    this.spawn();
    this.music.start();
  }

  drawFromBag() {
    if (!this.bag.length) {
      this.bag = Object.keys(TET_PIECES);
      for (let i = this.bag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this.bag[i], this.bag[j]] = [this.bag[j], this.bag[i]];
      }
    }
    return this.bag.pop();
  }

  spawn() {
    const key = this.next;
    this.next = this.drawFromBag();
    const m = TET_PIECES[key].m.map(r => r.slice());
    this.cur = { key, m, x: Math.floor((10 - m.length) / 2), y: -1 };
    this.fallT = 0;
    this.lockT = 0;
    this.lockResets = 0;
    if (this.collides(this.cur.m, this.cur.x, this.cur.y)) {
      this.state = 'over';
      this.overT = 0;
      this.music.stop();
      if (this.score > this.hi) { this.hi = this.score; saveHi('tetris', this.hi); }
      Sfx.playSeq([['C5', 2], ['G4', 2], ['E4', 2], ['C4', 4]], 0.11, { type: 'sawtooth', vol: 0.35 });
    }
  }

  collides(m, x, y) {
    for (let r = 0; r < m.length; r++) {
      for (let c = 0; c < m[r].length; c++) {
        if (!m[r][c]) continue;
        const bx = x + c, by = y + r;
        if (bx < 0 || bx >= 10 || by >= 20) return true;
        if (by >= 0 && this.board[by][bx]) return true;
      }
    }
    return false;
  }

  rotated(m, ccw) {
    const n = m.length;
    const res = [];
    for (let r = 0; r < n; r++) {
      res.push(new Array(n).fill(0));
      for (let c = 0; c < n; c++) {
        res[r][c] = ccw ? m[c][n - 1 - r] : m[n - 1 - c][r];
      }
    }
    return res;
  }

  tryMove(dx, dy) {
    if (!this.cur) return false;
    if (this.collides(this.cur.m, this.cur.x + dx, this.cur.y + dy)) return false;
    this.cur.x += dx;
    this.cur.y += dy;
    if (dx !== 0 && this.lockResets < 12) { this.lockT = 0; this.lockResets++; }
    return true;
  }

  tryRotate(ccw) {
    if (!this.cur) return;
    const m = this.rotated(this.cur.m, ccw);
    const kicks = this.cur.key === 'I'
      ? [[0, 0], [-1, 0], [1, 0], [-2, 0], [2, 0], [0, -1]]
      : [[0, 0], [-1, 0], [1, 0], [0, -1], [-1, -1], [1, -1]];
    for (const [kx, ky] of kicks) {
      if (!this.collides(m, this.cur.x + kx, this.cur.y + ky)) {
        this.cur.m = m;
        this.cur.x += kx;
        this.cur.y += ky;
        if (this.lockResets < 12) { this.lockT = 0; this.lockResets++; }
        Sfx.tone({ f: 330, f1: 520, type: 'square', dur: 0.05, vol: 0.18 });
        return;
      }
    }
  }

  ghostY() {
    let y = this.cur.y;
    while (!this.collides(this.cur.m, this.cur.x, y + 1)) y++;
    return y;
  }

  gravity() {
    const t = [0.8, 0.72, 0.63, 0.55, 0.47, 0.38, 0.3, 0.22, 0.13, 0.1, 0.09, 0.08, 0.07, 0.06, 0.05];
    return t[Math.min(this.level - 1, t.length - 1)];
  }

  hardDrop() {
    const gy = this.ghostY();
    this.score += (gy - this.cur.y) * 2;
    this.cur.y = gy;
    Sfx.noise({ dur: 0.09, vol: 0.35, fc: 700 });
    this.lockPiece();
  }

  lockPiece() {
    const { m, x, y, key } = this.cur;
    let dead = false;
    for (let r = 0; r < m.length; r++) {
      for (let c = 0; c < m[r].length; c++) {
        if (!m[r][c]) continue;
        const by = y + r;
        if (by < 0) { dead = true; continue; }
        this.board[by][x + c] = TET_PIECES[key].c;
      }
    }
    this.cur = null;
    Sfx.tone({ f: 150, type: 'square', dur: 0.06, vol: 0.25 });
    Sfx.noise({ dur: 0.07, vol: 0.2, fc: 350 });
    if (dead) {
      this.state = 'over';
      this.overT = 0;
      this.music.stop();
      if (this.score > this.hi) { this.hi = this.score; saveHi('tetris', this.hi); }
      Sfx.playSeq([['C5', 2], ['G4', 2], ['E4', 2], ['C4', 4]], 0.11, { type: 'sawtooth', vol: 0.35 });
      return;
    }
    const full = [];
    for (let r = 0; r < 20; r++) {
      if (this.board[r].every(v => v)) full.push(r);
    }
    if (full.length) {
      this.state = 'clearing';
      this.clearingRows = full;
      this.clearT = 0;
      if (full.length === 4) Sfx.playSeq([['C5', 1], ['E5', 1], ['G5', 1], ['C6', 1], ['E6', 2]], 0.07, { vol: 0.45 });
      else Sfx.playSeq([['E5', 1], ['G5', 1], ['C6', 2]], 0.06, { vol: 0.35 });
    } else {
      this.spawn();
    }
  }

  finishClear() {
    const rows = this.clearingRows;
    this.board = this.board.filter((_, r) => !rows.includes(r));
    while (this.board.length < 20) this.board.unshift(new Array(10).fill(0));
    const n = rows.length;
    this.score += [0, 40, 100, 300, 1200][n] * this.level;
    this.lines += n;
    const newLevel = 1 + Math.floor(this.lines / 10);
    if (newLevel > this.level) {
      this.level = newLevel;
      Sfx.playSeq([['G4', 1], ['C5', 1], ['E5', 1], ['G5', 2]], 0.08, { vol: 0.4 });
    }
    if (this.score > this.hi) { this.hi = this.score; saveHi('tetris', this.hi); }
    this.clearingRows = [];
    this.state = 'play';
    this.spawn();
  }

  key(e, down) {
    const k = e.code;
    if (k === 'ArrowDown') { this.soft = down; return; }
    if (!down) {
      if ((k === 'ArrowLeft' && this.das.dir === -1) || (k === 'ArrowRight' && this.das.dir === 1)) {
        this.das.dir = 0;
      }
      return;
    }
    if (k === 'KeyP' && this.state !== 'over') {
      this.paused = !this.paused;
      if (this.paused) this.music.stop();
      else if (this.state !== 'over') this.music.start();
      return;
    }
    if (this.state === 'over') {
      if (k === 'Enter') this.newGame();
      return;
    }
    if (this.paused || this.state !== 'play') {
      // rotations/moves ignored while clearing or paused (except queued DAS below)
      if (k === 'ArrowLeft') { this.das.dir = -1; this.das.t = 0; }
      if (k === 'ArrowRight') { this.das.dir = 1; this.das.t = 0; }
      return;
    }
    if (k === 'ArrowLeft') {
      this.das.dir = -1; this.das.t = 0;
      if (this.tryMove(-1, 0)) Sfx.tone({ f: 210, type: 'square', dur: 0.03, vol: 0.12 });
    } else if (k === 'ArrowRight') {
      this.das.dir = 1; this.das.t = 0;
      if (this.tryMove(1, 0)) Sfx.tone({ f: 210, type: 'square', dur: 0.03, vol: 0.12 });
    } else if (k === 'ArrowUp' || k === 'KeyX') {
      this.tryRotate(false);
    } else if (k === 'KeyZ') {
      this.tryRotate(true);
    } else if (k === 'Space') {
      this.hardDrop();
    }
  }

  update(dt) {
    this.animT += dt;
    if (this.paused) return;

    if (this.state === 'over') { this.overT += dt; return; }

    if (this.state === 'clearing') {
      this.clearT += dt;
      if (this.clearT >= 0.38) this.finishClear();
      return;
    }
    if (!this.cur) return;

    // auto-repeat left/right
    if (this.das.dir !== 0) {
      this.das.t += dt;
      while (this.das.t > 0.17) {
        this.das.t -= 0.05;
        if (!this.tryMove(this.das.dir, 0)) { this.das.t = 0.17; break; }
      }
    }

    // gravity / soft drop
    const iv = this.soft ? Math.min(0.045, this.gravity()) : this.gravity();
    this.fallT += dt;
    while (this.fallT >= iv) {
      this.fallT -= iv;
      if (!this.collides(this.cur.m, this.cur.x, this.cur.y + 1)) {
        this.cur.y++;
        if (this.soft) this.score += 1;
        this.lockT = 0;
      } else {
        this.fallT = 0;
        break;
      }
    }

    // lock delay
    if (this.collides(this.cur.m, this.cur.x, this.cur.y + 1)) {
      this.lockT += dt;
      if (this.lockT >= 0.5 || this.soft) {
        if (this.soft && this.lockT < 0.08) {
          // small grace so soft drop doesn't insta-lock on touch
        } else {
          this.lockPiece();
        }
      }
    }
  }

  cell(ctx, px, py, color, size) {
    const s = size || this.CELL;
    ctx.fillStyle = color;
    ctx.fillRect(px, py, s, s);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(px, py, s, 3);
    ctx.fillRect(px, py, 3, s);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(px, py + s - 3, s, 3);
    ctx.fillRect(px + s - 3, py, 3, s);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillRect(px + 5, py + 5, Math.max(2, s / 7), Math.max(2, s / 7));
  }

  draw() {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 672, 768);

    // title
    const letters = [['T', '#ff4455'], ['E', '#ff9933'], ['T', '#ffd633'], ['R', '#33dd55'], ['I', '#00e6e6'], ['S', '#bb44ee']];
    letters.forEach(([ch, col], i) => {
      retroText(ctx, ch, 268 + i * 24, 26, 34, col);
    });

    const BX = this.BX, BY = this.BY, C = this.CELL;

    // well
    ctx.fillStyle = '#070714';
    ctx.fillRect(BX, BY, 10 * C, 20 * C);
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 10; i++) {
      ctx.beginPath(); ctx.moveTo(BX + i * C, BY); ctx.lineTo(BX + i * C, BY + 20 * C); ctx.stroke();
    }
    for (let i = 1; i < 20; i++) {
      ctx.beginPath(); ctx.moveTo(BX, BY + i * C); ctx.lineTo(BX + 10 * C, BY + i * C); ctx.stroke();
    }
    ctx.save();
    ctx.strokeStyle = '#00e6e6';
    ctx.lineWidth = 3;
    ctx.shadowColor = '#00e6e6';
    ctx.shadowBlur = 14;
    ctx.strokeRect(BX - 4, BY - 4, 10 * C + 8, 20 * C + 8);
    ctx.restore();

    // settled blocks
    const overRows = this.state === 'over' ? Math.floor(this.overT * 25) : -1;
    for (let r = 0; r < 20; r++) {
      const flashing = this.state === 'clearing' && this.clearingRows.includes(r);
      const buried = overRows >= 0 && r >= 20 - overRows;
      for (let c = 0; c < 10; c++) {
        let col = this.board[r][c];
        if (flashing) col = Math.floor(this.clearT * 14) % 2 ? '#ffffff' : col;
        if (buried) col = '#555566';
        if (col) this.cell(ctx, BX + c * C, BY + r * C, col);
      }
    }

    // current piece + ghost
    if (this.cur && this.state === 'play') {
      const gy = this.ghostY();
      ctx.globalAlpha = 0.22;
      for (let r = 0; r < this.cur.m.length; r++) {
        for (let c = 0; c < this.cur.m[r].length; c++) {
          if (this.cur.m[r][c] && gy + r >= 0) {
            this.cell(ctx, BX + (this.cur.x + c) * C, BY + (gy + r) * C, TET_PIECES[this.cur.key].c);
          }
        }
      }
      ctx.globalAlpha = 1;
      for (let r = 0; r < this.cur.m.length; r++) {
        for (let c = 0; c < this.cur.m[r].length; c++) {
          if (this.cur.m[r][c] && this.cur.y + r >= 0) {
            this.cell(ctx, BX + (this.cur.x + c) * C, BY + (this.cur.y + r) * C, TET_PIECES[this.cur.key].c);
          }
        }
      }
    }

    // side panel
    const PX = 430;
    retroText(ctx, 'NEXT', PX, 100, 20, '#fff');
    ctx.strokeStyle = '#334';
    ctx.lineWidth = 2;
    ctx.strokeRect(PX, 128, 130, 110);
    if (this.next) {
      const m = TET_PIECES[this.next].m;
      let minR = 9, maxR = -1, minC = 9, maxC = -1;
      for (let r = 0; r < m.length; r++) {
        for (let c = 0; c < m[r].length; c++) {
          if (m[r][c]) { minR = Math.min(minR, r); maxR = Math.max(maxR, r); minC = Math.min(minC, c); maxC = Math.max(maxC, c); }
        }
      }
      const s = 24;
      const ox = PX + 65 - ((maxC - minC + 1) * s) / 2;
      const oy = 183 - ((maxR - minR + 1) * s) / 2;
      for (let r = 0; r < m.length; r++) {
        for (let c = 0; c < m[r].length; c++) {
          if (m[r][c]) this.cell(ctx, ox + (c - minC) * s, oy + (r - minR) * s, TET_PIECES[this.next].c, s);
        }
      }
    }

    retroText(ctx, 'SCORE', PX, 280, 20, '#fff');
    retroText(ctx, String(this.score), PX, 306, 24, '#ffd633');
    retroText(ctx, 'LINES', PX, 360, 20, '#fff');
    retroText(ctx, String(this.lines), PX, 386, 24, '#33dd55');
    retroText(ctx, 'LEVEL', PX, 440, 20, '#fff');
    retroText(ctx, String(this.level), PX, 466, 24, '#00e6e6');
    retroText(ctx, 'TOP', PX, 520, 20, '#fff');
    retroText(ctx, String(Math.max(this.hi, this.score)), PX, 546, 24, '#ff4455');

    retroText(ctx, 'Z X ROTATE', PX, 640, 14, '#556');
    retroText(ctx, 'SPACE DROP', PX, 660, 14, '#556');
    retroText(ctx, 'P PAUSE  M MUTE', PX, 680, 14, '#556');

    if (this.paused) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(BX, BY, 10 * C, 20 * C);
      retroText(ctx, 'PAUSED', BX + 5 * C, BY + 9 * C, 26, '#fff', 'center');
    }
    if (this.state === 'over' && this.overT > 0.9) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(BX, BY, 10 * C, 20 * C);
      retroText(ctx, 'GAME OVER', BX + 5 * C, BY + 8 * C, 30, '#ff4455', 'center');
      retroText(ctx, 'SCORE ' + this.score, BX + 5 * C, BY + 10 * C, 18, '#fff', 'center');
      retroText(ctx, 'ENTER = PLAY AGAIN', BX + 5 * C, BY + 12 * C, 16, '#ffd633', 'center');
      retroText(ctx, 'ESC = MENU', BX + 5 * C, BY + 13 * C, 16, '#ffd633', 'center');
    }
  }

  dispose() {
    this.music.stop();
  }
}
