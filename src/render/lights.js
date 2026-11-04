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
  get activeCount() { return this.slots.filter((s) => s.emitter && s.light.intensity > 0.01).length; }

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
    const want = this.emitters.filter((e) => e.score > 0).sort((a, b) => b.score - a.score).slice(0, this.slots.length);
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
      if (free) { free.emitter = e; free.fade = 0; }
    }
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
