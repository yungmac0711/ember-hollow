// Wren Ashby — companion body.
// M0 art pass: the custom Style-A wren.glb (art director) is a node hierarchy with joint pivots, no
// skinning:  Wren > hips > {leg_L, leg_R, torso > {satchel, cloak > hood_down, head, arm_L, arm_R}}, lantern
// WrenAnimator (wren-anim.js) drives it procedurally: walk cycle, idle breathing/sway, sit-warming
// at the fire, lantern pendulum swing, cloak sway and a hood up/down gesture. The hood_up node is
// grafted from wren-hood-up.glb. Falls back to a primitive placeholder if the GLB fails to load.
// Her grandmother's waylamp is a light *emitter* (§8: #E08A2E, 3.0, 6, decay 2) that competes for a
// slot in the LightBudget and fades out inside a lit campfire's radius.
import * as THREE from 'three';
import { steer } from '../world/colliders.js';
import { CONFIG } from '../config.js';
import { lambert } from '../assets.js';
import { Emitter } from '../render/lights.js';
import { liftCharacter, skinCharacter } from '../render/character-materials.js';
import { WrenAnimator } from './wren-anim.js';

export function buildWrenPrimitive() {
  const root = new THREE.Group();
  const cloak = lambert(0x2e3a4f), sweater = lambert(0xd9c7a3), trousers = lambert(0x3a3d42);
  const skin = lambert(0xe8c4a8), hair = lambert(0xb5562b), boots = lambert(0x6b4a2f);
  const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); root.add(m); return m; };
  add(new THREE.BoxGeometry(0.13, 0.75, 0.16), trousers, -0.09, 0.375, 0);
  add(new THREE.BoxGeometry(0.13, 0.75, 0.16), trousers, 0.09, 0.375, 0);
  add(new THREE.BoxGeometry(0.15, 0.1, 0.22), boots, -0.09, 0.05, 0.02);
  add(new THREE.BoxGeometry(0.15, 0.1, 0.22), boots, 0.09, 0.05, 0.02);
  add(new THREE.BoxGeometry(0.42, 0.5, 0.24), sweater, 0, 1.0, 0);
  add(new THREE.CylinderGeometry(0.2, 0.3, 0.55, 6), cloak, 0, 1.02, -0.03);
  const head = add(new THREE.BoxGeometry(0.26, 0.28, 0.26), skin, 0, 1.42, 0);
  add(new THREE.BoxGeometry(0.29, 0.14, 0.29), hair, 0, 1.55, -0.02);
  add(new THREE.BoxGeometry(0.29, 0.22, 0.08), hair, 0, 1.42, -0.13);
  add(new THREE.BoxGeometry(0.1, 0.6, 0.1), sweater, -0.27, 0.95, 0);
  add(new THREE.BoxGeometry(0.1, 0.6, 0.1), sweater, 0.27, 0.95, 0);
  return { root, parts: { head } };
}

function buildWaylamp() {
  const g = new THREE.Group();
  const brass = lambert(0x8a6a2a);
  const glass = new THREE.MeshBasicMaterial({ color: 0xe08a2e }); // emissive look, no light cost
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.06, 0.04, 6), brass); top.position.y = 0.1;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.11, 6), glass); body.position.y = 0.04;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.025, 6), brass); base.position.y = -0.02;
  g.add(top, body, base);
  return g;
}

export class Wren {
  /**
   * @param model  { root, hoodUp?: Object3D, fromFile }  (root = wren.glb scene or primitive)
   * @param budget LightBudget for the lantern emitter
   */
  constructor(scene, cave, model, startPos, budget) {
    this.cave = cave;
    this.root = new THREE.Group();
    this.model = model.root;
    this.root.add(this.model);
    this.pos = startPos.clone();
    this.heading = Math.PI;
    this.speed = 0;
    this.state = 'follow';
    this.anim = null;
    const L = CONFIG.companion.lantern;
    this.emitter = budget.add(new Emitter({ color: L.color, intensity: 0, distance: L.distance, decay: 2, priority: 2 }));
    this._lampOffset = new THREE.Vector3(0, 0.12, 0);
    if (model.fromFile) {
      this.anim = new WrenAnimator(this.model, model.hoodUp || null);
      if (!this.anim.ok) { console.warn('[wren] wren.glb missing pivots; static pose'); }
      this.lampNode = this.anim.lantern;
      const pl = this.lampNode?.userData?.pointLight;
      if (pl?.offset) this._lampOffset.fromArray(pl.offset);
    } else {
      // primitive fallback: a separate little waylamp at hip height
      this.lampNode = buildWaylamp();
      this.lampNode.position.set(0.3, 0.7, 0.12);
      this.root.add(this.lampNode);
    }
    liftCharacter(this.root); // STYLE_GUIDE §8 backlight fix (lantern crystal keeps its own glow)
    if (this.anim?.ok) skinCharacter(this.model, (n) => n === this.anim.hoodUp || n === this.anim.hoodDown); // hood swap stays separate
    this.lightOn = 1;
    // blob shadow
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.35, 12),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.02; this.root.add(shadow);
    // generous invisible hit box so a thumb tap on her always registers
    this.hit = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.8, 0.8), new THREE.MeshBasicMaterial({ visible: false }));
    this.hit.position.y = 0.9; this.root.add(this.hit);
    this.root.position.copy(this.pos);
    scene.add(this.root);
    this.target = new THREE.Vector3();
    this.status = 'beside Cam';
    this._nearFireT = 0;
    this._hoodT = 999;
    this.hoodUp = false;
    this._hoodInit = false;
  }

  /** Hood logic (judgement call, documented in README): the hood goes UP when the Long Dark is
   * thick around her (fire out, or far from any lit fire) and comes DOWN once she has sat in a lit
   * fire's warmth for a few seconds or the fog is thin. At least 10 s between changes so it never
   * flickers at the edge of the light. Spawn: no fire yet → fog thick → she starts hood-up. */
  _updateHood(dt, env, inFire) {
    const H = CONFIG.companion.hood;
    this._nearFireT = inFire ? this._nearFireT + dt : 0;
    this._hoodT += dt;
    const wantUp = env.fog === H.upWhenFog && !inFire;
    const wantDown = this._nearFireT > H.downNearFireSeconds || env.fog === 'thin';
    if (!this._hoodInit) { this._hoodInit = true; this.hoodUp = wantUp; this.anim?.setHood(wantUp, true); return; }
    if (this._hoodT < H.minToggleSeconds) return;
    if (!this.hoodUp && wantUp) { this.hoodUp = true; this._hoodT = 0; this.anim?.setHood(true); }
    else if (this.hoodUp && wantDown) { this.hoodUp = false; this._hoodT = 0; this.anim?.setHood(false); }
  }

  update(dt, player, fires, talking, env = { fog: 'thick' }) {
    const pp = player.pos;
    const fire = fires.nearest(pp, Infinity, true);
    const inFire = fire && Math.hypot(pp.x - fire.pos.x, pp.z - fire.pos.z) < fire.lightRadius;
    const selfInFire = fire && Math.hypot(this.pos.x - fire.pos.x, this.pos.z - fire.pos.z) < fire.lightRadius;
    let moveSpeed = 0, face = pp;
    // Chunk B: she helps gather — now and then she picks up something next to her and hands it to Cam
    this.gatherT = (this.gatherT ?? 20 + Math.random() * 15) - dt;
    if (!this.gathering && this.gatherT <= 0 && !talking && env.items) {
      this.gatherT = 20 + Math.random() * 20;
      const it = env.items.nearest(this.pos, 3, pp, 6);
      if (it) { this.gathering = it; this._gatherTime = 0; }
    }
    if (this.gathering) {
      const it = this.gathering;
      this._gatherTime += dt;
      const d = Math.hypot(it.pos.x - this.pos.x, it.pos.z - this.pos.z);
      if (!it.alive || this._gatherTime > 8 || talking) this.gathering = null;
      else if (d > 0.7) { moveSpeed = Math.min(2.6, 0.8 + d); face = it.pos; this.state = 'gather'; }
      else { env.onGather?.(it); this.gathered = (this.gathered || 0) + 1; this.gathering = null; }
    } else if (inFire && !talking) {
      // settle on the far side of the fire from Biscuit and warm her hands
      const ang = Math.atan2(pp.z - fire.pos.z, pp.x - fire.pos.x) - 1.0;
      this.target.set(fire.pos.x + Math.cos(ang) * 1.55, 0, fire.pos.z + Math.sin(ang) * 1.55);
      this.cave.resolve(this.target, 0.6);
      const d = Math.hypot(this.target.x - this.pos.x, this.target.z - this.pos.z);
      if (d > 0.3 && this.state !== 'fire') { moveSpeed = Math.min(3, 0.8 + d); face = this.target; this.state = 'toFire'; }
      else if (d > 1.2) { this.state = 'toFire'; moveSpeed = 1.5; face = this.target; }
      else { face = fire.pos; this.state = 'fire'; }
    } else {
      // walk alongside Cam, slightly behind and to the right
      const right = new THREE.Vector3(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
      this.target.copy(pp).addScaledVector(right, 1.6).addScaledVector(player.forward, -1.2);
      this.cave.resolve(this.target, 0.6);
      const d = Math.hypot(this.target.x - this.pos.x, this.target.z - this.pos.z);
      const dp = Math.hypot(pp.x - this.pos.x, pp.z - this.pos.z);
      if (dp > 25) { this.colliders?.resolve(this.target, 0.35); this.pos.copy(this.target); }
      if (d > 0.8 && !talking) { moveSpeed = Math.min(5, 1 + d * 1.3); face = d > 1.5 ? this.target : pp; this.state = 'follow'; }
      else this.state = 'idle';
    }
    let want = Math.atan2(face.x - this.pos.x, face.z - this.pos.z);
    if (moveSpeed > 0.3) want = steer(this.colliders, this.pos, want, 0.35, this._steer || (this._steer = {}));
    let dh = want - this.heading; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    const turn = dh * Math.min(1, dt * 6);
    this.heading += turn;
    this.speed += (moveSpeed - this.speed) * Math.min(1, dt * 5);
    if (this.speed > 0.02) {
      this.pos.x += Math.sin(this.heading) * this.speed * dt;
      this.pos.z += Math.cos(this.heading) * this.speed * dt;
      const ox = this.pos.x, oz = this.pos.z;
      this.cave.resolve(this.pos, 0.6);
      this.colliders?.resolve(this.pos, 0.35);
      // stuck behind a wall for a while (target unreachable) → step out beside Cam
      const moved = Math.hypot(this.pos.x - ox, this.pos.z - oz) / Math.max(dt, 1e-4);
      this._stuckT = moveSpeed > 1 && moved < this.speed * 0.25 ? (this._stuckT || 0) + dt : 0;
      if (this._stuckT > 2.5) {
        this._stuckT = 0; this.gathering = null;
        const back = player.forward.clone().multiplyScalar(-1.4).add(pp);
        this.cave.resolve(back, 0.6); this.colliders?.resolve(back, 0.35); this.pos.copy(back);
      }
    }
    this.pos.y = Math.max(this.cave.floorAt(this.pos.x, this.pos.z), this.floorAt ? this.floorAt(this.pos.x, this.pos.z) : -Infinity);
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.heading;

    this._updateHood(dt, env, selfInFire || this.state === 'fire');
    if (this.anim) {
      // head looks toward Cam when she's standing around or talking (relative to her heading)
      let look = Math.atan2(pp.x - this.pos.x, pp.z - this.pos.z) - this.heading;
      look = Math.atan2(Math.sin(look), Math.cos(look));
      this.anim.update(dt, {
        speed: this.speed,
        turnRate: dt > 0 ? turn / dt : 0,
        sit: this.state === 'fire' && this.speed < 0.4,
        look: (this.state === 'idle' || talking) ? look : 0,
        talking,
      });
    } else {
      this.model.position.y = Math.abs(Math.sin(performance.now() / 180)) * 0.03 * Math.min(1, this.speed);
    }

    // Waylamp emitter: off inside the campfire's light (light budget) — fade, don't pop.
    const want2 = inFire ? 0 : 1;
    this.lightOn += (want2 - this.lightOn) * Math.min(1, dt * 2);
    this.lampNode.updateWorldMatrix(true, false);
    this.emitter.pos.copy(this._lampOffset).applyMatrix4(this.lampNode.matrixWorld);
    this.emitter.intensity = CONFIG.companion.lantern.intensity * this.lightOn * (0.95 + Math.sin(performance.now() / 90) * 0.05);

    this.status = this.state === 'fire' ? 'sitting by the fire, warming her hands' : this.state === 'toFire' ? 'heading to the fire' : 'beside Cam';
    if (this.hoodUp) this.status += ', hood up against the cold';
  }
}
