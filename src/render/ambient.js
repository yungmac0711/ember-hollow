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
      tints: h.tints.map((t) => ({ ch: cave.chambers[t.chamber], sky: new THREE.Color(t.sky), fog: new THREE.Color(t.fog) })),
    };
    this._sky = new THREE.Color(); this._ground = new THREE.Color(); this._fog = new THREE.Color();
    this.k = 1;
    // start at the exploration values (no fire yet)
    hemi.intensity = h.intensityFar; hemi.color.copy(this.c.sky[1]); hemi.groundColor.copy(this.c.ground[1]);
    fog.color.copy(this.c.fog[1]);
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
    for (const t of tints) {
      const z = 1 - ss(Math.hypot(playerPos.x - t.ch.x, playerPos.z - t.ch.z), t.ch.r, t.ch.r + 3);
      if (z <= 0) continue;
      this._sky.lerp(t.sky, h.tintSky * z);
      this._fog.lerp(t.fog, h.tintFog * z);
    }
    const a = 1 - Math.exp(-h.smoothing * dt);
    const target = THREE.MathUtils.lerp(h.intensity, h.intensityFar, k);
    this.hemi.intensity += (target - this.hemi.intensity) * a;
    this.hemi.color.lerp(this._sky, a);
    this.hemi.groundColor.lerp(this._ground, a);
    this.fog.color.lerp(this._fog, a);
  }
}
