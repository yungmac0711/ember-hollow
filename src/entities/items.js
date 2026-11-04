// Gatherables: wood (sticks), stone, flint. One InstancedMesh per kind (Kenney GLBs when
// available, primitives otherwise); picked items are hidden by zero-scaling their instance.
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { mulberry32 } from '../world/noise.js';
import { lambert } from '../assets.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

export const ITEM_INFO = {
  wood:  { label: 'wood',  icon: '🪵' },
  stone: { label: 'stone', icon: '🪨' },
  flint: { label: 'flint', icon: '🔥' },
};

function primitiveParts(kind) {
  if (kind === 'wood') {
    const g = new THREE.CylinderGeometry(0.035, 0.045, 0.7, 5); g.rotateZ(Math.PI / 2); g.translate(0, 0.04, 0);
    return [{ geometry: g, material: lambert(0x8a6440) }];
  }
  const g = new THREE.DodecahedronGeometry(0.13, 0); g.translate(0, 0.08, 0);
  return [{ geometry: g, material: lambert(kind === 'flint' ? 0x2e333d : 0x7a7f86) }];
}

export class Items {
  /** @param sources {wood?, stone?, flint?} arrays of {geometry, material} from loadParts */
  constructor(scene, cave, seed, sources = {}) {
    const rng = mulberry32(seed * 13 + 5);
    this.list = [];
    const [lanternmouth, flintseam] = cave.chambers;
    const place = (kind, count, nearStart, inChamber = null) => {
      let guard = 0;
      for (let i = 0; i < count && guard++ < count * 20; i++) {
        const ch = i < nearStart ? lanternmouth : inChamber && rng() < 0.6 ? inChamber : null;
        const p = cave.randomPoint(rng, 1.0, 99, ch);
        if (!p) continue;
        if (Math.hypot(p.x - lanternmouth.x, p.z - lanternmouth.z) < 1.5) { i--; continue; } // keep spawn clear
        this.list.push({ kind, pos: p, rot: rng() * Math.PI * 2, tilt: rng(), scale: 0.85 + rng() * 0.4, alive: true });
      }
    };
    place('wood', CONFIG.items.wood, 6);
    place('stone', CONFIG.items.stone, 2);
    place('flint', CONFIG.items.flint, 1, flintseam);

    this.meshes = {};
    const idx = {};
    for (const kind of Object.keys(ITEM_INFO)) {
      const n = this.list.filter((i) => i.kind === kind).length;
      const parts = sources[kind] || primitiveParts(kind);
      this.meshes[kind] = parts.map((pt) => {
        const im = new THREE.InstancedMesh(pt.geometry, pt.material, n);
        scene.add(im);
        return im;
      });
      idx[kind] = 0;
    }
    for (const it of this.list) {
      it.index = idx[it.kind]++;
      _q.setFromEuler(_e.set(0, it.rot, 0));
      _m.compose(_p.set(it.pos.x, it.pos.y - 0.01, it.pos.z), _q, _s.setScalar(it.scale));
      it.matrix = _m.clone();
      this._set(it, _m);
    }
    for (const arr of Object.values(this.meshes)) for (const m of arr) { m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere(); }
    this._t = 0;
  }

  _set(it, matrix) {
    for (const m of this.meshes[it.kind]) { m.setMatrixAt(it.index, matrix); m.instanceMatrix.needsUpdate = true; }
  }

  /** Nearest alive item within reach, preferring what's in front of the camera. */
  findTarget(pos, forward, reach = 2.1) {
    let best = null, bestScore = Infinity;
    for (const it of this.list) {
      if (!it.alive) continue;
      const dx = it.pos.x - pos.x, dz = it.pos.z - pos.z;
      const d = Math.hypot(dx, dz);
      if (d > reach) continue;
      const facing = d > 0.01 ? (dx * forward.x + dz * forward.z) / d : 1;
      if (d > 1.0 && facing < 0.3) continue;
      const score = d - facing * 0.8;
      if (score < bestScore) { bestScore = score; best = it; }
    }
    return best;
  }

  pickUp(it) { it.alive = false; this._set(it, ZERO); if (this._last === it) this._last = null; }

  update(dt, target) {
    this._t += dt;
    if (this._last && this._last !== target && this._last.alive) this._set(this._last, this._last.matrix);
    if (target) {
      _m.copy(target.matrix);
      _m.elements[13] += 0.06 + Math.sin(this._t * 6) * 0.04; // highlight bob
      this._set(target, _m);
    }
    this._last = target;
  }
}
