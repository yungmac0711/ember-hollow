// Cam, seen only while seated (first-person game): Art's cam-sit.glb (hood up) / cam-sit-hood-down.glb,
// loaded directly in the seated pose (origin at the feet, hips at 0.47, seat ≈ 0.45 m). Same node names
// as Wren under a root called `Cam`. `lantern` is an unlit belt pouch: no light is attached. The hood
// follows Wren's hood (same fog/fire rule, same spot). Each variant is lifted + skinned into one mesh;
// only the active one draws, and nothing draws while Cam is standing. Look is PROVISIONAL (Art + Cameron).
import * as THREE from 'three';
import { liftCharacter, skinCharacter } from '../render/character-materials.js';

const SEAT_H = 0.45;

export class CamSeated {
  /** @param up  loadScene('camSit') result (hood up); @param down  loadScene('camSitHoodDown') */
  constructor(scene, up, down) {
    this.root = new THREE.Group(); this.root.name = 'cam-seated'; this.root.visible = false;
    this.variants = {};
    for (const [k, s] of [['up', up], ['down', down]]) {
      if (!s?.fromFile) continue;
      const m = s.root; m.name = `cam-sit-${k}`;
      this.root.add(m);
      liftCharacter(m); skinCharacter(m);
      m.visible = false;
      this.variants[k] = { root: m, torso: m.getObjectByName('torso'), head: m.getObjectByName('head') };
    }
    this.ok = !!(this.variants.up || this.variants.down);
    if (this.ok) scene.add(this.root);
    this.hoodUp = null; this.t = 0;
  }

  setHood(up) {
    if (this.hoodUp === up) return;
    this.hoodUp = up;
    const want = (up ? this.variants.up : this.variants.down) || this.variants.up || this.variants.down;
    for (const v of Object.values(this.variants)) v.root.visible = v === want;
    this.active = want;
  }

  /** seat: { pos (seat top), yaw (camera yaw facing out) } or null; hoodUp mirrors Wren's hood */
  update(dt, seat, hoodUp) {
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
  }
}
