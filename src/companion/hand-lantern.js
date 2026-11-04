// M2 chunk A: Cam's hand lantern (art/assets/craft/hand_lantern.glb: root at the grip → `swing` →
// mesh + `light_point`). Cam is first-person, so the lantern shows as a held prop in the lower right
// of the view (camera child, drawn last over a cleared depth buffer so it never clips into walls) and
// lights the path ahead. Seated, Art's Cam holds it from elbow_R (see cam.js). Either way the light is
// ONE emitter in the LightBudget (no real lights on the models), priority 2.5: fire > lantern >
// torches > crystals. The hotbar slot lights / stows it.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CONFIG } from '../config.js';
import { Emitter } from '../render/lights.js';

const HL = CONFIG.handLantern;
const _yq = new THREE.Quaternion(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler(), _m = new THREE.Matrix4(), _v = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

/** Hang `swing` plumb: swing.quaternion = inverse(parent world quat) × rootQuat × sway(sx, sz). */
export function plumb(swing, rootQuat, sx = 0, sz = 0) {
  swing.parent.getWorldQuaternion(_q).invert();
  _q.multiply(rootQuat);
  swing.quaternion.copy(_q).multiply(_q2.setFromEuler(_e.set(sx, 0, sz)));
}

/**
 * Bake the swing subtree into 2 meshes (frame + glow), in swing-local space.
 * @param lit  true: Lambert frame (world-lit, seated Cam); false: unlit frame tinted by its own glow (first-person)
 */
export function bakeLantern(src, lit) {
  const swingSrc = src.getObjectByName('swing') || src;
  src.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(swingSrc.matrixWorld).invert();
  const frame = [], glow = [];
  swingSrc.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    g.applyMatrix4(_m.multiplyMatrices(inv, o.matrixWorld));
    const mat = o.material, em = mat.emissive && mat.emissive.getHex() ? mat.emissive : null;
    const c = em ? em.clone() : mat.color.clone();
    if (!em && !lit) c.multiply(new THREE.Color(1.0, 0.78, 0.55)).multiplyScalar(2.6); // warm, lit-from-within frame
    const n = g.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    (em ? glow : frame).push(g);
  });
  const swing = new THREE.Group(); swing.name = 'swing';
  const lp = src.getObjectByName('light_point');
  swing.userData.light = lp ? lp.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv) : new THREE.Vector3(0, -0.163, 0);
  const meshes = [];
  if (frame.length) meshes.push(new THREE.Mesh(mergeGeometries(frame), lit
    ? new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })
    : new THREE.MeshBasicMaterial({ vertexColors: true })));
  if (glow.length) meshes.push(new THREE.Mesh(mergeGeometries(glow), new THREE.MeshBasicMaterial({ vertexColors: true })));
  for (const m of meshes) { m.name = 'hand_lantern_mesh'; swing.add(m); }
  return { swing, meshes };
}

export class HandLantern {
  /**
   * @param model  loadScene('handLantern') result (or null → a small primitive lantern)
   */
  constructor(camera, model, budget, wayModel = null) {
    this.camera = camera;
    this.on = true;        // lit / stowed (hotbar toggle, saved)
    this.has = true;       // in the pack (it can be stored in a chest; tap the empty slot to make another)
    this.k = 0;            // 0..1 light fade
    this.emitter = budget.add(new Emitter({ color: HL.color, intensity: 0, distance: HL.distance, decay: HL.decay, priority: HL.priority }));
    this.srcs = { hand_lantern: model?.root || primitiveLantern(), waylamp: wayModel?.root || null };
    this.src = this.srcs.hand_lantern;
    // first-person prop: camera → fp (lower right) → swing (plumb + sway); one swing per variant
    const fp = new THREE.Group(); fp.name = 'fp-lantern';
    fp.position.fromArray(HL.fp.pos); fp.scale.setScalar(HL.fp.scale);
    this.fpSwings = {};
    for (const [kind, src] of Object.entries(this.srcs)) {
      if (!src) continue;
      const { swing, meshes } = bakeLantern(src, false);
      swing.visible = kind === 'hand_lantern';
      fp.add(swing); this.fpSwings[kind] = swing;
      meshes.forEach((m, i) => {
        // drawn after everything else over a cleared depth buffer: never pokes into a wall in front of Cam
        m.material.transparent = true; m.material.depthWrite = true; m.renderOrder = 1000 + i; m.frustumCulled = false;
        m.material.fog = false;
      });
      meshes[0].onBeforeRender = (renderer) => { renderer.state.buffers.depth.setMask(true); renderer.clearDepth(); };
    }
    camera.add(fp);
    this.fp = fp; this.fpSwing = this.fpSwings.hand_lantern;
    this.lightLocal = new THREE.Vector3().fromArray(HL.light);
    this.kind = 'hand_lantern'; this.spec = HL;
    this.gain = HL.gain || 1;
    this.sx = 0; this.sz = 0; this.vx = 0; this.vz = 0; this._yaw = null; this.t = 0;
    this.seatLamp = null; // set by CamSeated each frame while seated: { swing, root }
    this.onVariant = null; // (kind) => void — cam.js swaps the seated copy
  }

  /** M2 chunk B: 'hand_lantern' | 'waylamp' (the waylamp replaces the hand lantern in the same slot). */
  setVariant(kind) {
    if (kind === this.kind) return;
    this._applySpec(kind);
    for (const [k, sw] of Object.entries(this.fpSwings)) sw.visible = k === kind;
    this.fpSwing = this.fpSwings[kind] || this.fpSwings.hand_lantern;
    if (this.srcs[kind]) this.src = this.srcs[kind];
    this.onVariant?.(kind);
  }
  _applySpec(kind) {
    this.kind = kind;
    this.spec = kind === 'waylamp' ? { ...HL, ...CONFIG.waylamp } : HL;
    this.emitter.color.set(this.spec.color);
    this.gain = this.spec.gain || 1;
  }

  /** Seated Cam's own copy (Lambert, world-lit), for cam.js to parent to elbow_R. */
  makeSeated() { return bakeLantern(this.src, true).swing; }

  get lit() { return this.on && this.has; }
  toggle() { if (!this.has) return false; this.on = !this.on; return this.on; }

  /** env: { player, seated: {swing}|null, inFire, nightSurface, paused } */
  update(dt, env) {
    const p = env.player;
    this.t += dt;
    const want = this.lit ? 1 : 0;
    this.k += (want - this.k) * Math.min(1, dt * 5);
    if (Math.abs(this.k - want) < 0.002) this.k = want;
    const seated = env.seated;
    this.fp.visible = this.lit && !seated && !env.hideFp;
    // sway: walk bob + a damped spring kicked by turning (±10–12°)
    const yaw = p.yaw; const dy = this._yaw == null ? 0 : Math.atan2(Math.sin(yaw - this._yaw), Math.cos(yaw - this._yaw)); this._yaw = yaw;
    const turn = dt > 0 ? dy / dt : 0, wk = Math.min(1, (p.speed || 0) / CONFIG.player.walkSpeed), ph = (p._bob || 0) * Math.PI;
    const K = 40, C = 4.5;
    this.vz += (-K * this.sz - C * this.vz + turn * 1.6) * dt; this.sz += this.vz * dt;
    this.vx += (-K * this.sx - C * this.vx) * dt; this.sx += this.vx * dt;
    const lim = 0.2; // ≈ 11.5°
    const sx = THREE.MathUtils.clamp(this.sx + Math.sin(ph) * 0.16 * wk, -lim, lim);
    const sz = THREE.MathUtils.clamp(this.sz + Math.cos(ph * 0.5) * 0.13 * wk, -lim, lim);
    this.swayX = sx; this.swayZ = sz;
    if (this.fp.visible) {
      // the prop bobs a touch with each step; the swing hangs plumb under the camera's yaw (not pitch)
      this.fp.position.set(HL.fp.pos[0] + Math.cos(ph * 0.5) * 0.01 * wk, HL.fp.pos[1] + Math.abs(Math.sin(ph)) * 0.012 * wk, HL.fp.pos[2]);
      this.camera.updateMatrixWorld(true);
      plumb(this.fpSwing, _yq.setFromEuler(_e.set(0, yaw, 0)), sx, sz);
    }
    // light: 3.5 / 8; surface at night away from a fire 4.5 / 9 (waylamp 4.5 / 10, night 5.5 / 11)
    const S = this.spec, ns = env.inFire ? 0 : (env.nightSurface || 0), day = THREE.MathUtils.clamp(env.daylight || 0, 0, 1);
    const I = THREE.MathUtils.lerp(S.intensity, S.night.intensity, ns), D = THREE.MathUtils.lerp(S.distance, S.night.distance, ns);
    // Art-approved: in the dark the pool reaches darkDistance (11 m; waylamp 13.75), daylight keeps the spec
    this.emitter.distance = THREE.MathUtils.lerp(Math.max(D, S.darkDistance || D), D, day);
    const gain = THREE.MathUtils.lerp(this.gain, 1, day); // the path gain is for the dark: plain spec in daylight
    this.emitter.intensity = I * gain * this.k * (0.97 + Math.sin(this.t * 11) * 0.02 + Math.sin(this.t * 4.3) * 0.01);
    if (seated?.swing) {
      seated.swing.updateWorldMatrix(true, false);
      this.emitter.pos.copy(seated.swing.userData.light).applyMatrix4(seated.swing.matrixWorld);
    } else {
      // yaw frame only: looking up or down doesn't swing the pool of light off the path
      this.camera.getWorldPosition(this.emitter.pos);
      this.emitter.pos.add(_v.copy(this.lightLocal).applyAxisAngle(_up, yaw));
      // ...and it rides a hand's height over the ground there, so the pool lands on the path
      if (env.floorAt) {
        const fy = env.floorAt(this.emitter.pos.x, this.emitter.pos.z);
        if (Number.isFinite(fy)) this.emitter.pos.y = THREE.MathUtils.clamp(fy + HL.floorLift, this.emitter.pos.y - 0.6, this.emitter.pos.y + 0.4);
      }
    }
  }
}

function primitiveLantern() {
  const root = new THREE.Group(), swing = new THREE.Group(); swing.name = 'swing'; root.add(swing);
  const iron = new THREE.MeshLambertMaterial({ color: 0x1a1d24 });
  const glass = new THREE.MeshLambertMaterial({ color: 0xffb347, emissive: 0xffb347 });
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 0.04, 6), iron); top.position.y = -0.06;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.1, 6), glass); body.position.y = -0.14;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.02, 6), iron); base.position.y = -0.2;
  swing.add(top, body, base);
  const lp = new THREE.Object3D(); lp.name = 'light_point'; lp.position.y = -0.163; swing.add(lp);
  return root;
}
