// Game audio (M1 chunk D): sampled sound from art/assets/audio (audio.json gains), all through Web Audio.
// Loops are decoded buffers on AudioBufferSourceNodes (loop=true, loopStart 0, loopEnd = duration) —
// never <audio loop>, which gaps on iOS. The AudioContext is created inside the title tap (iOS needs a
// gesture), suspended while the page is hidden and resumed when it comes back.
// Buses: master → { music, effects }. Settings set the three bus volumes (0..1).
const A = 'assets/audio/';
const CAVE_BED = 0.12; // user override: the cave beds all sit at 0.12 instead of their suggested volumes
// file → suggested_volume (audio.json)
const VOL = {
  'fire/fire-crackle-loop': 0.17, 'fire/fire-pop': 0.16,
  'cave/cave-drips-loop': CAVE_BED, 'cave/cave-wind-loop': CAVE_BED, 'cave/cave-ambience-loop': CAVE_BED,
  'footsteps/stone-1': 0.16, 'footsteps/stone-2': 0.23, 'footsteps/stone-3': 0.26, 'footsteps/stone-4': 0.17, 'footsteps/stone-5': 0.18, 'footsteps/stone-6': 0.25,
  'footsteps/grass-1': 0.14, 'footsteps/grass-2': 0.11, 'footsteps/grass-3': 0.12,
  'footsteps/wood-1': 0.14, 'footsteps/wood-2': 0.19, 'footsteps/wood-3': 0.13,
  'dog/yip-1': 0.4, 'dog/yip-2': 0.38, 'dog/yip-3': 0.28,
  'music/cozy-guitar-loop': 0.22,
  'ambience/rain-loop': 0.29, 'ambience/rain-shelter-loop': 0.22,
  'decor/chime-1': 0.3, 'decor/chime-2': 0.3, 'decor/chime-3': 0.3,
};
const STEPS = {
  stone: ['footsteps/stone-1', 'footsteps/stone-2', 'footsteps/stone-3', 'footsteps/stone-4', 'footsteps/stone-5', 'footsteps/stone-6'],
  grass: ['footsteps/grass-1', 'footsteps/grass-2', 'footsteps/grass-3'],
  wood: ['footsteps/wood-1', 'footsteps/wood-2', 'footsteps/wood-3'],
};
const YIPS = ['dog/yip-1', 'dog/yip-2', 'dog/yip-3'];
const CHIMES = ['decor/chime-1', 'decor/chime-2', 'decor/chime-3'];
// Which cave bed plays in which chamber (crossfaded as Cam walks between areas).
const BED_FOR_AREA = {
  lanternmouth: 'cave/cave-ambience-loop', glowcap: 'cave/cave-ambience-loop',
  flintseam: 'cave/cave-wind-loop',
  mossdrip: 'cave/cave-drips-loop', hushing: 'cave/cave-drips-loop', glowmere: 'cave/cave-drips-loop',
};
const BEDS = ['cave/cave-drips-loop', 'cave/cave-wind-loop', 'cave/cave-ambience-loop'];
const LOOPS = ['fire/fire-crackle-loop', ...BEDS, 'ambience/rain-loop', 'ambience/rain-shelter-loop', 'music/cozy-guitar-loop'];
const jitter = () => 0.95 + Math.random() * 0.1; // ±5% playbackRate on one-shots
const pick = (a) => a[Math.floor(Math.random() * a.length)];

export class GameAudio {
  constructor() {
    this.ctx = null; this.unlocked = false;
    this.buffers = {}; this.loops = {}; this._raw = {};
    this.vol = { master: 0.8, music: 1, effects: 1 };
    this._popT = 4; this._chimeT = 6 + Math.random() * 9; this._bed = 'cave/cave-ambience-loop';
    this.stats = { decoded: 0, failed: 0, steps: 0, yips: 0, pops: 0, chimes: 0 };
    this._sched = {};
    // Prefetch the bytes now (no AudioContext needed); decode once the title tap creates the context.
    for (const k of Object.keys(VOL)) {
      this._raw[k] = fetch(A + k + '.m4a').then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null);
    }
    const unlock = () => { this.unlock(); if (this.ctx && this.ctx.state !== 'running') this.ctx.resume?.().catch(() => {}); };
    for (const ev of ['touchend', 'pointerdown', 'keydown']) window.addEventListener(ev, unlock, true);
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) this.ctx.suspend().catch(() => {}); else this.ctx.resume().catch(() => {});
    });
  }

  unlock() {
    if (this.unlocked) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      const c = this.ctx;
      // iOS: play a 1-sample silent buffer inside the gesture to fully unlock output.
      const b = c.createBuffer(1, 1, 22050), s = c.createBufferSource();
      s.buffer = b; s.connect(c.destination); s.start(0);
      c.resume?.().catch(() => {});
      this.unlocked = true;
      this.master = c.createGain(); this.master.connect(c.destination);
      this.musicBus = c.createGain(); this.musicBus.connect(this.master);
      this.sfx = c.createGain(); this.sfx.connect(this.master);
      this._applyVol();
      // the fire crackle is positional: a panner at the nearest lit fire, listener at the camera
      this.firePan = c.createPanner();
      Object.assign(this.firePan, { panningModel: 'equalpower', distanceModel: 'linear', refDistance: 1.5, maxDistance: 14, rolloffFactor: 1 });
      this.firePan.connect(this.sfx);
      for (const k of LOOPS) {
        const g = c.createGain(); g.gain.value = 0;
        g.connect(k === 'music/cozy-guitar-loop' ? this.musicBus : k === 'fire/fire-crackle-loop' ? this.firePan : this.sfx);
        this.loops[k] = { gain: g, src: null, target: 0 };
      }
      this._decodeAll();
    } catch (e) { this.unlocked = false; }
  }

  async _decodeAll() {
    // loops first so the room fills in quickly; one-shots after
    const order = [...LOOPS, ...Object.keys(VOL).filter((k) => !LOOPS.includes(k))];
    for (const k of order) {
      try {
        const raw = await this._raw[k];
        if (!raw) { this.stats.failed++; continue; }
        const buf = await new Promise((res, rej) => {
          const p = this.ctx.decodeAudioData(raw, res, rej); // callback form for older Safari
          if (p && p.catch) p.catch(rej);
        });
        this.buffers[k] = buf; this.stats.decoded++;
        if (this.loops[k]) this._startLoop(k);
      } catch (_) { this.stats.failed++; } // undecodable → that sound stays silent (no console noise)
    }
    this._raw = {};
  }

  _startLoop(k) {
    const L = this.loops[k], buf = this.buffers[k];
    const s = this.ctx.createBufferSource();
    s.buffer = buf; s.loop = true; s.loopStart = 0; s.loopEnd = buf.duration;
    s.connect(L.gain);
    // long beds start at a random point so they never line up the same way twice
    s.start(0, k.startsWith('music') ? 0 : Math.random() * buf.duration);
    L.src = s;
  }

  /** Ramp a loop's gain to `v` (linear ramp over `secs`); only reschedules when the target moves. */
  _loopTo(k, v, secs) {
    const L = this.loops[k];
    if (!L || Math.abs(L.target - v) < 0.004) return;
    L.target = v;
    const g = L.gain.gain, t = this.ctx.currentTime;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(v, t + secs);
  }

  setVolumes(v) { Object.assign(this.vol, v); this._applyVol(); }
  _applyVol() {
    if (!this.master) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.vol.master, t, 0.05);
    this.musicBus.gain.setTargetAtTime(this.vol.music, t, 0.05);
    this.sfx.gain.setTargetAtTime(this.vol.effects, t, 0.05);
  }

  _one(k, gain = 1, dest = this.sfx) {
    if (!this.unlocked || !this.buffers[k] || this.ctx.state !== 'running') return false;
    const s = this.ctx.createBufferSource(), g = this.ctx.createGain();
    s.buffer = this.buffers[k]; s.playbackRate.value = jitter();
    g.gain.value = VOL[k] * gain;
    s.connect(g).connect(dest); s.start();
    return true;
  }

  /**
   * Per-frame mix. env: { fire: {level, pos} | null, cam: Object3D, area: id|null, cave: 0..1 (1 = underground),
   * rain: 0..1 (already 0 in caves), roof: bool, talking: bool, chimeNear: bool }
   */
  update(dt, env) {
    if (!this.unlocked || !this.master) return;
    const c = this.ctx, t = c.currentTime;
    // listener follows the camera
    if (env.cam) {
      const p = env.cam.position, l = c.listener;
      const fx = -Math.sin(env.cam.rotation.y), fz = -Math.cos(env.cam.rotation.y);
      if (l.positionX) { l.positionX.value = p.x; l.positionY.value = p.y; l.positionZ.value = p.z; l.forwardX.value = fx; l.forwardY.value = 0; l.forwardZ.value = fz; l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0; }
      else { l.setPosition?.(p.x, p.y, p.z); l.setOrientation?.(fx, 0, fz, 0, 1, 0); }
    }
    // fire: crackle loop at the nearest lit fire, plus the odd pop
    const f = env.fire;
    if (f && f.level > 0.001) {
      const P = this.firePan;
      if (P.positionX) { P.positionX.value = f.pos.x; P.positionY.value = f.pos.y + 0.4; P.positionZ.value = f.pos.z; } else P.setPosition?.(f.pos.x, f.pos.y + 0.4, f.pos.z);
    }
    this._loopTo('fire/fire-crackle-loop', f ? 0.17 * Math.min(1, f.level) : 0, 0.6);
    this._popT -= dt;
    if (this._popT <= 0) {
      this._popT = 3 + Math.random() * 6;
      if (f && f.prox > 0.15 && this._one('fire/fire-pop', f.prox * Math.min(1, f.level * 1.5))) this.stats.pops++;
    }
    // cave beds: crossfade to the bed for this area, faded out toward the surface
    if (env.area && BED_FOR_AREA[env.area]) this._bed = BED_FOR_AREA[env.area];
    for (const k of BEDS) this._loopTo(k, k === this._bed ? CAVE_BED * env.cave : 0, 2.0);
    // rain: outdoors vs. under a roof, 0.5 s crossfade; silent in caves (env.rain carries the surface weight)
    const r = Math.max(0, Math.min(1, env.rain || 0));
    this._loopTo('ambience/rain-loop', env.roof ? 0 : 0.29 * r, 0.5);
    this._loopTo('ambience/rain-shelter-loop', env.roof ? 0.22 * r : 0, 0.5);
    // music ducks 30% while Wren's chat is open
    this._loopTo('music/cozy-guitar-loop', 0.22 * (env.talking ? 0.7 : 1), 0.8);
    // wind chime: one of chime-1..3 every 6–15 s while Cam is near a placed chime
    this._chimeT -= dt;
    if (this._chimeT <= 0) {
      this._chimeT = 6 + Math.random() * 9;
      if (env.chimeNear && this._one(pick(CHIMES))) this.stats.chimes++;
    }
    void t;
  }

  /** One footstep on 'stone' | 'grass' | 'wood'. */
  step(surface) { if (this._one(pick(STEPS[surface] || STEPS.stone))) { this.stats.steps++; this.lastStep = surface; (this.stats.surfaces ||= {})[surface] = (this.stats.surfaces[surface] || 0) + 1; } }
  /** Biscuit's bark bubble. */
  bark() { if (this._one(pick(YIPS))) this.stats.yips++; }
  /** A single fire pop (lighting a fire, adding wood). */
  pop(level = 1) { if (this._one('fire/fire-pop', level)) this.stats.pops++; }
  chime(level = 1) { if (this._one(pick(CHIMES), level)) this.stats.chimes++; }

  /** Small procedural UI blip (pickups, menus) on the effects bus. */
  blip(freq = 660) {
    if (!this.unlocked || !this.sfx) return;
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = 'triangle'; o.frequency.setValueAtTime(freq, c.currentTime);
    o.frequency.exponentialRampToValueAtTime(freq * 1.5, c.currentTime + 0.08);
    g.gain.setValueAtTime(0.08, c.currentTime); g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.18);
    o.connect(g).connect(this.sfx); o.start(); o.stop(c.currentTime + 0.2);
  }
}
