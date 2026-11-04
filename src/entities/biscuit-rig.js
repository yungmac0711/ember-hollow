// Code-driven animation for the custom Style-A Biscuit (art/assets/dog/biscuit). The GLB is a node
// hierarchy with joint pivots (no skinning):
//   Biscuit > body > {leg_FL, leg_FR, leg_BL, leg_BR, tail, neck > {tag, head > {jaw, ear_L, ear_R}}}
// Authored poses (stand / sit / playbow / curled, baked by tools/extract-biscuit-poses.mjs) are blended
// by slerping node quaternions, then procedural layers go on top: walk cycle, tail carriage + wag,
// ear flop, jaw pant, head tilt and breathing.
import * as THREE from 'three';
import { BISCUIT_POSES } from './biscuit-poses.js';

const NODES = ['body', 'leg_FL', 'leg_FR', 'leg_BL', 'leg_BR', 'tail', 'neck', 'tag', 'head', 'jaw', 'ear_L', 'ear_R'];
const POSES = ['sit', 'playbow', 'curled'];
const D = Math.PI / 180;
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3();

export class BiscuitRig {
  constructor(root) {
    this.n = {};
    for (const name of NODES) this.n[name] = root.getObjectByName(name);
    this.ok = NODES.every((k) => this.n[k]);
    const toQ = (a) => new THREE.Quaternion(a[0], a[1], a[2], a[3]);
    const toV = (a) => new THREE.Vector3(a[0], a[1], a[2]);
    this.poses = {};
    for (const [pose, nodes] of Object.entries(BISCUIT_POSES)) {
      this.poses[pose] = {};
      for (const k of NODES) {
        const src = nodes[k] || BISCUIT_POSES.stand[k];
        this.poses[pose][k] = { q: toQ(src.q), t: toV(src.t) };
      }
    }
    this.w = { sit: 0, playbow: 0, curled: 0 }; // stand = remainder
    this.t = 0; this.walkPhase = 0; this.wagT = 0; this.tailX = -35 * D; this.pant = 0; this.earFlop = 0;
  }

  /**
   * @param {number} dt
   * @param {object} s  { pose:'stand'|'sit'|'playbow'|'curled', speed, wag (0..1), tail:'happy'|'high'|'tucked',
   *                      pant (0..1), tilt (rad), sniff (0..1) }
   */
  update(dt, s) {
    this.t += dt;
    // --- pose weights (smooth cross-fade, ~0.35 s; curling up is slower and sleepier)
    for (const p of POSES) {
      const rate = p === 'curled' ? 1.6 : 4;
      this.w[p] += ((s.pose === p ? 1 : 0) - this.w[p]) * Math.min(1, dt * rate);
    }
    const n = this.n, P = this.poses;
    // blend: start at stand, slerp toward each pose by its weight (sequential, order-stable)
    for (const k of NODES) {
      const node = n[k];
      node.quaternion.copy(P.stand[k].q);
      node.position.copy(P.stand[k].t);
      let acc = 0;
      for (const p of POSES) {
        const w = this.w[p];
        if (w < 1e-3) continue;
        acc += w;
        const f = w / acc; // incremental weighted average
        node.quaternion.slerp(P[p][k].q, f);
        node.position.lerp(P[p][k].t, f);
      }
      if (acc > 1) { /* weights overlap only briefly during cross-fades; fine */ }
    }
    const standW = Math.max(0, 1 - this.w.sit - this.w.playbow - this.w.curled);
    const restW = this.w.sit + this.w.curled;

    // --- walk cycle (diagonal pairs: FL+BR, FR+BL), trot bounce, scaled by speed and standing weight
    const moving = Math.min(1, s.speed / 1.8) * standW;
    this.walkPhase += dt * (3 + s.speed * 3.4) * (s.speed > 0.08 ? 1 : 0);
    const swing = moving * (s.speed > 4 ? 0.85 : 0.6);
    const ph = this.walkPhase;
    const legs = [['leg_FL', 0], ['leg_BR', 0], ['leg_FR', Math.PI], ['leg_BL', Math.PI]];
    for (const [k, off] of legs) {
      _q.setFromAxisAngle(_v.set(1, 0, 0), Math.sin(ph + off) * swing);
      n[k].quaternion.multiply(_q);
    }
    n.body.position.y += Math.abs(Math.sin(ph)) * 0.025 * moving - 0.012 * moving;
    _q.setFromAxisAngle(_v.set(0, 0, 1), Math.sin(ph) * 0.05 * moving); n.body.quaternion.multiply(_q);
    // breathing (slower + deeper when curled asleep)
    const br = Math.sin(this.t * (this.w.curled > 0.5 ? 1.6 : 3.2));
    n.body.position.y += br * 0.004 * (1 - moving);

    // --- head: curious tilt + sniff dip, layered on the pose
    _e.set(s.sniff * 0.35 + Math.sin(this.t * 6) * 0.05 * s.sniff, 0, s.tilt * (1 - this.w.curled));
    n.head.quaternion.multiply(_q.setFromEuler(_e));

    // --- ears flop with motion (rotate Z), relaxed when resting
    this.earFlop += ((Math.sin(ph * 2) * 0.3 * moving) - this.earFlop) * Math.min(1, dt * 12);
    n.ear_L.quaternion.multiply(_q.setFromAxisAngle(_v.set(0, 0, 1), this.earFlop + 0.06 * Math.sin(this.t * 1.3)));
    n.ear_R.quaternion.multiply(_q.setFromAxisAngle(_v.set(0, 0, 1), -this.earFlop - 0.06 * Math.sin(this.t * 1.3 + 1)));

    // --- jaw pant (~12°) after running / by the fire
    this.pant += (s.pant - this.pant) * Math.min(1, dt * 2);
    const jaw = this.pant * (0.5 + 0.5 * Math.sin(this.t * 14)) * 12 * D;
    n.jaw.quaternion.multiply(_q.setFromAxisAngle(_v.set(1, 0, 0), jaw));

    // --- tail: carriage (X) + wag (Y, ±25° at 6–8 Hz). Curled keeps its authored wrap-around tail.
    const tailTarget = s.tail === 'high' ? -70 * D : s.tail === 'tucked' ? 40 * D : this.w.sit > 0.5 ? 5 * D : -35 * D;
    this.tailX += (tailTarget - this.tailX) * Math.min(1, dt * 4);
    this.wagT += dt * (6 + s.wag * 2) * Math.PI * 2;
    const wagAmp = (s.tail === 'tucked' ? 6 : 25) * D * s.wag;
    _e.set(this.tailX, Math.sin(this.wagT) * wagAmp, 0);
    _q.setFromEuler(_e);
    n.tail.quaternion.slerp(_q, 1 - this.w.curled); // the pose's tail blends out except when curled
  }
}
