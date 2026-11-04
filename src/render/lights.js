// Dynamic point-light budget. The style guide (§6) allows 1 campfire + 1 lantern + hemisphere on a
// phone, so the scene owns a FIXED pool of `maxPointLights` PointLights (fixed count = no shader
// recompiles). Campfires, Wren's lantern and torches are *emitters*: each frame the highest-scoring
// emitters near the camera borrow a slot; everything else stays emissive-only (flames, glow sprites).
// Slot hand-overs cross-fade (fade out → retarget → fade in) so lights never pop.
import * as THREE from 'three';

export class Emitter {
  constructor({ color, intensity = 1, distance = 6, decay = 2, priority = 1, offset = null }) {
    this.pos = new THREE.Vector3();
    this.color = new THREE.Color(color);
    this.intensity = intensity;  // current desired intensity (owner animates flicker / fades)
    this.distance = distance;
    this.decay = decay;
    this.priority = priority;    // campfire 3, lantern 2, torch 1
    this.offset = offset;
    this.score = 0;
  }
}

export class LightBudget {
  constructor(scene, maxLights = 2) {
    this.emitters = [];
    this.slots = [];
    // Chunk C (§8.2): the sun/moon is a no-shadow DirectionalLight that is ALWAYS in the scene (fixed
    // light count = no shader recompiles) but only shines while it holds one of the pool's slots.
    // DayNight sets sunTarget (phase intensity × surface blend) and isMoon each frame.
    this.sun = new THREE.DirectionalLight(0xffffff, 0);
    this.sun.castShadow = false;
    this.sun.position.set(0, 10, 0); this.sun.target.position.set(0, 0, 0);
    scene.add(this.sun, this.sun.target);
    this.sunTarget = 0; this.isMoon = false; this.sunFade = 0; this.moonDropped = 0;
    for (let i = 0; i < maxLights; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 1, 2);
      light.position.set(0, -100, 0);
      scene.add(light);
      this.slots.push({ light, emitter: null, fade: 0 });
    }
  }

  add(emitter) { this.emitters.push(emitter); return emitter; }
  remove(emitter) {
    this.emitters = this.emitters.filter((e) => e !== emitter);
    for (const s of this.slots) if (s.emitter === emitter) { s.emitter = null; s.fade = 0; s.light.intensity = 0; }
  }

  /** Number of slots currently contributing light (for the perf report). */
  get activeCount() { return this.slots.filter((s) => s.emitter && s.light.intensity > 0.01).length + (this.sun.intensity > 0.01 ? 1 : 0); }
  get pointCount() { return this.slots.filter((s) => s.emitter && s.light.intensity > 0.01).length; }

  update(dt, viewPos) {
    // score: priority only counts while the camera is inside (or near) the light's own range —
    // a campfire 12 m behind you lights nothing on screen, so a torch beside you wins its slot.
    for (const e of this.emitters) {
      if (e.intensity <= 0.01) { e.score = 0; continue; }
      const d = e.pos.distanceTo(viewPos);
      const reach = e.distance + 8;
      if (d > reach) { e.score = 0; continue; }
      e.score = (d < e.distance + 2 ? e.priority * 10 : 0) + (1 - d / reach) * 5;
    }
    const ranked = this.emitters.filter((e) => e.score > 0).sort((a, b) => b.score - a.score);
    // Sun/moon slot. Drop-the-moon rule (§8.2): at night, if a campfire plus the rest want every slot,
    // the moon gives its slot up (DayNight raises the night hemi instead). The daytime sun always wins.
    // Chunk D: Wren's lantern (priority 2) counts too, so on the surface at night it behaves as in §8.1
    // (3.5 / 7, the exploration key light) even on the 1-slot low tier instead of losing to the moon.
    const inRange = ranked.filter((e) => e.score >= 10);
    const dropMoon = this.isMoon && inRange.length >= this.slots.length && inRange.some((e) => e.priority >= 2);
    const sunWants = this.sunTarget > 0.01 && !dropMoon;
    this.moonDropped += ((this.isMoon && dropMoon && this.sunTarget > 0.01 ? 1 : 0) - this.moonDropped) * Math.min(1, dt * 2);
    const nPoint = this.slots.length - (sunWants ? 1 : 0);
    const want = ranked.slice(0, nPoint);
    // release slots whose emitter fell out of the top-N (fade out first)
    for (const s of this.slots) {
      if (s.emitter && !want.includes(s.emitter)) {
        s.fade = Math.max(0, s.fade - dt * 3);
        if (s.fade === 0) s.emitter = null;
      }
    }
    // hand free slots to wanted emitters without one
    for (const e of want) {
      if (this.slots.some((s) => s.emitter === e)) continue;
      const free = this.slots.find((s) => !s.emitter);
      const cap = this.slots.length - (this.sun.intensity > 0.01 ? 1 : 0); // wait for the moon to fade out
      if (free && this.slots.filter((s) => s.emitter).length < cap) { free.emitter = e; free.fade = 0; }
    }
    // the sun only fades in once a point slot has actually been handed back (never 3 lights at once)
    const busy = this.slots.filter((s) => s.emitter).length;
    const canSun = sunWants && busy <= nPoint;
    this.sunFade = canSun ? Math.min(1, this.sunFade + dt * 1.5) : Math.max(0, this.sunFade - dt * 3);
    this.sun.intensity = this.sunTarget * this.sunFade * this.sunFade * (3 - 2 * this.sunFade);
    for (const s of this.slots) {
      const e = s.emitter;
      if (!e) { s.light.intensity = 0; continue; }
      if (want.includes(e)) s.fade = Math.min(1, s.fade + dt * 2.5);
      const k = s.fade * s.fade * (3 - 2 * s.fade);
      s.light.position.copy(e.pos);
      s.light.color.copy(e.color);
      s.light.distance = e.distance;
      s.light.decay = e.decay;
      s.light.intensity = e.intensity * k;
    }
  }
}
