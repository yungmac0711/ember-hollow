// Procedural animation for the custom Style-A Wren (no skinning, joint pivots only).
// Layers: walk cycle (legs/arms/hip bob/torso counter-twist), idle breathing + weight-shift sway,
// sit-warming at the fire (legs are single rigid pieces with no knee pivot, so instead of a true
// crouch she sits on the ground, legs out toward the flames, leaning in with both hands up),
// lantern pendulum (damped spring driven by her acceleration + turning, re-parented to her right
// hand so it swings from the handle), cloak sway, and a hand-to-hood gesture when the hood changes.
import * as THREE from 'three';

const PIVOTS = ['hips', 'leg_L', 'leg_R', 'torso', 'cloak', 'head', 'arm_L', 'arm_R'];
const smooth = (a, b, k) => a + (b - a) * k;
const _pq = new THREE.Quaternion(), _rq = new THREE.Quaternion(), _sq = new THREE.Quaternion(), _se = new THREE.Euler();

export class WrenAnimator {
  constructor(root, hoodUpNode) {
    this.root = root;
    this.n = {};
    for (const k of PIVOTS) this.n[k] = root.getObjectByName(k);
    this.ok = PIVOTS.every((k) => this.n[k]);
    this.hoodDown = root.getObjectByName('hood_down');
    this.hoodUp = hoodUpNode;
    if (this.hoodUp && this.n.head) { this.n.head.add(this.hoodUp); this.hoodUp.visible = false; }
    this.base = {};
    for (const k of PIVOTS) if (this.n[k]) this.base[k] = { p: this.n[k].position.clone(), r: this.n[k].rotation.clone() };

    // Lantern: hang it from the right hand, swinging about its handle (top of its bounds)
    this.lantern = root.getObjectByName('lantern');
    this.swing = null;
    if (this.lantern && this.n.arm_R) {
      root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(this.lantern);
      const top = new THREE.Vector3((box.min.x + box.max.x) / 2, box.max.y, (box.min.z + box.max.z) / 2);
      this.swing = new THREE.Group();
      this.swing.name = 'lantern_swing';
      this.n.arm_R.add(this.swing);
      this.swing.position.copy(this.n.arm_R.worldToLocal(top.clone()));
      this.swing.updateMatrixWorld(true);
      this.swing.attach(this.lantern);
      // M2 (Art): with the knee/elbow joints the hand is under elbow_R; hang the swing from it
      // (attach keeps the world pose) and keep it plumb in update().
      const elbow = root.getObjectByName('elbow_R');
      if (elbow) { root.updateMatrixWorld(true); elbow.attach(this.swing); }
    }
    this.t = Math.random() * 10;
    this.ph = 0;
    this.walk = 0; this.sit = 0; this.lookY = 0;
    this.lx = 0; this.lvx = 0; this.lz = 0; this.lvz = 0; // lantern spring state
    this.prevSpeed = 0;
    this.gesture = 0; this._hoodPending = null;
  }

  /** Raise/lower the hood. `instant` skips the hand gesture (used at spawn). */
  setHood(up, instant = false) {
    if (!this.hoodUp || !this.hoodDown) return;
    if (instant) { this._applyHood(up); return; }
    this.gesture = 1; this._hoodPending = up;
  }
  _applyHood(up) { this.hoodUp.visible = up; this.hoodDown.visible = !up; this._pop = 1; }

  update(dt, s) {
    if (!this.ok) return;
    const n = this.n, B = this.base;
    this.t += dt;
    const k = Math.min(1, dt * 6);
    this.walk = smooth(this.walk, Math.min(1, s.speed / 1.6), k);
    this.sit = smooth(this.sit, s.sit ? 1 : 0, Math.min(1, dt * 2.2));
    this.lookY = smooth(this.lookY, THREE.MathUtils.clamp(s.look || 0, -0.75, 0.75), Math.min(1, dt * 3));
    const w = this.walk * (1 - this.sit), si = this.sit;
    // stride ≈ 1.5 m per full cycle
    this.ph += dt * (s.speed / 1.5) * Math.PI * 2;
    const ph = this.ph, sn = Math.sin(ph);
    const breathe = Math.sin(this.t * 1.7);
    const sway = Math.sin(this.t * 0.6);

    // hips: bob twice per stride, idle weight shift; sitting drops her to the floor
    n.hips.position.set(
      B.hips.p.x + sway * 0.012 * (1 - w) * (1 - si),
      B.hips.p.y + (Math.abs(Math.cos(ph)) * 0.04 - 0.02) * w - 0.66 * si,
      B.hips.p.z - 0.12 * si);
    n.hips.rotation.set(0, sn * 0.08 * w, sn * 0.035 * w + sway * 0.015 * (1 - w) * (1 - si));

    // legs: swing opposite; sitting → both straight out toward the fire, slightly apart
    n.leg_L.rotation.set(sn * 0.55 * w - 1.42 * si, 0, -0.08 * si);
    n.leg_R.rotation.set(-sn * 0.55 * w - 1.42 * si, 0, 0.08 * si);

    // torso: counter-twist when walking, breathing, lean forward while walking / toward fire
    n.torso.rotation.set(0.05 * w + 0.2 * si + breathe * 0.012, -sn * 0.1 * w, 0);
    n.torso.scale.set(1, 1 + breathe * 0.006, 1 + breathe * 0.01);

    // arms: opposite to legs; the lantern arm swings less. Sitting: both hands up to the warmth
    // (left reaching in, right holding the lamp out). Hood gesture lifts the left hand to the head.
    let g = 0;
    if (this.gesture > 0) {
      this.gesture = Math.max(0, this.gesture - dt / 0.9);
      g = Math.sin((1 - this.gesture) * Math.PI); // 0→1→0
      if (this._hoodPending !== null && this.gesture < 0.5) { this._applyHood(this._hoodPending); this._hoodPending = null; }
    }
    const armL = -sn * 0.45 * w - 1.25 * si + breathe * 0.02 * (1 - w);
    n.arm_L.rotation.set(smooth(armL, -2.7, g), 0, 0.05 + 0.15 * si + 0.25 * g);
    n.arm_R.rotation.set(sn * 0.22 * w - 1.0 * si + breathe * 0.015 * (1 - w), 0, -0.05 - 0.12 * si);

    // head: look toward Cam, settle a little lower by the fire, small idle drift
    n.head.rotation.set(0.12 * si + Math.sin(this.t * 0.45) * 0.03, this.lookY * (1 - si * 0.6), Math.sin(this.t * 0.37) * 0.03);
    if (this._pop > 0) { this._pop = Math.max(0, this._pop - dt * 4); const p = 1 + Math.sin(this._pop * Math.PI) * 0.08; if (this.hoodUp?.visible) this.hoodUp.scale.setScalar(p); }

    // cloak: trails back when walking, breathes/sways at rest
    n.cloak.rotation.set(0.04 + 0.2 * w + Math.sin(this.t * 1.4) * 0.025 + Math.sin(ph * 2) * 0.04 * w + 0.45 * si,
      0, Math.sin(this.t * 0.9) * 0.025 * (1 - si));

    // lantern pendulum: keep it hanging down (counter the arm's rotation), plus a damped spring
    if (this.swing) {
      const acc = dt > 0 ? (s.speed - this.prevSpeed) / dt : 0;
      this.prevSpeed = s.speed;
      const K = 38, C = 3.2; // spring, damping (≈1 Hz swing, settles in ~1.5 s)
      const fx = acc * 0.09 + Math.sin(ph * 2) * 1.2 * w;   // forward/back
      const fz = -(s.turnRate || 0) * s.speed * 0.25 + Math.cos(ph) * 0.8 * w; // side-to-side
      this.lvx += (-K * this.lx - C * this.lvx + fx) * dt; this.lx += this.lvx * dt;
      this.lvz += (-K * this.lz - C * this.lvz + fz) * dt; this.lz += this.lvz * dt;
      this.lx = THREE.MathUtils.clamp(this.lx, -0.7, 0.7); this.lz = THREE.MathUtils.clamp(this.lz, -0.6, 0.6);
      // hang plumb whatever the arm/elbow/torso do: swing.quaternion = inverse(parent world quat) ×
      // root world quat, then the spring sway on top (M2: replaces the old per-joint counter-rotation)
      this.swing.parent.getWorldQuaternion(_pq).invert();
      this.swing.quaternion.copy(_pq.multiply(this.root.getWorldQuaternion(_rq))).multiply(_sq.setFromEuler(_se.set(this.lx, 0, this.lz)));
    }
  }
}
