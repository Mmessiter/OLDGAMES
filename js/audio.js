/* audio.js — tiny Web Audio chiptune engine shared by all three games. */
'use strict';

const Sfx = (() => {
  let ctx = null, master = null, muted = false;

  function ac() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.25;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function toggleMute() {
    muted = !muted;
    if (master) master.gain.value = muted ? 0 : 0.25;
    return muted;
  }

  // One enveloped oscillator note. `at` is an absolute ctx time (0 = now).
  function tone({ f = 440, f1 = null, type = 'square', dur = 0.1, vol = 0.5, at = 0, curve = 'exp' }) {
    if (!ac()) return;
    const t0 = at > 0 ? at : ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(f, 1), t0);
    if (f1 != null) {
      if (curve === 'lin') o.frequency.linearRampToValueAtTime(Math.max(f1, 1), t0 + dur);
      else o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t0 + dur);
    }
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    o.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + dur + 0.03);
  }

  // Filtered white-noise burst (explosions, thuds).
  function noise({ dur = 0.2, vol = 0.5, fc = 1200, at = 0 }) {
    if (!ac()) return;
    const t0 = at > 0 ? at : ctx.currentTime;
    const n = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(fc, t0);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    src.connect(filt); filt.connect(g); g.connect(master);
    src.start(t0); src.stop(t0 + dur + 0.03);
  }

  // Note name -> frequency ("A4", "C#5", "Eb3").
  const SEMI = { 'C': -9, 'C#': -8, 'Db': -8, 'D': -7, 'D#': -6, 'Eb': -6, 'E': -5, 'F': -4,
                 'F#': -3, 'Gb': -3, 'G': -2, 'G#': -1, 'Ab': -1, 'A': 0, 'A#': 1, 'Bb': 1, 'B': 2 };
  function nf(name) {
    const m = /^([A-G][#b]?)(-?\d)$/.exec(name);
    if (!m) return 440;
    return 440 * Math.pow(2, SEMI[m[1]] / 12 + (Number(m[2]) - 4));
  }

  // Play a sequence once. seq = [[noteName|null, lengthInUnits], ...]. Returns total duration (s).
  function playSeq(seq, unit, { type = 'square', vol = 0.4, gap = 0.92 } = {}) {
    let total = 0;
    for (const [, len] of seq) total += len * unit;
    if (!ac()) return total;
    let t = ctx.currentTime + 0.05;
    for (const [note, len] of seq) {
      const d = len * unit;
      if (note) tone({ f: nf(note), type, dur: Math.max(0.04, d * gap), vol, at: t });
      t += d;
    }
    return total + 0.05;
  }

  // Looping melody with look-ahead scheduling. seq as in playSeq.
  function makeTune(seq, unit, { type = 'square', vol = 0.35, gap = 0.9 } = {}) {
    let timer = null, idx = 0, nextAt = 0;
    function pump() {
      if (!ctx) return;
      while (nextAt < ctx.currentTime + 0.35) {
        const [note, len] = seq[idx];
        const d = len * unit;
        if (note) tone({ f: nf(note), type, dur: Math.max(0.04, d * gap), vol, at: nextAt });
        nextAt += d;
        idx = (idx + 1) % seq.length;
      }
    }
    return {
      start() {
        if (timer || !ac()) return;
        idx = 0;
        nextAt = ctx.currentTime + 0.06;
        pump();
        timer = setInterval(pump, 120);
      },
      stop() { if (timer) { clearInterval(timer); timer = null; } },
      get playing() { return !!timer; },
    };
  }

  // Continuous warble (UFO drone, sirens): oscillator with an LFO on its pitch.
  function makeWarble({ f = 600, depth = 200, rate = 8, type = 'square', vol = 0.12 }) {
    let o = null, g = null, lfo = null, lg = null;
    return {
      start() {
        if (o || !ac()) return;
        o = ctx.createOscillator(); g = ctx.createGain();
        lfo = ctx.createOscillator(); lg = ctx.createGain();
        o.type = type; o.frequency.value = f;
        lfo.type = 'sine'; lfo.frequency.value = rate;
        lg.gain.value = depth;
        lfo.connect(lg); lg.connect(o.frequency);
        g.gain.value = vol;
        o.connect(g); g.connect(master);
        o.start(); lfo.start();
      },
      set(freq, r) {
        if (o) { o.frequency.value = freq; if (r != null) lfo.frequency.value = r; }
      },
      stop() {
        if (o) {
          try { o.stop(); lfo.stop(); } catch (e) { /* already stopped */ }
          try { o.disconnect(); g.disconnect(); lfo.disconnect(); lg.disconnect(); } catch (e) {}
          o = g = lfo = lg = null;
        }
      },
      get playing() { return !!o; },
    };
  }

  return {
    ac, tone, noise, nf, playSeq, makeTune, makeWarble, toggleMute,
    get muted() { return muted; },
    get time() { return ctx ? ctx.currentTime : 0; },
  };
})();
