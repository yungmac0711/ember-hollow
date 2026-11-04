// Campfires: stone ring + logs + flickering flame cones + particle flames/embers + a ground
// glow decal that visualises the light radius. Each fire is a priority-3 light *emitter* in the
// LightBudget (render/lights.js), so the real PointLight count never grows (no shader recompiles)
// and the nearest lit fire always wins a slot. §8: #FF9A3C, intensity 12, distance 10, decay 2.
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { lambert } from '../assets.js';
import { Emitter } from '../render/lights.js';

const FC = CONFIG.fire;

function radialTexture(stops) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  for (const [o, col] of stops) grd.addColorStop(o, col);
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let SPRITE, GLOW;
function textures() {
  if (!SPRITE) {
    SPRITE = radialTexture([[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,0.6)'], [1, 'rgba(255,255,255,0)']]);
    GLOW = radialTexture([[0, 'rgba(255,170,80,0.55)'], [0.4, 'rgba(255,120,40,0.22)'], [1, 'rgba(255,90,20,0)']]);
  }
  return { SPRITE, GLOW };
}

class Particles {
  constructor(count, size, spawn) {
    this.count = count; this.spawn = spawn;
    this.pos = new Float32Array(count * 3);
    this.col = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.age = new Float32Array(count);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(g, new THREE.PointsMaterial({
      size, map: textures().SPRITE, vertexColors: true, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false }));
    this.points.frustumCulled = false;
    for (let i = 0; i < count; i++) { this.life[i] = 1; this.age[i] = Math.random(); }
  }
  update(dt, origin, rate, colorFn, drift) {
    const p = this.pos, v = this.vel, c = this.col;
    for (let i = 0; i < this.count; i++) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        if (Math.random() > rate) { p[i * 3 + 1] = -999; this.age[i] = this.life[i] - 0.05 - Math.random() * 0.2; continue; }
        this.spawn(i, origin, p, v, this.life);
        this.age[i] = 0;
      }
      const k = this.age[i] / this.life[i];
      v[i * 3] += (Math.random() - 0.5) * drift * dt;
      v[i * 3 + 2] += (Math.random() - 0.5) * drift * dt;
      p[i * 3] += v[i * 3] * dt; p[i * 3 + 1] += v[i * 3 + 1] * dt; p[i * 3 + 2] += v[i * 3 + 2] * dt;
      colorFn(k, c, i * 3);
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}

export class Campfire {
  constructor(pos, cave, pitParts) {
    this.pos = pos.clone();
    this.fuel = 0; // seconds
    this.group = new THREE.Group();
    this.group.position.copy(pos);
    if (pitParts) {
      // Kenney campfire-pit.glb (stones + logs), normalised to ~1.1 m across
      for (const pt of pitParts) this.group.add(new THREE.Mesh(pt.geometry, pt.material));
      this.logMat = pitParts[0].material;
    } else this._primitivePit();
    this._buildFlames(cave, pos);
  }

  _primitivePit() {
    const stoneGeo = new THREE.DodecahedronGeometry(0.13, 0), stoneMat = lambert(0x6f7585);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2, s = new THREE.Mesh(stoneGeo, stoneMat);
      s.position.set(Math.cos(a) * 0.48, 0.05, Math.sin(a) * 0.48);
      s.rotation.set(i, i * 2, 0); s.scale.setScalar(0.9 + (i % 3) * 0.15);
      this.group.add(s);
    }
    const logGeo = new THREE.CylinderGeometry(0.05, 0.06, 0.75, 5), logMat = lambert(0x5a3a22, { emissive: 0x2a0d00 });
    this.logMat = logMat;
    for (let i = 0; i < 4; i++) {
      const l = new THREE.Mesh(logGeo, logMat);
      const a = (i / 4) * Math.PI * 2;
      l.position.set(Math.cos(a) * 0.12, 0.2, Math.sin(a) * 0.12);
      l.rotation.set(0, -a, 0); l.rotateZ(0.95);
      this.group.add(l);
    }
  }

  _buildFlames(cave, pos) {
    // flame cones
    this.flames = [];
    const fMat = [0xff7a1a, 0xffb347, 0xffe08a].map((c) => new THREE.MeshBasicMaterial({
      color: c, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
    [[0.22, 0.75, 0], [0.15, 0.6, 1], [0.08, 0.45, 2]].forEach(([r, h, m]) => {
      const g = new THREE.ConeGeometry(r, h, 6); g.translate(0, h / 2, 0);
      const f = new THREE.Mesh(g, fMat[m]); f.position.y = 0.08; this.flames.push(f); this.group.add(f);
    });
    // ground glow = visible light radius
    // Conformed to the uneven cave floor so it never clips or floats.
    const R = FC.lightRadius * 0.95;
    const gg = new THREE.PlaneGeometry(R * 2, R * 2, 18, 18); gg.rotateX(-Math.PI / 2);
    const gp = gg.attributes.position;
    for (let i = 0; i < gp.count; i++) {
      gp.setY(i, cave.floorAt(pos.x + gp.getX(i), pos.z + gp.getZ(i)) - pos.y + 0.05);
    }
    this.glow = new THREE.Mesh(gg, new THREE.MeshBasicMaterial({
      map: textures().GLOW, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.glow.renderOrder = 2;
    this.group.add(this.glow);

    const origin = new THREE.Vector3(0, 0.15, 0);
    this.flameP = new Particles(40, 0.32, (i, o, p, v, life) => {
      const a = Math.random() * 6.28, r = Math.random() * 0.2;
      p[i * 3] = o.x + Math.cos(a) * r; p[i * 3 + 1] = o.y; p[i * 3 + 2] = o.z + Math.sin(a) * r;
      v[i * 3] = -Math.cos(a) * r * 0.6; v[i * 3 + 1] = 0.7 + Math.random() * 0.7; v[i * 3 + 2] = -Math.sin(a) * r * 0.6;
      life[i] = 0.45 + Math.random() * 0.45;
    });
    this.emberP = new Particles(FC.maxSparks, 0.07, (i, o, p, v, life) => {
      p[i * 3] = o.x + (Math.random() - 0.5) * 0.3; p[i * 3 + 1] = o.y + 0.2; p[i * 3 + 2] = o.z + (Math.random() - 0.5) * 0.3;
      v[i * 3] = (Math.random() - 0.5) * 0.4; v[i * 3 + 1] = 0.6 + Math.random() * 0.9; v[i * 3 + 2] = (Math.random() - 0.5) * 0.4;
      life[i] = 1.6 + Math.random() * 2.2;
    });
    this._origin = origin;
    this.group.add(this.flameP.points, this.emberP.points);
    this._t = Math.random() * 10;
  }

  get lit() { return this.fuel > 0; }
  get fuelFrac() { return Math.min(1, this.fuel / (FC.secondsPerStick * FC.maxSticks)); }
  /** 0..1 strength used for light/flame size: grows with fuel but never tiny while lit. */
  get strength() { return this.lit ? 0.55 + 0.45 * Math.min(1, this.fuel / (FC.secondsPerStick * 4)) : 0; }
  get lightRadius() { return FC.lightRadius * (0.6 + 0.4 * this.strength); }

  addWood(n) {
    this.fuel = Math.min(FC.secondsPerStick * FC.maxSticks, this.fuel + n * FC.secondsPerStick);
  }

  canAddFuel() { return this.fuel < FC.secondsPerStick * (FC.maxSticks - 0.5); }

  update(dt) {
    this._t += dt;
    if (this.fuel > 0) this.fuel = Math.max(0, this.fuel - dt);
    const st = this.strength;
    const flick = 0.85 + Math.sin(this._t * 13) * 0.06 + Math.sin(this._t * 7.3) * 0.06 + Math.random() * 0.05;
    this.flames.forEach((f, i) => {
      f.visible = st > 0;
      const k = st * flick * (1 + Math.sin(this._t * (9 + i * 3)) * 0.12);
      f.scale.set(k, k * (1 + Math.sin(this._t * 11 + i) * 0.15), k);
      f.rotation.y += dt * (1 + i);
    });
    if (this.logMat.emissive) this.logMat.emissive.setHex(st > 0 ? 0x3a1200 : 0x180600);
    this.glow.material.opacity = this.lit ? (0.45 + 0.55 * st) * flick : 0.12;
    // Ember Gold #FFD27A -> Ember Orange #FF7A1A -> Coal #B23A12
    const white = (k, c, j) => { c[j] = 1 - k * 0.3; c[j + 1] = 0.82 - k * 0.6; c[j + 2] = 0.48 - k * 0.4; const f = (1 - k) * 0.9; c[j] *= f; c[j + 1] *= f; c[j + 2] *= f; };
    const ember = (k, c, j) => { const f = (1 - k) * (0.6 + Math.random() * 0.4); c[j] = 1 * f; c[j + 1] = 0.45 * f; c[j + 2] = 0.1 * f; };
    this.flameP.update(dt, this._origin, st > 0 ? 1 : 0, white, 0.5);
    this.emberP.update(dt, this._origin, st > 0 ? 0.9 : 0.04, ember, 1.6);
    this.flicker = flick;
  }
}

export class FireSystem {
  constructor(scene, cave, pitParts = null, budget = null) {
    this.scene = scene;
    this.cave = cave;
    this.pitParts = pitParts;
    this.budget = budget;
    this.fires = [];
  }

  get anyLit() { return this.fires.some((f) => f.lit); }

  build(pos, wood) {
    const f = new Campfire(pos, this.cave, this.pitParts);
    f.addWood(wood);
    this.fires.push(f);
    this.scene.add(f.group);
    f.emitter = new Emitter({ color: FC.color, intensity: 0, distance: FC.lightRadius, decay: 2, priority: 3 });
    this.budget?.add(f.emitter);
    return f;
  }

  remove(f) {
    this.fires = this.fires.filter((x) => x !== f);
    this.scene.remove(f.group);
    if (f.emitter) this.budget?.remove(f.emitter);
  }

  nearest(pos, maxDist = Infinity, litOnly = false) {
    let best = null, bd = maxDist;
    for (const f of this.fires) {
      if (litOnly && !f.lit) continue;
      const d = Math.hypot(f.pos.x - pos.x, f.pos.z - pos.z);
      if (d < bd) { bd = d; best = f; }
    }
    return best;
  }

  update(dt) {
    for (const f of this.fires) {
      f.update(dt);
      const e = f.emitter;
      if (!f.lit) { e.intensity = 0; continue; }
      // ±10–15% flicker + 0.05 m jitter (style guide §3); the fire stays the scene's key light
      e.pos.set(f.pos.x + (Math.random() - 0.5) * 0.05, f.pos.y + 0.9, f.pos.z + (Math.random() - 0.5) * 0.05);
      e.intensity = FC.intensity * f.strength * (0.88 + (f.flicker - 0.85) * 1.6);
    }
  }
}
