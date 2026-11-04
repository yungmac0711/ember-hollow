// Cam, seen only while seated (first-person game): Art's cam-sit.glb (hood up) / cam-sit-hood-down.glb,
// loaded directly in the seated pose (origin at the feet, hips at 0.47, seat ≈ 0.45 m). Same node names
// as Wren under a root called `Cam`. `lantern` is an unlit belt pouch; M2: the hand lantern hangs from
// elbow_R (its light is the HandLantern emitter, never a real light on this model). The hood
// follows Wren's hood (same fog/fire rule, same spot). Each variant is lifted + skinned into one mesh;
// only the active one draws, and nothing draws while Cam is standing. Look is PROVISIONAL (Art + Cameron).
import * as THREE from 'three';
import { liftCharacter, skinCharacter } from '../render/character-materials.js';
import { CONFIG } from '../config.js';
import { plumb } from './hand-lantern.js';

const SEAT_H = 0.45;
const _rq = new THREE.Quaternion();

export class CamSeated {
  /** @param up  loadScene('camSit') result (hood up); @param down  loadScene('camSitHoodDown') */
  constructor(scene, up, down, makeLantern = null) {
    this.root = new THREE.Group(); this.root.name = 'cam-seated'; this.root.visible = false;
    this.variants = {};
    for (const [k, s] of [['up', up], ['down', down]]) {
      if (!s?.fromFile) continue;
      const m = s.root; m.name = `cam-sit-${k}`;
      this.root.add(m);
      liftCharacter(m); skinCharacter(m);
      m.visible = false;
      // M2 chunk A: the hand lantern hangs from elbow_R at (0, −0.32, 0.02), rotation 0, added after
      // skinning so it stays its own small mesh; `swing` is kept plumb in update().
      const elbow = m.getObjectByName('elbow_R') || m.getObjectByName('arm_R');
      let lamp = null;
      if (elbow && makeLantern) {
        lamp = new THREE.Group(); lamp.name = 'hand_lantern';
        lamp.position.fromArray(elbow.name === 'elbow_R' ? CONFIG.handLantern.elbow : [0, -0.62, 0.02]);
        const swing = makeLantern(); lamp.add(swing); elbow.add(lamp); lamp.userData.swing = swing;
      }
      this.variants[k] = { root: m, torso: m.getObjectByName('torso'), head: m.getObjectByName('head'), lamp };
    }
    this.ok = !!(this.variants.up || this.variants.down);
    if (this.ok) scene.add(this.root);
    this.hoodUp = null; this.t = 0;
  }

  /** M2 chunk B: the waylamp replaced the hand lantern — swap the seated copy on every variant. */
  setLamp(makeLantern) {
    for (const v of Object.values(this.variants)) {
      if (!v.lamp) continue;
      v.lamp.remove(v.lamp.userData.swing);
      const swing = makeLantern(); v.lamp.add(swing); v.lamp.userData.swing = swing;
    }
  }

  setHood(up) {
    if (this.hoodUp === up) return;
    this.hoodUp = up;
    const want = (up ? this.variants.up : this.variants.down) || this.variants.up || this.variants.down;
    for (const v of Object.values(this.variants)) v.root.visible = v === want;
    this.active = want;
  }

  /** seat: { pos (seat top), yaw (camera yaw facing out) } or null; hoodUp mirrors Wren's hood */
  update(dt, seat, hoodUp, lanternLit = false, sway = null) {
    this.lamp = null;
    if (!this.ok) return;
    if (!seat) { if (this.root.visible) this.root.visible = false; return; }
    this.root.visible = true;
    this.setHood(!!hoodUp);
    this.root.position.set(seat.pos.x, seat.pos.y - SEAT_H, seat.pos.z);
    this.root.rotation.y = seat.yaw + Math.PI; // model faces +Z; the seated camera looks along −Z rotated by yaw
    // a slow breath + small head drift so a still Cam doesn't read as a statue
    this.t += dt; const v = this.active;
    if (v?.torso) v.torso.rotation.x = Math.sin(this.t * 1.6) * 0.012;
    if (v?.head) v.head.rotation.y = Math.sin(this.t * 0.23) * 0.12;
    if (v?.lamp) {
      v.lamp.visible = !!lanternLit;
      if (lanternLit) {
        const sw = v.lamp.userData.swing;
        v.root.updateWorldMatrix(true, true);
        plumb(sw, v.root.getWorldQuaternion(_rq), Math.sin(this.t * 0.9) * 0.03, Math.sin(this.t * 0.7) * 0.025);
        this.lamp = { swing: sw };
      }
    }
  }
}
