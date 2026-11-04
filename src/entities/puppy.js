// Biscuit — boxer puppy built from chunky faceted primitives (Style A). Behaviour per story/PUPPY.md:
// follows at 2–4 m, bounds to catch up > 8 m, teleports behind Cam > 25 m, sniffs around when Cam
// idles and lies down after 20 s, sits facing a lit fire when Cam is inside its light, whines and
// stays close when the fire goes out, tail-wag + hop + hearts when petted.
// M0 art pass: when the custom Style-A biscuit.glb is loaded, BiscuitRig drives its node pivots
// (pose blending + procedural walk/tail/ears/jaw); the primitive below is only the fallback.
// Extra poses: curled up by a long-lit fire while Cam is idle; play bow when Cam returns or pets him.
// Chunk B (Biscuit v2): tap to pet (hearts + play bow), barks at points of interest with a "woof!"
// bubble (onBark hook; audio hook left in main), a gallop/run cycle and occasional zoomies, fetch
// (Cam throws a stick from the hotbar; not the wood item) and digging (onDig → biscuit_finds.json).
// He steers around placed pieces (colliders) and sleeps on his bed (biscuit_bed sleep_point).
import * as THREE from 'three';
import { lambert } from '../assets.js';
import { BiscuitRig } from './biscuit-rig.js';
import { liftCharacter, skinCharacter } from '../render/character-materials.js';
import { steer } from '../world/colliders.js';

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

const tmp = new THREE.Vector3(), _w = new THREE.Vector3();
const GRAV = 9.8;

/** Biscuit's fetch stick: in Cam's hand (hidden) → flying → on the ground → carried → back in hand. */
export class Stick {
  constructor(scene, cave) {
    this.cave = cave;
    const g = new THREE.CylinderGeometry(0.022, 0.028, 0.5, 5); g.rotateZ(Math.PI / 2);
    this.mesh = new THREE.Mesh(g, lambert(0x8a6440));
    this.mesh.visible = false; scene.add(this.mesh);
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3();
    this.state = 'hand'; this.t = 0;
  }
  throw(from, dir, power = 7.5) {
    if (this.state !== 'hand') return false;
    this.pos.copy(from); this.vel.copy(dir).setY(0).normalize().multiplyScalar(power); this.vel.y = 3.6;
    this.state = 'flying'; this.t = 0; this.mesh.visible = true;
    return true;
  }
  update(dt, colliders) {
    this.t += dt;
    if (this.state === 'flying') {
      this.vel.y -= GRAV * dt;
      this.pos.addScaledVector(this.vel, dt);
      const before = this.pos.x + this.pos.z;
      this.cave.resolve(this.pos, 0.9);
      colliders?.resolve(this.pos, 0.05);
      if (Math.abs(this.pos.x + this.pos.z - before) > 1e-3) { this.vel.x *= -0.3; this.vel.z *= -0.3; }
      const fy = this.cave.floorAt(this.pos.x, this.pos.z);
      if (this.pos.y <= fy + 0.03) { this.pos.y = fy + 0.03; this.state = 'ground'; this.t = 0; }
      this.mesh.position.copy(this.pos); this.mesh.rotation.set(0, this.t * 9, this.t * 7);
    } else if (this.state === 'ground') {
      this.mesh.position.copy(this.pos); this.mesh.rotation.set(0, this.mesh.rotation.y, 0);
    }
  }
  /** Back to Cam's hand. */
  stow() { this.state = 'hand'; this.mesh.visible = false; }
}

export class Puppy {
  constructor(scene, cave, model, startPos) {
    this.cave = cave;
    this.root = model.root;
    this.p = model.parts;
    this.rig = null;
    if (model.fromFile) {
      const rig = new BiscuitRig(model.root);
      if (rig.ok) {
        this.rig = rig;
        const holder = new THREE.Group(); holder.add(model.root); this.root = holder; // root = heading pivot
        const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.32, 12),
          new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }));
        shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.02; holder.add(shadow);
      } else console.warn('[puppy] biscuit.glb is missing expected nodes; using primitive animation');
    }
    liftCharacter(this.root); // STYLE_GUIDE §8 backlight fix (skips the glowing tag + shadow)
    if (this.rig) skinCharacter(model.root); // one skinned draw for the whole pup (rig still drives the nodes)
    this._away = false; this._pantT = 0;
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
    // Chunk B
    this.colliders = null; this._steer = {}; this._stuckT = 0;
    this.stick = new Stick(scene, cave);
    this.onBark = null;  // (reason) => void — woof bubble + audio hook (main.js)
    this.onDig = null;   // () => void — roll a biscuit_finds.json find (main.js)
    this.bed = null;     // Vector3 sleep point of a placed biscuit_bed, set by main
    this.snuggle = false; // Chunk C: Cam is cold → he presses close (main sets this from the warmth meter)
    this._nightSpot = null;
    this.digT = 50 + Math.random() * 40; this.zoomT = 110 + Math.random() * 90; this.barkT = 0;
    this.fetches = 0; this.digs = 0; this.barks = 0;
    this._zoomA = 0;
    const dg = new THREE.CircleGeometry(0.28, 9); dg.rotateX(-Math.PI / 2);
    this.dirt = new THREE.Mesh(dg, lambert(0x3a2a1c)); this.dirt.visible = false; scene.add(this.dirt);
    this._dirtT = 0;
  }

  /** Woof at something interesting (pickups, notes, new areas). Returns true if he barked. */
  bark(reason, at = null) {
    if (this.barkT > 0 || ['fetching', 'digging', 'sleeping', 'curled', 'nightSleep'].includes(this.state)) return false;
    this.barkT = 6; this.barks++;
    this._barkAt = at ? at.clone() : null; this._barkHold = 0.9;
    this.onBark?.(reason);
    return true;
  }
  startDig() {
    if (['fetching', 'digging', 'zoomies', 'sleeping'].includes(this.state)) return false;
    this._setState('digging'); this.digT = 70 + Math.random() * 70;
    return true;
  }
  startZoomies(player) {
    this._setState('zoomies'); this.zoomT = 140 + Math.random() * 120;
    this._zoomA = Math.atan2(this.pos.z - player.pos.z, this.pos.x - player.pos.x);
    this.events.push('zoomies');
  }
  /** Chunk C: curl up for the night on his bed (if there is one nearby) or right next to Cam. */
  curlUp(player) {
    const pp = player.pos;
    const onBed = this.bed && Math.hypot(this.bed.x - pp.x, this.bed.z - pp.z) < 12;
    const spot = onBed ? this.bed.clone() : new THREE.Vector3(pp.x - Math.cos(player.yaw) * 0.7, 0, pp.z + Math.sin(player.yaw) * 0.7);
    if (!onBed) { this.cave.resolve(spot, 0.5); this.colliders?.resolve(spot, 0.3); }
    this._nightSpot = spot; this._onBed = !!onBed;
    this.pos.set(spot.x, this.pos.y, spot.z);
    this.stick.stow?.();
    this._setState('nightSleep');
    return onBed ? 'bed' : 'cam';
  }

  /** Bed-aware high-level status for Wren's `biscuit` state key (DATA_FORMATS: idle/zoomies/fetching/digging/sleeping). */
  get mood() {
    return this.state === 'zoomies' ? 'zoomies' : this.state === 'fetching' ? 'fetching' : this.state === 'digging' ? 'digging'
      : this.state === 'sleeping' || this.state === 'curled' || this.state === 'lie' || this.state === 'nightSleep' ? 'sleeping' : 'idle';
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
    this.petTime = 2.2; this.hop = this.rig ? 0 : 1;
    this.state = 'petted'; this.stateTime = 0;
    this._hearts.forEach((h, i) => { h.t = -i * 0.25; });
    this.events.push('petted');
  }

  _setState(s) { if (this.state !== s) { this.state = s; this.stateTime = 0; } }
  _hopTo(player) {
    const back = player.forward.clone().multiplyScalar(-1.2).add(player.pos);
    this.cave.resolve(back, 0.5); this.colliders?.resolve(back, 0.3);
    this.pos.set(back.x, this.cave.floorAt(back.x, back.z), back.z);
  }

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
      this.cave.resolve(back, 0.5); this.colliders?.resolve(back, 0.3);
      this.pos.set(back.x, this.cave.floorAt(back.x, back.z), back.z);
      this._setState('follow');
    }

    // Cam came back after wandering off → play bow
    if (dPlayer > 9) this._away = true;
    if (this._away && dPlayer < 3 && !['petted', 'fetching', 'digging', 'zoomies'].includes(this.state)) { this._away = false; this._setState('playbow'); this.events.push('playbow'); }

    let moveSpeed = 0;
    let face = null;
    this.barkT = Math.max(0, this.barkT - dt);
    const st = this.stick;
    st.update(dt, this.colliders);
    if (['flying', 'ground', 'carried'].includes(st.state) && !['fetching', 'petted', 'playbow'].includes(this.state)) this._setState('fetching');
    // timers for zoomies + digging (only when he's calm and near Cam)
    const calm = ['idle', 'sniffing', 'wander', 'follow'].includes(this.state) && dPlayer < 6;
    if (calm) { this.zoomT -= dt; this.digT -= dt; }
    if (calm && this.zoomT <= 0 && player.stillTime > 1.5) this.startZoomies(player);
    else if (calm && this.digT <= 0 && this.state !== 'follow') this.startDig();
    // sleep on his bed when Cam settles down nearby
    if (this.bed && player.stillTime > 15 && ['idle', 'sniffing', 'wander', 'lie', 'fireSit', 'curled'].includes(this.state)
      && Math.hypot(this.bed.x - pp.x, this.bed.z - pp.z) < 10) this._setState('toBed');

    if (this._barkHold > 0) {
      this._barkHold -= dt;
      face = this._barkAt || pp;
    } else if (this.state === 'fetching') {
      if (st.state === 'flying') { moveSpeed = 5.5; face = st.pos; }
      else if (st.state === 'ground') {
        const d = Math.hypot(st.pos.x - this.pos.x, st.pos.z - this.pos.z);
        moveSpeed = d > 1.2 ? 6.2 : 2.2; face = st.pos;
        if (d < 0.5) { st.state = 'carried'; }
        if (this.stateTime > 25) { st.stow(); this._setState('follow'); }
      } else if (st.state === 'carried') {
        moveSpeed = dPlayer > 2.5 ? 5.8 : 2; face = pp;
        if (dPlayer < 1.4) { st.stow(); this.fetches++; this.events.push('fetch'); this._setState('playbow'); this.petTime = 1.5; }
      } else this._setState('follow');
    } else if (this.state === 'digging') {
      face = null;
      if (this.stateTime < 0.1) { this.dirt.position.set(this.pos.x + Math.sin(this.heading) * 0.3, this.pos.y + 0.015, this.pos.z + Math.cos(this.heading) * 0.3); }
      this.dirt.visible = true; this._dirtT = 8;
      if (this.stateTime > 2.8) { this.digs++; this.onDig?.(); this._setState('playbow'); }
    } else if (this.state === 'zoomies') {
      // fast laps around Cam, then a play bow
      this._zoomA += dt * 2.3;
      const r = 2.6 + Math.sin(this.stateTime * 1.7) * 0.6;
      this.target.set(pp.x + Math.cos(this._zoomA) * r, 0, pp.z + Math.sin(this._zoomA) * r);
      this.cave.resolve(this.target, 0.6);
      moveSpeed = 6.8; face = this.target;
      if (this.stateTime > 5.5) { this._setState('playbow'); }
    } else if (this.state === 'nightSleep') {
      // Chunk C sleep: curled on his bed (or beside Cam) until Cam gets up
      const sp = this._nightSpot;
      if (sp) { this.pos.x += (sp.x - this.pos.x) * Math.min(1, dt * 4); this.pos.z += (sp.z - this.pos.z) * Math.min(1, dt * 4); }
      if (this.stateTime > 4 && player.stillTime < 0.5) { this._nightSpot = null; this._setState('playbow'); }
    } else if (this.state === 'toBed' || this.state === 'sleeping') {
      if (!this.bed || player.stillTime < 0.5) this._setState('idle');
      else {
        const d = Math.hypot(this.bed.x - this.pos.x, this.bed.z - this.pos.z);
        if (this.state === 'toBed') { if (d > 0.15) { moveSpeed = Math.min(2.6, 0.6 + d); face = this.bed; } else this._setState('sleeping'); }
        else { this.pos.x += (this.bed.x - this.pos.x) * Math.min(1, dt * 3); this.pos.z += (this.bed.z - this.pos.z) * Math.min(1, dt * 3); face = pp; }
      }
    } else if (this.state === 'playbow') {
      face = pp;
      if (this.stateTime > 1.4) this._setState('idle');
    } else if (this.state === 'petted') {
      if (this.stateTime > 2.2) this._setState('idle');
      face = pp;
    } else if (this.snuggle && this.state !== 'whine') {
      // cold: lean against Cam's leg (left side), sitting, facing the same way
      const sx = pp.x - Math.cos(player.yaw) * 0.55, sz = pp.z + Math.sin(player.yaw) * 0.55;
      this.target.set(sx, 0, sz); this.cave.resolve(this.target, 0.5);
      const d = Math.hypot(this.target.x - this.pos.x, this.target.z - this.pos.z);
      if (d > 0.2) { this._setState('snuggleTo'); moveSpeed = Math.min(4.2, 1 + d * 1.5); face = this.target; }
      else { this._setState('snuggle'); face = { x: this.pos.x - Math.sin(player.yaw), z: this.pos.z - Math.cos(player.yaw) }; }
    } else if (playerInFire && this.state !== 'whine') {
      // go sit by the fire, on the side facing Cam, facing the flames
      const ang = Math.atan2(pp.z - fire.pos.z, pp.x - fire.pos.x) + 0.9;
      this.target.set(fire.pos.x + Math.cos(ang) * 1.3, 0, fire.pos.z + Math.sin(ang) * 1.3);
      this.cave.resolve(this.target, 0.5);
      const d = Math.hypot(this.target.x - this.pos.x, this.target.z - this.pos.z);
      if (d > 0.25 && this.state !== 'curled') { this._setState('toFire'); moveSpeed = Math.min(3.2, 1 + d); face = this.target; }
      else {
        // after a good while by a lit fire with Cam idle, he curls up; any movement wakes him
        const curl = this.state === 'curled' ? player.stillTime > 0.5
          : this.state === 'fireSit' && this.stateTime > 25 && player.stillTime > 12;
        this._setState(curl ? 'curled' : 'fireSit'); face = fire.pos;
      }
    } else if (this.state === 'whine') {
      // fire went out: stay close (1–2 m)
      if (dPlayer > 1.6) { moveSpeed = Math.min(4, dPlayer * 1.5); face = pp; } else face = pp;
      if (this.stateTime > 6) this._setState('follow');
    } else if (dPlayer > 4 || (this.state === 'follow' && dPlayer > 2.2)) {
      this._setState('follow');
      moveSpeed = dPlayer > 8 ? 6.5 : Math.min(4.5, 1.2 + (dPlayer - 2) * 1.4);  // bound when far
      face = pp;
    } else {
      if (['follow', 'toFire', 'fireSit', 'curled', 'snuggle', 'snuggleTo'].includes(this.state)) this._setState('idle');
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
      let want = Math.atan2(face.x - this.pos.x, face.z - this.pos.z);
      if (moveSpeed > 0.3 && this.state !== 'sleeping') want = steer(this.colliders, this.pos, want, 0.3, this._steer);
      let dh = want - this.heading; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      this.heading += dh * Math.min(1, dt * 8);
    }
    this.speed += (moveSpeed - this.speed) * Math.min(1, dt * 6);
    if (this.speed > 0.02) {
      const ox = this.pos.x, oz = this.pos.z;
      this.pos.x += Math.sin(this.heading) * this.speed * dt;
      this.pos.z += Math.cos(this.heading) * this.speed * dt;
      this.cave.resolve(this.pos, 0.55);
      this.colliders?.resolve(this.pos, 0.3);
      // properly stuck behind walls for a while → hop to Cam (he never walks through pieces)
      const moved = Math.hypot(this.pos.x - ox, this.pos.z - oz);
      this._stuckT = moveSpeed > 1 && moved < this.speed * dt * 0.25 ? this._stuckT + dt : Math.max(0, this._stuckT - dt);
      if (this._stuckT > 2.5 && dPlayer > 2.5) { this._stuckT = 0; this._hopTo(player); }
    }
    this.pos.y = Math.max(this.cave.floorAt(this.pos.x, this.pos.z), this.floorAt ? this.floorAt(this.pos.x, this.pos.z) : -Infinity);
    if ((this._dirtT -= dt) <= 0) this.dirt.visible = false;
    if (st.state === 'carried') {
      const head = this.rig?.n.jaw || this.p?.head;
      if (head) { head.updateWorldMatrix(true, false); _w.set(0, 0, 0.12).applyMatrix4(head.matrixWorld); }
      else _w.set(this.pos.x, this.pos.y + 0.35, this.pos.z);
      st.mesh.position.copy(_w); st.mesh.rotation.set(0, this.heading + Math.PI / 2, 0);
    }

    this.root.position.copy(this.pos);
    this.root.rotation.y = this.heading;
    this._updateHearts(dt);
    this._updateStatus(dPlayer);
    if (this.rig) { this._animateRig(dt, player); return; }

    // Pose blending (primitive fallback)
    const sitting = this.state === 'fireSit' || this.state === 'petted' || this.state === 'snuggle' || (this.state === 'idle' && player.stillTime > 3);
    const lying = this.state === 'lie' || this.state === 'nightSleep';
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

  }

  _animateRig(dt, player) {
    const st = this.state;
    if (this.speed > 3) this._pantT = 4; else this._pantT = Math.max(0, this._pantT - dt);
    this.sniff += ((st === 'sniffing' || st === 'wander' ? 1 : 0) - this.sniff) * Math.min(1, dt * 4);
    this.petTime = Math.max(0, this.petTime - dt);
    const pose = st === 'curled' || st === 'lie' || st === 'sleeping' || st === 'nightSleep' ? 'curled'
      : st === 'playbow' || st === 'digging' || (st === 'petted' && this.stateTime < 0.9) ? 'playbow'
      : st === 'fireSit' || st === 'petted' || st === 'snuggle' || (st === 'idle' && player.stillTime > 3) ? 'sit' : 'stand';
    const tail = st === 'whine' ? 'tucked' : st === 'petted' || st === 'playbow' ? 'high' : 'happy';
    const wag = { petted: 1, playbow: 1, fireSit: 0.45, follow: 0.7, toFire: 0.8, whine: 0.25, curled: 0, lie: 0, sleeping: 0, nightSleep: 0, snuggle: 0.3, zoomies: 1, fetching: 0.9, digging: 0.8 }[st] ?? 0.55;
    this.rig.update(dt, {
      pose, tail, wag, speed: this.speed, dig: st === 'digging' ? 1 : 0,
      pant: this._pantT > 0 ? 1 : st === 'fireSit' ? 0.5 : 0,
      tilt: st === 'idle' ? Math.sin(this.stateTime * 0.8) * 0.18 : 0,
      sniff: this.sniff,
    });
  }

  _updateHearts(dt) {
    for (const h of this._hearts) {
      h.t += dt;
      h.s.visible = h.t > 0 && h.t < 1.4;
      if (h.s.visible) {
        h.s.position.set(this.pos.x + Math.sin(h.t * 5) * 0.1, this.pos.y + 0.75 + h.t * 0.5, this.pos.z);
        h.s.material.opacity = 1 - h.t / 1.4;
      }
    }
  }

  _updateStatus(dPlayer) {
    this.status = this.state === 'curled' ? 'curled up asleep by the fire' : this.state === 'playbow' ? 'play-bowing, tail going'
      : this.state === 'fireSit' ? 'sitting by the fire' : this.state === 'lie' ? 'lying down, dozing'
      : this.state === 'sniffing' || this.state === 'wander' ? 'sniffing around' : this.state === 'whine' ? 'whining softly, pressed close'
      : this.state === 'petted' ? 'wagging, just got ear scratches' : this.state === 'sleeping' ? 'asleep in his bed'
      : this.state === 'nightSleep' ? (this._onBed ? 'curled up asleep in his bed' : 'curled up asleep next to Cam') : this.state === 'snuggle' ? 'pressed close against Cam, keeping warm'
      : this.state === 'zoomies' ? 'doing zoomies in circles' : this.state === 'fetching' ? 'fetching the stick'
      : this.state === 'digging' ? 'digging furiously' : dPlayer > 6 ? 'trotting to catch up' : 'near';
    if (this.state === 'fireSit' && this.stateTime > 8 && !this._saidFire) { this._saidFire = true; this.events.push('fireSit'); }
    if (this.state !== 'fireSit') this._saidFire = false;
  }
}
