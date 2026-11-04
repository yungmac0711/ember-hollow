// Wren Ashby — companion body. Uses Kenney character-female GLB (skinned, idle/walk/sit clips) when
// available, otherwise a primitive placeholder. Carries her grandmother's waylamp: a real-time
// PointLight (style guide: #E08A2E, 2, 5, 2) that fades out inside a campfire's light radius.
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { lambert } from '../assets.js';

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
  constructor(scene, cave, model, startPos) {
    this.cave = cave;
    this.root = new THREE.Group();
    this.model = model.root;
    this.root.add(this.model);
    this.pos = startPos.clone();
    this.heading = Math.PI;
    this.speed = 0;
    this.state = 'follow';
    this.mixer = null;
    this.actions = {};
    this.current = null;
    if (model.animations?.length) {
      this.mixer = new THREE.AnimationMixer(this.model);
      for (const clip of model.animations) this.actions[clip.name] = this.mixer.clipAction(clip);
      this._play('idle');
      // Art note: Kenney Mini Characters read young; shrink the head ~15% so she reads adult.
      const headBone = this.model.getObjectByName('head');
      if (headBone) headBone.scale.setScalar(0.85);
    }
    // waylamp at hip height (+ the real light)
    this.lamp = buildWaylamp();
    this.lamp.position.set(0.3, 0.7, 0.12);
    this.root.add(this.lamp);
    const L = CONFIG.companion.lantern;
    this.light = new THREE.PointLight(L.color, L.intensity, L.distance, 2);
    this.light.position.set(0.3, 0.85, 0.15);
    this.root.add(this.light);
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
  }

  _play(name, fade = 0.25) {
    const a = this.actions[name];
    if (!a || this.current === a) return;
    a.reset().fadeIn(fade).play();
    if (this.current) this.current.fadeOut(fade);
    this.current = a;
  }

  update(dt, player, fires, talking) {
    const pp = player.pos;
    const fire = fires.nearest(pp, Infinity, true);
    const inFire = fire && Math.hypot(pp.x - fire.pos.x, pp.z - fire.pos.z) < fire.lightRadius;
    let moveSpeed = 0, face = pp;
    if (inFire && !talking) {
      // settle on the far side of the fire from Biscuit and warm her hands
      const ang = Math.atan2(pp.z - fire.pos.z, pp.x - fire.pos.x) - 1.0;
      this.target.set(fire.pos.x + Math.cos(ang) * 1.5, 0, fire.pos.z + Math.sin(ang) * 1.5);
      this.cave.resolve(this.target, 0.6);
      const d = Math.hypot(this.target.x - this.pos.x, this.target.z - this.pos.z);
      if (d > 0.3) { moveSpeed = Math.min(3, 0.8 + d); face = this.target; this.state = 'toFire'; }
      else { face = fire.pos; this.state = 'fire'; }
    } else {
      // walk alongside Cam, slightly behind and to the right
      const right = new THREE.Vector3(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
      this.target.copy(pp).addScaledVector(right, 1.6).addScaledVector(player.forward, -1.2);
      this.cave.resolve(this.target, 0.6);
      const d = Math.hypot(this.target.x - this.pos.x, this.target.z - this.pos.z);
      const dp = Math.hypot(pp.x - this.pos.x, pp.z - this.pos.z);
      if (dp > 25) { this.pos.copy(this.target); }
      if (d > 0.8 && !talking) { moveSpeed = Math.min(5, 1 + d * 1.3); face = d > 1.5 ? this.target : pp; this.state = 'follow'; }
      else this.state = 'idle';
    }
    const want = Math.atan2(face.x - this.pos.x, face.z - this.pos.z);
    let dh = want - this.heading; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    this.heading += dh * Math.min(1, dt * 6);
    this.speed += (moveSpeed - this.speed) * Math.min(1, dt * 5);
    if (this.speed > 0.02) {
      this.pos.x += Math.sin(this.heading) * this.speed * dt;
      this.pos.z += Math.cos(this.heading) * this.speed * dt;
      this.cave.resolve(this.pos, 0.6);
    }
    this.pos.y = this.cave.floorAt(this.pos.x, this.pos.z);
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.heading;

    if (this.mixer) {
      if (this.speed > 2.6) this._play(this.actions.sprint ? 'sprint' : 'walk');
      else if (this.speed > 0.35) this._play('walk');
      else if (this.state === 'fire') this._play(this.actions.crouch ? 'crouch' : 'idle', 0.5);
      else this._play('idle');
      if (this.current && this.current === this.actions.walk) this.current.timeScale = Math.max(0.6, this.speed / 1.6);
      this.mixer.update(dt);
    } else {
      this.model.position.y = Math.abs(Math.sin(performance.now() / 180)) * 0.03 * Math.min(1, this.speed);
    }

    // Waylamp off inside the campfire's light (light budget) — fade, don't pop.
    const want2 = inFire ? 0 : 1;
    this.lightOn += (want2 - this.lightOn) * Math.min(1, dt * 2);
    this.light.intensity = CONFIG.companion.lantern.intensity * this.lightOn * (0.95 + Math.sin(performance.now() / 90) * 0.05);
    this.light.visible = true; // keep it in the scene so the light count never changes

    this.status = this.state === 'fire' ? 'warming her hands by the fire' : this.state === 'toFire' ? 'heading to the fire' : 'beside Cam';
  }
}
