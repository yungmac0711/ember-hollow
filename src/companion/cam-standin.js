// Polish pass (PROVISIONAL, pending Art): a seated stand-in for Cam so the seated camera can frame
// Cam and Wren together. Cam has no model of their own (first-person), so this re-uses wren.glb,
// recoloured from STYLE_GUIDE palette swatches, hood up, no lantern. It only exists while seated
// (shown on sit, hidden on stand), so it costs nothing while exploring (~3 draw calls when shown).
import * as THREE from 'three';
import { liftCharacter, skinCharacter } from '../render/character-materials.js';
import { WrenAnimator } from './wren-anim.js';

// material name → palette colour (Fresh Plank cloak, Hearth Earth hem, Wet Stone sweater, soot hair,
// boot-brown vest, charcoal trousers); skin unchanged
const RECOLOR = {
  wren_cloak_slate: 0x8a6440, wren_cloak_hem_moss: 0x5a4636, wren_sweater_oatmeal: 0x3e4a57,
  wren_hair_copper: 0x3b3330, wren_vest_leather: 0x4a3322, wren_trousers_charcoal: 0x3a3d42,
};

export class CamStandIn {
  /** @param model { root, fromFile } from a second loadScene('companion'); hoodUp from 'companionHood' */
  constructor(scene, model, hoodUp) {
    this.ok = !!model?.fromFile;
    if (!this.ok) return;
    this.root = new THREE.Group(); this.root.name = 'cam-standin';
    this.model = model.root;
    this.model.traverse((o) => {
      if (!o.isMesh) return;
      const m = o.material; if (!m) return;
      const hex = RECOLOR[m.name]; if (hex != null) { o.material = m.clone(); o.material.color.setHex(hex); }
    });
    if (hoodUp) hoodUp.traverse((o) => { if (o.isMesh && RECOLOR[o.material?.name] != null) { o.material = o.material.clone(); o.material.color.setHex(RECOLOR[o.material.name]); } });
    this.anim = new WrenAnimator(this.model, hoodUp || null);
    const lamp = this.anim.lantern; if (lamp) lamp.visible = false;
    this.root.add(this.model);
    liftCharacter(this.root);
    if (this.anim.ok) skinCharacter(this.model, (n) => n === this.anim.hoodUp || n === this.anim.hoodDown || n === lamp);
    this.anim.setHood(true, true);
    this.root.visible = false;
    scene.add(this.root);
    this.k = 0;
  }

  /** seat: { pos (seat top), yaw (facing) } or null */
  update(dt, seat) {
    if (!this.ok) return;
    if (seat) {
      this.root.visible = true;
      // facing: the model faces +Z; seat.yaw is a camera yaw (looks toward −Z rotated by yaw)
      this.root.position.set(seat.pos.x, seat.pos.y - 0.05, seat.pos.z);
      this.root.rotation.y = seat.yaw + Math.PI;
      this.anim.update(dt, { speed: 0, turnRate: 0, sit: true, look: 0, talking: false });
    } else if (this.root.visible) this.root.visible = false;
  }
}
