// Loose pickups: wood (sticks), stone, flint (M0) + mushrooms, glowcaps, crystal shards (M1).
// One InstancedMesh per kind and part (Kenney GLBs when available, primitives otherwise); picked
// items are hidden by zero-scaling their instance and regrow slowly (CONFIG.items.respawn) once
// the player is out of sight range.
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { mulberry32 } from '../world/noise.js';
import { lambert } from '../assets.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { STORY } from '../data/story.js';

const CULL_DIST = 26; // whole-kind distance cull: no alive item of a kind within this → mesh hidden (saves calls)

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

// Item ids follow story/DATA_FORMATS.md (wood, stone, flint, mushroom, glowcap, crystal_shard, stew);
// descriptions are the writer's item_flavor.json lines. `pickup` kinds lie around the cave.
export const ITEM_INFO = {
  wood:  { label: 'wood',  icon: '🪵', img: 'wood', pickup: true },
  stone: { label: 'stone', icon: '🪨', img: 'stone', pickup: true },
  flint: { label: 'flint', icon: '✦', pickup: true },
  mushroom: { label: 'mushroom', icon: '🍄', pickup: true },
  glowcap: { label: 'glowcap', icon: '🍄', img: 'glowcap', pickup: true },
  crystal_shard: { label: 'crystal shard', icon: '💎', img: 'crystal', pickup: true },
  stew: { label: 'stew', icon: '🍲', img: 'stew-bowl' },
};
for (const [k, line] of Object.entries(STORY.itemFlavor.items)) if (ITEM_INFO[k]) ITEM_INFO[k].desc = line;
export const PICKUP_KINDS = Object.keys(ITEM_INFO).filter((k) => ITEM_INFO[k].pickup);

function primitiveParts(kind) {
  if (kind === 'wood') {
    const g = new THREE.CylinderGeometry(0.035, 0.045, 0.7, 5); g.rotateZ(Math.PI / 2); g.translate(0, 0.04, 0);
    return [{ geometry: g, material: lambert(0x8a6440) }];
  }
  if (kind === 'glowcap') { // one emissive part (stem + cap) = one draw call
    const stem = new THREE.CylinderGeometry(0.025, 0.035, 0.16, 5, 1, true); stem.translate(0, 0.08, 0);
    const cap = new THREE.SphereGeometry(0.1, 7, 3, 0, Math.PI * 2, 0, Math.PI / 2); cap.scale(1, 0.6, 1); cap.translate(0, 0.15, 0);
    const g = mergeGeometries([stem.toNonIndexed(), cap.toNonIndexed()]);
    return [{ geometry: g, material: lambert(0x3fd9e0, { emissive: 0x2fc6d6, emissiveIntensity: 1.6 }) }];
  }
  if (kind === 'crystal_shard') {
    const g = new THREE.OctahedronGeometry(0.09, 0); g.scale(0.7, 1.8, 0.7); g.rotateZ(0.25); g.translate(0, 0.14, 0);
    return [{ geometry: g, material: lambert(0x9a6ee0, { emissive: 0x7a4fd0, emissiveIntensity: 2.0 }) }];
  }
  if (kind === 'mushroom') {
    const stem = new THREE.CylinderGeometry(0.03, 0.04, 0.12, 5); stem.translate(0, 0.06, 0);
    const cap = new THREE.ConeGeometry(0.11, 0.09, 7); cap.translate(0, 0.15, 0);
    return [{ geometry: stem, material: lambert(0xe6d8bd) }, { geometry: cap, material: lambert(0xb3472f) }];
  }
  const g = new THREE.DodecahedronGeometry(0.13, 0); g.translate(0, 0.08, 0);
  return [{ geometry: g, material: lambert(kind === 'flint' ? 0x2e333d : 0x7a7f86) }];
}

/** Untextured, non-emissive multi-part models → one vertex-coloured geometry (1 draw call). */
function bakeParts(parts) {
  if (parts.length < 2 || parts.some((p) => p.material.map || (p.material.emissive && p.material.emissive.getHex()))) return parts;
  const gs = parts.map((p) => {
    const g = p.geometry.index ? p.geometry.toNonIndexed() : p.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    const n = g.attributes.position.count, a = new Float32Array(n * 3), c = p.material.color;
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return g;
  });
  return [{ geometry: mergeGeometries(gs), material: lambert(0xffffff, { vertexColors: true }) }];
}

export class Items {
  /** @param sources {wood?, stone?, flint?} arrays of {geometry, material} from loadParts */
  constructor(scene, cave, seed, sources = {}) {
    const rng = mulberry32(seed * 13 + 5);
    this.list = [];
    const [lanternmouth, flintseam, glowcapCh, mossdrip] = cave.chambers;
    this.cave = cave;
    const place = (kind, count, nearStart, inChamber = null, bias = 0.6) => {
      let guard = 0;
      for (let i = 0; i < count && guard++ < count * 20; i++) {
        const ch = i < nearStart ? lanternmouth : inChamber && rng() < bias ? (Array.isArray(inChamber) ? inChamber[Math.floor(rng() * inChamber.length)] : inChamber) : null;
        const p = cave.randomPoint(rng, 1.0, 99, ch);
        if (!p) continue;
        if (Math.hypot(p.x - lanternmouth.x, p.z - lanternmouth.z) < 1.5) { i--; continue; } // keep spawn clear
        this.list.push({ kind, pos: p, rot: rng() * Math.PI * 2, tilt: rng(), scale: 0.85 + rng() * 0.4, alive: true });
      }
    };
    place('wood', CONFIG.items.wood, 6);
    place('stone', CONFIG.items.stone, 2);
    place('flint', CONFIG.items.flint, 1, flintseam);
    // M1 forage (separate rng stream so M0 item positions stay identical)
    const rng2 = mulberry32(seed * 29 + 11);
    const place2 = (kind, count, chambers, bias) => {
      for (let i = 0, guard = 0; i < count && guard++ < count * 20; i++) {
        const ch = rng2() < bias ? chambers[Math.floor(rng2() * chambers.length)] : null;
        const p = cave.randomPoint(rng2, 1.0, 99, ch);
        if (!p || Math.hypot(p.x - lanternmouth.x, p.z - lanternmouth.z) < 3) { i--; continue; }
        this.list.push({ kind, pos: p, rot: rng2() * Math.PI * 2, tilt: rng2(), scale: 0.9 + rng2() * 0.35, alive: true });
      }
    };
    place2('mushroom', CONFIG.items.mushroom, [mossdrip, glowcapCh, lanternmouth], 0.7);
    place2('glowcap', CONFIG.items.glowcap, [glowcapCh], 0.75);
    place2('crystal_shard', CONFIG.items.crystal_shard, [flintseam], 0.8);
    // Chunk C: surface pickups in the clearing (own rng stream; cave items unchanged)
    if (cave.clearing) {
      const rng3 = mulberry32(seed * 37 + 3), cl = cave.clearing;
      for (const [kind, count] of [['wood', 6], ['mushroom', 5]]) {
        for (let i = 0, guard = 0; i < count && guard++ < 200; ) {
          const p = cave.randomPoint(rng3, 1.0, 99, cl);
          if (!p || Math.hypot(p.x - cl.x, p.z - cl.z) > cl.r - 2.5) continue;
          if (this.list.some((o) => Math.hypot(o.pos.x - p.x, o.pos.z - p.z) < 1.2)) continue;
          this.list.push({ kind, pos: p, rot: rng3() * Math.PI * 2, tilt: rng3(), scale: 0.9 + rng3() * 0.3, alive: true, surface: true });
          i++;
        }
      }
    }

    this.meshes = {};
    const idx = {};
    for (const kind of PICKUP_KINDS) {
      const n = this.list.filter((i) => i.kind === kind).length;
      const parts = bakeParts(sources[kind] || primitiveParts(kind));
      this.meshes[kind] = parts.map((pt) => {
        const im = new THREE.InstancedMesh(pt.geometry, pt.material, Math.max(1, n));
        im.count = n;
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

  pickUp(it) {
    it.alive = false; this._set(it, ZERO); if (this._last === it) this._last = null;
    it.respawnAt = this._t + (CONFIG.items.respawn[it.kind] ?? 300);
  }

  /** Nearest alive item to `pos` within r (optionally also within r2 of pos2). */
  nearest(pos, r, pos2 = null, r2 = Infinity) {
    let best = null, bd = r;
    for (const it of this.list) {
      if (!it.alive) continue;
      const d = Math.hypot(it.pos.x - pos.x, it.pos.z - pos.z);
      if (d >= bd) continue;
      if (pos2 && Math.hypot(it.pos.x - pos2.x, it.pos.z - pos2.z) > r2) continue;
      bd = d; best = it;
    }
    return best;
  }

  // ---- save (Chunk C): -1 = lying there, else seconds until it regrows
  serialize() { return this.list.map((it) => (it.alive ? -1 : Math.max(0, Math.round(it.respawnAt - this._t)))); }
  restore(arr) {
    if (!Array.isArray(arr) || arr.length !== this.list.length) return;
    this.list.forEach((it, i) => {
      if (arr[i] === -1 || arr[i] == null) return;
      it.alive = false; this._set(it, ZERO); it.respawnAt = this._t + (+arr[i] || 0);
    });
  }

  /** Items alive per kind (debug / smoke test). */
  counts() { const c = {}; for (const it of this.list) if (it.alive) c[it.kind] = (c[it.kind] || 0) + 1; return c; }

  update(dt, target, playerPos = null) {
    this._t += dt;
    // slow regrowth, out of sight (> 7 m) so nothing pops in
    if (playerPos && (this._rs = (this._rs || 0) + dt) > 0.5) {
      this._rs = 0;
      for (const it of this.list) {
        if (it.alive || this._t < it.respawnAt) continue;
        if (Math.hypot(it.pos.x - playerPos.x, it.pos.z - playerPos.z) < 7) continue;
        it.alive = true; this._set(it, it.matrix);
      }
      // distance cull whole kinds (glowcaps live in the Galleries, shards in Flintseam…)
      const near = {};
      for (const it of this.list) if (it.alive && !near[it.kind] && Math.hypot(it.pos.x - playerPos.x, it.pos.z - playerPos.z) < CULL_DIST) near[it.kind] = true;
      for (const [k, arr] of Object.entries(this.meshes)) for (const m of arr) m.visible = !!near[k];
    }
    if (this._last && this._last !== target && this._last.alive) this._set(this._last, this._last.matrix);
    if (target) {
      _m.copy(target.matrix);
      _m.elements[13] += 0.06 + Math.sin(this._t * 6) * 0.04; // highlight bob
      this._set(target, _m);
    }
    this._last = target;
  }
}
