// Biscuit — boxer puppy built from chunky faceted primitives (Style A). Behaviour per story/PUPPY.md:
// follows at 2–4 m, bounds to catch up > 8 m, teleports behind Cam > 25 m, sniffs around when Cam
// idles and lies down after 20 s, sits facing a lit fire when Cam is inside its light, whines and
// stays close when the fire goes out, tail-wag + hop + hearts when petted.
import * as THREE from 'three';
import { lambert } from '../assets.js';

const FAWN = 0xc98a4b, MASK = 0x1c1a19, WHITE = 0xefe6d8, EAR = 0x8a5a2e, COLLAR = 0xc2571e;

function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); return m;
}

export function buildPuppyPrimitive() {
  const fawn = lambert(FAWN), mask = lambert(MASK), white = lambert(WHITE), ear = lambert(EAR);
  const collarM = lambert(COLLAR), tagM = new THREE.MeshBasicMaterial({ color: 0xffb347 });
  const root = new THREE.Group();
  const body = new THREE.Group(); body.position.y = 0.36; root.add(body);       // pivot near hips
  const torso = box(0.26, 0.24, 0.5, fawn, 0, 0, 0.05); body.add(torso);
  body.add(box(0.2, 0.17, 0.08, white, 0, -0.02, 0.29));                         // white chest blaze
  const head = new THREE.Group(); head.position.set(0, 0.16, 0.33); body.add(head);
  head.add(box(0.24, 0.22, 0.22, fawn, 0, 0.04, 0));
  head.add(box(0.03, 0.1, 0.012, white, 0, 0.1, 0.111));                          // forehead stripe
  head.add(box(0.16, 0.12, 0.12, mask, 0, -0.02, 0.15));                          // black mask/muzzle
  head.add(box(0.06, 0.04, 0.03, lambert(0x0a0a0a), 0, 0.03, 0.215));             // nose
  const eyeM = new THREE.MeshBasicMaterial({ color: 0x111111 });
  head.add(box(0.035, 0.035, 0.02, eyeM, -0.065, 0.08, 0.112), box(0.035, 0.035, 0.02, eyeM, 0.065, 0.08, 0.112));
  const earL = new THREE.Group(), earR = new THREE.Group();
  earL.position.set(-0.12, 0.13, -0.02); earR.position.set(0.12, 0.13, -0.02);
  earL.add(box(0.04, 0.13, 0.09, ear, -0.015, -0.06, 0)); earR.add(box(0.04, 0.13, 0.09, ear, 0.015, -0.06, 0));
  earL.rotation.z = 0.35; earR.rotation.z = -0.35; head.add(earL, earR);
  const collar = box(0.27, 0.05, 0.1, collarM, 0, 0.09, 0.27); body.add(collar);
  body.add(box(0.04, 0.04, 0.02, tagM, 0, 0.04, 0.33));                         // glowing amber tag
  const legs = [];
  for (const [x, z, front] of [[-0.09, 0.22, 1], [0.09, 0.22, 1], [-0.09, -0.14, 0], [0.09, -0.14, 0]]) {
    const pivot = new THREE.Group(); pivot.position.set(x, -0.08, z);
    pivot.add(box(0.075, 0.3, 0.08, fawn, 0, -0.14, 0));
    pivot.add(box(0.085, 0.07, 0.1, front ? white : fawn, 0, -0.27, 0.015));    // white front socks, big paws
    body.add(pivot); legs.push(pivot);
  }
  const tail = new THREE.Group(); tail.position.set(0, 0.08, -0.2); body.add(tail);
  tail.add(box(0.035, 0.035, 0.2, fawn, 0, 0, -0.09)); tail.rotation.x = 0.7;
  // blob shadow (style guide: fake disc shadows, no shadow maps)
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.3, 12),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.02; root.add(shadow);
  return { root, parts: { body, head, earL, earR, legs, tail, torso } };
}

const tmp = new THREE.Vector3();

export class Puppy {
  constructor(scene, cave, model, startPos) {
    this.cave = cave;
    this.root = model.root;
    this.p = model.parts;
    this.pos = startPos.clone();
    this.heading = 0;
    this.state = 'follow';
    this.stateTime = 0;
    this.target = new THREE.Vector3();
    this.sit = 0; this.lie = 0; this.sniff = 0;
    this.walkPhase = 0; this.wagSpeed = 8; this.hop = 0; this.petTime = 0;
    this.speed = 0;
    this.status = 'near';   // for CONTEXT puppy field
    this.events = [];       // consumed by main for Wren's 'biscuit' trigger
    this._s = {};
    this.root.position.copy(this.pos);
    scene.add(this.root);
    this.root.traverse((o) => (o.userData.pickable = 'puppy'));
    this._hearts = this._makeHearts(scene);
  }

  _makeHearts(scene) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'); g.font = '48px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('❤', 32, 36);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const sprites = [];
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0xff7a8a, transparent: true, depthWrite: false }));
      s.scale.setScalar(0.18); s.visible = false; scene.add(s); sprites.push({ s, t: 9 });
    }
    return sprites;
  }

  pet() {
    this.petTime = 2.2; this.hop = 1;
    this.state = 'petted'; this.stateTime = 0;
    this._hearts.forEach((h, i) => { h.t = -i * 0.25; });
    this.events.push('petted');
  }

  _setState(s) { if (this.state !== s) { this.state = s; this.stateTime = 0; } }

  update(dt, player, fires) {
    this.stateTime += dt;
    const pp = player.pos;
    const dPlayer = Math.hypot(pp.x - this.pos.x, pp.z - this.pos.z);
    const fire = fires.nearest(pp, Infinity, true);
    const playerInFire = fire && Math.hypot(pp.x - fire.pos.x, pp.z - fire.pos.z) < fire.lightRadius;
    if (this._hadFire && !fires.nearest(pp, 30, true)) { this._setState('whine'); }
    this._hadFire = !!fires.nearest(pp, 30, true);

    // Teleport if hopelessly far (or stuck in geometry)
    if (dPlayer > 25) {
      const back = player.forward.multiplyScalar(-1.5).add(pp);
      this.cave.resolve(back, 0.5);
      this.pos.set(back.x, this.cave.floorAt(back.x, back.z), back.z);
      this._setState('follow');
    }

    let moveSpeed = 0;
    let face = null;
    if (this.state === 'petted') {
      if (this.stateTime > 2.2) this._setState('idle');
      face = pp;
    } else if (playerInFire && this.state !== 'whine') {
      // go sit by the fire, on the side facing Cam, facing the flames
      const ang = Math.atan2(pp.z - fire.pos.z, pp.x - fire.pos.x) + 0.9;
      this.target.set(fire.pos.x + Math.cos(ang) * 1.3, 0, fire.pos.z + Math.sin(ang) * 1.3);
      this.cave.resolve(this.target, 0.5);
      const d = Math.hypot(this.target.x - this.pos.x, this.target.z - this.pos.z);
      if (d > 0.25) { this._setState('toFire'); moveSpeed = Math.min(3.2, 1 + d); face = this.target; }
      else { this._setState('fireSit'); face = fire.pos; }
    } else if (this.state === 'whine') {
      // fire went out: stay close (1–2 m)
      if (dPlayer > 1.6) { moveSpeed = Math.min(4, dPlayer * 1.5); face = pp; } else face = pp;
      if (this.stateTime > 6) this._setState('follow');
    } else if (dPlayer > 4 || (this.state === 'follow' && dPlayer > 2.2)) {
      this._setState('follow');
      moveSpeed = dPlayer > 8 ? 6.5 : Math.min(4.5, 1.2 + (dPlayer - 2) * 1.4);  // bound when far
      face = pp;
    } else {
      if (this.state === 'follow' || this.state === 'toFire' || this.state === 'fireSit') this._setState('idle');
      // idle: sniff around, wander in small circles, lie down after 20 s of Cam idling
      if (this.state === 'idle' && this.stateTime > 2 + Math.random() * 3) {
        tmp.set(pp.x + (Math.random() - 0.5) * 4, 0, pp.z + (Math.random() - 0.5) * 4);
        this.cave.resolve(tmp, 0.6);
        this.target.copy(tmp); this._setState('wander');
      }
      if (this.state === 'wander') {
        const d = Math.hypot(this.target.x - this.pos.x, this.target.z - this.pos.z);
        if (d > 0.3 && this.stateTime < 4) { moveSpeed = 1.3; face = this.target; }
        else this._setState(player.stillTime > 20 ? 'lie' : 'sniffing');
      }
      if (this.state === 'sniffing' && this.stateTime > 3) this._setState(player.stillTime > 20 ? 'lie' : 'idle');
      if (this.state === 'lie' && player.stillTime < 0.5) this._setState('idle');
    }

    // Steering + movement
    if (face) {
      const want = Math.atan2(face.x - this.pos.x, face.z - this.pos.z);
      let dh = want - this.heading; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      this.heading += dh * Math.min(1, dt * 8);
    }
    this.speed += (moveSpeed - this.speed) * Math.min(1, dt * 6);
    if (this.speed > 0.02) {
      this.pos.x += Math.sin(this.heading) * this.speed * dt;
      this.pos.z += Math.cos(this.heading) * this.speed * dt;
      this.cave.resolve(this.pos, 0.55);
    }
    this.pos.y = this.cave.floorAt(this.pos.x, this.pos.z);

    // Pose blending
    const sitting = this.state === 'fireSit' || this.state === 'petted' || (this.state === 'idle' && player.stillTime > 3);
    const lying = this.state === 'lie';
    this.sit += ((sitting ? 1 : 0) - this.sit) * Math.min(1, dt * 5);
    this.lie += ((lying ? 1 : 0) - this.lie) * Math.min(1, dt * 3);
    this.sniff += ((this.state === 'sniffing' || this.state === 'wander' ? 1 : 0) - this.sniff) * Math.min(1, dt * 4);
    this.petTime = Math.max(0, this.petTime - dt);
    this.hop = Math.max(0, this.hop - dt * 2.5);

    const { body, head, earL, earR, legs, tail } = this.p;
    this.walkPhase += dt * (4 + this.speed * 3.2) * (this.speed > 0.1 ? 1 : 0);
    const swing = Math.min(1, this.speed / 2) * 0.7;
    legs.forEach((l, i) => {
      const ph = this.walkPhase + (i === 0 || i === 3 ? 0 : Math.PI);
      l.rotation.x = Math.sin(ph) * swing;
      if (i >= 2) l.rotation.x += this.sit * 1.3 + this.lie * 1.4;   // rear legs tuck when sitting
      else l.rotation.x -= this.lie * 1.3;                           // front legs forward when lying
    });
    body.rotation.x = -this.sit * 0.55;
    body.position.y = 0.36 - this.sit * 0.1 - this.lie * 0.22 + Math.abs(Math.sin(this.walkPhase)) * 0.03 * swing
      + Math.sin(this.hop * Math.PI) * 0.12;
    head.rotation.x = this.sit * 0.45 + this.sniff * 0.5 + Math.sin(this.stateTime * 3) * 0.04 * this.sniff;
    head.rotation.z = this.state === 'idle' ? Math.sin(this.stateTime * 0.8) * 0.15 : 0; // curious head tilt
    const flop = Math.sin(this.walkPhase * 2) * 0.25 * swing;
    earL.rotation.z = 0.35 + flop; earR.rotation.z = -0.35 - flop;
    const wag = this.petTime > 0 ? 22 : this.state === 'whine' ? 3 : this.state === 'fireSit' ? 6 : 10;
    this._wagT = (this._wagT || 0) + dt * wag;
    tail.rotation.y = Math.sin(this._wagT) * (this.state === 'whine' ? 0.2 : 0.6);
    tail.rotation.x = this.state === 'whine' ? -0.2 : 0.7;

    this.root.position.copy(this.pos);
    this.root.rotation.y = this.heading;

    // hearts
    for (const h of this._hearts) {
      h.t += dt;
      h.s.visible = h.t > 0 && h.t < 1.4;
      if (h.s.visible) {
        h.s.position.set(this.pos.x + Math.sin(h.t * 5) * 0.1, this.pos.y + 0.75 + h.t * 0.5, this.pos.z);
        h.s.material.opacity = 1 - h.t / 1.4;
      }
    }

    this.status = this.state === 'fireSit' ? 'sitting by the fire' : this.state === 'lie' ? 'lying down, dozing'
      : this.state === 'sniffing' || this.state === 'wander' ? 'sniffing around' : this.state === 'whine' ? 'whining softly, pressed close'
      : this.state === 'petted' ? 'wagging, just got ear scratches' : dPlayer > 6 ? 'trotting to catch up' : 'near';
    if (this.state === 'fireSit' && this.stateTime > 8 && !this._saidFire) { this._saidFire = true; this.events.push('fireSit'); }
    if (this.state !== 'fireSit') this._saidFire = false;
  }
}
