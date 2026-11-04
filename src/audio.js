// Tiny procedural audio (no files): campfire crackle + pickup blip. The AudioContext is created
// and unlocked inside the first touch/click (iOS requires a user gesture, and plays nothing until then).
export class GameAudio {
  constructor() {
    this.ctx = null; this.unlocked = false; this.fireGain = null; this._popT = 0;
    const unlock = () => {
      this.unlock();
      if (this.unlocked) for (const ev of ['touchend', 'pointerdown', 'keydown']) window.removeEventListener(ev, unlock, true);
    };
    for (const ev of ['touchend', 'pointerdown', 'keydown']) window.addEventListener(ev, unlock, true);
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) this.ctx.suspend(); else this.ctx.resume();
    });
  }

  unlock() {
    if (this.unlocked) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = this.ctx || new AC();
      // iOS: play a 1-sample silent buffer inside the gesture to fully unlock output.
      const b = this.ctx.createBuffer(1, 1, 22050), s = this.ctx.createBufferSource();
      s.buffer = b; s.connect(this.ctx.destination); s.start(0);
      this.ctx.resume?.();
      this.unlocked = true;
      this._setupFire();
    } catch (e) { console.warn('[audio] unlock failed', e); }
  }

  _noiseBuffer(seconds = 2) {
    const n = this.ctx.sampleRate * seconds, b = this.ctx.createBuffer(1, n, this.ctx.sampleRate), d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) { last = last * 0.97 + (Math.random() * 2 - 1) * 0.03; d[i] = last * 6; } // brown-ish
    return b;
  }

  _setupFire() {
    const c = this.ctx;
    this.master = c.createGain(); this.master.gain.value = 0.8; this.master.connect(c.destination);
    this.fireGain = c.createGain(); this.fireGain.gain.value = 0; this.fireGain.connect(this.master);
    const src = c.createBufferSource(); src.buffer = this._noiseBuffer(); src.loop = true;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500;
    src.connect(lp).connect(this.fireGain); src.start();
    this._popBuf = c.createBuffer(1, Math.floor(c.sampleRate * 0.03), c.sampleRate);
    const d = this._popBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
  }

  /** @param level 0..1 loudness of the nearest fire (strength × proximity) */
  update(dt, level) {
    if (!this.unlocked || !this.fireGain) return;
    this.fireGain.gain.setTargetAtTime(level * 0.35, this.ctx.currentTime, 0.3);
    this._popT -= dt;
    if (level > 0.02 && this._popT <= 0) {
      this._popT = 0.05 + Math.random() * 0.35 / (0.3 + level);
      const s = this.ctx.createBufferSource(), g = this.ctx.createGain(), f = this.ctx.createBiquadFilter();
      s.buffer = this._popBuf; f.type = 'highpass'; f.frequency.value = 1200 + Math.random() * 2500;
      g.gain.value = level * (0.15 + Math.random() * 0.35);
      s.playbackRate.value = 0.6 + Math.random() * 1.2;
      s.connect(f).connect(g).connect(this.master); s.start();
    }
  }

  /** Biscuit's bark — audio hook (Chunk B ships the visual "woof!" only; drop a bark sample here). */
  bark() { /* intentionally silent for now */ }

  /** Soft crystal wind-chime tinkle (2–3 high sine partials, gentle decay). */
  chime(level = 1) {
    if (!this.unlocked || level <= 0) return;
    const c = this.ctx, t0 = c.currentTime;
    const notes = [1568, 1976, 2349, 2637].sort(() => Math.random() - 0.5).slice(0, 2 + (Math.random() < 0.5 ? 1 : 0));
    notes.forEach((f, i) => {
      const o = c.createOscillator(), g = c.createGain(), t = t0 + i * (0.12 + Math.random() * 0.1);
      o.type = 'sine'; o.frequency.setValueAtTime(f, t);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.03 * level, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
      o.connect(g).connect(this.master); o.start(t); o.stop(t + 1.5);
    });
  }

  blip(freq = 660) {
    if (!this.unlocked) return;
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = 'triangle'; o.frequency.setValueAtTime(freq, c.currentTime);
    o.frequency.exponentialRampToValueAtTime(freq * 1.5, c.currentTime + 0.08);
    g.gain.setValueAtTime(0.12, c.currentTime); g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.18);
    o.connect(g).connect(this.master); o.start(); o.stop(c.currentTime + 0.2);
  }
}
