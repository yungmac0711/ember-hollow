// STYLE_GUIDE §8.1 darkness fix (Art-approved Nov 3 2026): distance-driven ambient. Uniform
// updates only — no extra lights. k = smoothstep(rIn, rIn + 6, d) from the nearest LIT fire
// (k = 1 before any fire is lit): 0 = at the fire (fire is the key light), 1 = exploring.
// Crystal chamber and pools add a zone tint to the sky colour and fog.
import * as THREE from 'three';
import { CONFIG } from '../config.js';

const H = () => CONFIG.render.hemi;
const ss = THREE.MathUtils.smoothstep;

export class AmbientController {
  constructor(hemi, fog, cave) {
    this.hemi = hemi; this.fog = fog; this.cave = cave;
    const h = H();
    this.c = {
      sky: [new THREE.Color(h.sky), new THREE.Color(h.skyFar)],
      ground: [new THREE.Color(h.ground), new THREE.Color(h.groundFar)],
      fog: [new THREE.Color(h.fogNear), new THREE.Color(h.fogFar)],
      tints: h.tints.map((t) => ({ ch: cave.chambers[t.chamber], sky: new THREE.Color(t.sky), fog: new THREE.Color(t.fog), fogW: t.fogW, density: t.density })),
    };
    this._sky = new THREE.Color(); this._ground = new THREE.Color(); this._fog = new THREE.Color();
    this.k = 1;
    // start at the exploration values (no fire yet)
    // own smoothed state (Chunk C: DayNight blends the surface on top of these every frame)
    this.cur = { intensity: h.intensityFar, sky: this.c.sky[1].clone(), ground: this.c.ground[1].clone(), fog: this.c.fog[1].clone() };
    this._apply();
  }

  update(dt, playerPos, fires) {
    const h = H();
    const f = fires.nearest(playerPos, Infinity, true);
    let k = 1;
    if (f) {
      const d = Math.hypot(f.pos.x - playerPos.x, f.pos.z - playerPos.z);
      const rIn = f.lightRadius;
      k = ss(d, rIn, rIn + h.outerPad);
    }
    this.k = k;
    const { sky, ground, fog, tints } = this.c;
    this._sky.lerpColors(sky[0], sky[1], k);
    this._ground.lerpColors(ground[0], ground[1], k);
    this._fog.lerpColors(fog[0], fog[1], k);
    this.zone = null; // {w, density}: a tint that also sets its own fog density (the Glowmere)
    for (const t of tints) {
      const z = 1 - ss(Math.hypot(playerPos.x - t.ch.x, playerPos.z - t.ch.z), t.ch.r, t.ch.r + 3);
      if (z <= 0) continue;
      this._sky.lerp(t.sky, h.tintSky * z);
      this._fog.lerp(t.fog, (t.fogW ?? h.tintFog) * z);
      if (t.density) this.zone = { w: z, density: t.density };
    }
    const a = 1 - Math.exp(-h.smoothing * dt);
    const target = THREE.MathUtils.lerp(h.intensity, h.intensityFar, k);
    const c = this.cur;
    c.intensity += (target - c.intensity) * a;
    c.sky.lerp(this._sky, a); c.ground.lerp(this._ground, a); c.fog.lerp(this._fog, a);
    this._apply();
  }
  _apply() {
    const c = this.cur;
    this.hemi.intensity = c.intensity; this.hemi.color.copy(c.sky); this.hemi.groundColor.copy(c.ground); this.fog.color.copy(c.fog);
  }
}
