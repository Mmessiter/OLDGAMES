/* util.js — shared retro drawing helpers. */
'use strict';

// Draw blocky arcade text. Coordinates are in the caller's (already scaled) space.
function retroText(ctx, str, x, y, size, color, align = 'left') {
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = `bold ${size}px "Courier New", Courier, monospace`;
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  ctx.fillText(str, x, y);
  ctx.restore();
}

// Build an offscreen canvas sprite from rows of 'X' / '.' characters, 1px per cell.
function makeSprite(rows, color) {
  const w = rows[0].length, h = rows.length;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = color;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (rows[y][x] !== '.' && rows[y][x] !== ' ') g.fillRect(x, y, 1, 1);
    }
  }
  return c;
}

// Draw a pixel-pattern directly (for one-offs like menu icons).
function drawPix(ctx, rows, x, y, s, color) {
  ctx.fillStyle = color;
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows[r].length; c++) {
      if (rows[r][c] !== '.' && rows[r][c] !== ' ') ctx.fillRect(x + c * s, y + r * s, s, s);
    }
  }
}

function loadHi(key) {
  try { return Number(localStorage.getItem('arcade.hi.' + key)) || 0; } catch (e) { return 0; }
}

function saveHi(key, v) {
  try { localStorage.setItem('arcade.hi.' + key, String(v)); } catch (e) { /* private mode */ }
}
