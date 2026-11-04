// Shelter building (M1). Build mode shows a green/red ghost of the selected piece snapped to
// 2 m cells laid on the 1 m grid (cell centres on even metres, edges on odd metres; the art's
// pieces are 2 m wide): floors/props/roofs snap to cells, walls/windows/doors to cell edges. Use places,
// ⟳ rotates (props/floors/roofs in 90° steps, edge pieces flip which way they face), 🗑 toggles
// remove mode (full refund). Every piece type is ONE InstancedMesh per material part (doors and
// chest lids get their own animated instanced part), so 60+ pieces cost ~12 draw calls.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CONFIG } from '../config.js';
import { lambert, loadParts } from '../assets.js';
import { Emitter } from '../render/lights.js';
import { PIECES, PIECE_ORDER, costText } from './pieces.js';

const G = CONFIG.build.grid, H = CONFIG.build.wallHeight;
const CAP = 96; // instances per piece type
const HALF = Math.PI / 2;
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _one = new THREE.Vector3(1, 1, 1);
const _yAxis = new THREE.Vector3(0, 1, 0), _xAxis = new THREE.Vector3(1, 0, 0);

// ------------------------------------------------------------------ geometry prep
function strip(g, keepUv) {
  g = g.index ? g.toNonIndexed() : g.clone();
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', ...(keepUv ? ['uv'] : [])].includes(k)) g.deleteAttribute(k);
  return g;
}
function bakeColor(g, color) {
  const n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = color.r; a[i * 3 + 1] = color.g; a[i * 3 + 2] = color.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
/** Merge static parts into as few draw calls as possible (same texture → 1; untextured → vertex colours). */
function mergeParts(parts) {
  if (parts.length <= 1) return parts;
  if (parts.every((p) => p.material.map)) {
    const byMap = new Map();
    for (const p of parts) { const k = p.material.map.image?.src || p.material.map.uuid; (byMap.get(k) || byMap.set(k, []).get(k)).push(p); }
    return [...byMap.values()].map((ps) => ({ geometry: mergeGeometries(ps.map((p) => strip(p.geometry, true))), material: ps[0].material }));
  }
  if (parts.every((p) => !p.material.map)) {
    // emissive parts (lantern glass) keep their own material; the rest bake to vertex colours
    const glow = (p) => p.material.emissive && p.material.emissive.getHex() !== 0 && p.material.emissiveIntensity > 0;
    const plain = parts.filter((p) => !glow(p)), lit = parts.filter(glow);
    const out = [];
    if (plain.length) out.push({ geometry: mergeGeometries(plain.map((p) => bakeColor(strip(p.geometry, false), p.material.color))), material: lambert(0xffffff, { vertexColors: true }) });
    if (lit.length) out.push({ geometry: mergeGeometries(lit.map((p) => strip(p.geometry, false))), material: lit[0].material });
    return out;
  }
  return parts;
}

function boxGeo(w, h, d, x = 0, y = 0, z = 0) { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y + h / 2, z); return g; }
function fallback(type) {
  const wood = lambert(0x8a6440), dark = lambert(0x5e4128);
  switch (type) {
    case 'floor': return { static: [{ geometry: boxGeo(G, 0.16, G), material: wood }] };
    case 'wall': case 'window': return { static: [{ geometry: boxGeo(0.2, H, G), material: wood }] };
    case 'door': return { static: [{ geometry: mergeGeometries([boxGeo(0.2, H, 0.6, 0, 0, -0.7), boxGeo(0.2, H, 0.6, 0, 0, 0.7), boxGeo(0.2, 0.5, 0.8, 0, H - 0.5)]), material: wood }],
      anim: { geometry: boxGeo(0.1, 1.8, 0.8, 0, 0, 0.4), material: dark, pivot: new THREE.Vector3(0, 0, -0.4) } };
    case 'roof': { const g = new THREE.ConeGeometry(G * 0.78, 1.0, 4, 1); g.rotateY(Math.PI / 4); g.translate(0, 0.5, 0); return { static: [{ geometry: g, material: dark }] }; }
    case 'bedroll': return { static: [{ geometry: boxGeo(0.8, 0.2, 1.8), material: lambert(0x7a4a3a) }] };
    case 'lantern': return { static: [{ geometry: mergeGeometries([boxGeo(0.08, 1.4, 0.08), boxGeo(0.25, 0.3, 0.25, 0, 1.3)]), material: dark }] };
    case 'table': return { static: [{ geometry: mergeGeometries([boxGeo(1.0, 0.08, 0.9, 0, 0.66), boxGeo(0.12, 0.66, 0.12, 0.35, 0, 0.3), boxGeo(0.12, 0.66, 0.12, -0.35, 0, -0.3), boxGeo(0.12, 0.66, 0.12, 0.35, 0, -0.3), boxGeo(0.12, 0.66, 0.12, -0.35, 0, 0.3)]), material: wood }] };
    case 'chest': return { static: [{ geometry: boxGeo(0.8, 0.4, 0.55, 0, 0, 0), material: wood }],
      anim: { geometry: boxGeo(0.8, 0.15, 0.55, 0, 0, 0.275), material: dark, pivot: new THREE.Vector3(0, 0.4, -0.275) } };
    default: return { static: [] };
  }
}

// per-type transform from the Kenney file into piece space (origin at the base centre; edge
// pieces run along local Z with their front facing local +X)
const RY90 = new THREE.Matrix4().makeRotationY(HALF); // art walls run along X, front +Z → along Z, front +X
const PREP = {
  floor: {}, roof: {}, lantern: {}, bedroll: {},
  wall: { raw: RY90 }, window: { raw: RY90 },
  door: { raw: RY90, anim: 'door_hinge', pivot: new THREE.Vector3(-0.39, 0, 0), angle: -100 },
  chest: { anim: 'lid_hinge', pivot: new THREE.Vector3(0, 0.45, -0.25), angle: -75 }, // pivots in file units
};

/** Load and prepare every piece's geometry (call once at init). */
export async function loadPieceParts() {
  const out = {};
  await Promise.all(PIECE_ORDER.map(async (type) => {
    const def = PIECES[type], prep = PREP[type];
    if (!def.model) return;
    const parts = await loadParts(def.model, { raw: true });
    if (!parts) { out[type] = fallback(type); return; }
    const stat = [], animParts = [];
    for (const p of parts) {
      if (prep.raw) p.geometry.applyMatrix4(prep.raw);
      (prep.anim && (p.node === prep.anim || p.ancestors?.includes(prep.anim)) ? animParts : stat).push(p);
    }
    const res = { static: mergeParts(stat) };
    if (animParts.length) {
      const a = mergeParts(animParts)[0];
      const pivot = prep.pivot.clone(); if (prep.raw) pivot.applyMatrix4(prep.raw);
      a.geometry.translate(-pivot.x, -pivot.y, -pivot.z);
      res.anim = { geometry: a.geometry, material: a.material, pivot };
    }
    out[type] = res;
  }));
  return out;
}

// ------------------------------------------------------------------ system
export class BuildSystem {
  constructor(scene, cave, partsByType, { fires, budget, colliders }) {
    this.scene = scene; this.cave = cave; this.fires = fires; this.budget = budget; this.colliders = colliders;
    this.active = false; this.removeMode = false;
    this.selected = 'floor'; this.rot = 0; this.flip = false;
    this.pieces = []; this.slots = new Map(); this._id = 0;
    this.target = null; // current ghost placement or removal target
    this.blocked = null; // optional (x, z, r) => bool — set by main.js to keep pieces off trees/rocks
    this.batches = {};
    for (const type of PIECE_ORDER) {
      const src = type === 'hearth' ? { static: [] } : (partsByType[type] || fallback(type));
      const b = { src, items: [], stat: [], anim: null };
      for (const p of src.static) { const im = new THREE.InstancedMesh(p.geometry, p.material, CAP); im.count = 0; im.visible = false; im.frustumCulled = false; scene.add(im); b.stat.push(im); }
      if (src.anim) { const im = new THREE.InstancedMesh(src.anim.geometry, src.anim.material, CAP); im.count = 0; im.visible = false; im.frustumCulled = false; scene.add(im); b.anim = im; }
      this.batches[type] = b;
    }
    // shared ghost
    this.ghostMat = new THREE.MeshBasicMaterial({ color: 0x6fdc8c, transparent: true, opacity: 0.42, depthWrite: false });
    this.ghost = new THREE.Group(); this.ghost.visible = false; scene.add(this.ghost);
    this._ghostType = null;
    this.floorTop = 0.2;
    const fs = partsByType.floor?.static?.[0]?.geometry;
    if (fs) { fs.computeBoundingBox(); this.floorTop = fs.boundingBox.max.y; }
  }

  // ---------------------------------------------------------------- mode + selection
  toggle() { this.active = !this.active; this.removeMode = false; this.ghost.visible = this.active; this.target = null; return this.active; }
  select(type) { if (PIECES[type]) { this.selected = type; this.removeMode = false; } }
  rotate() { if (PIECES[this.selected].slot === 'edge') this.flip = !this.flip; else this.rot = (this.rot + 1) % 4; }
  setRemove(on) { this.removeMode = on ?? !this.removeMode; this.target = null; return this.removeMode; }
  canAfford(inv, type = this.selected) { return Object.entries(PIECES[type].cost).every(([k, n]) => (inv[k] || 0) >= n); }
  costText(type = this.selected) { return costText(PIECES[type].cost); }

  // ---------------------------------------------------------------- grid helpers
  _cellPiece(i, j, slot) { return this.slots.get(`${slot}:${i},${j}`); }
  _groundMax(x, z, pts) {
    let top = -Infinity;
    for (const [dx, dz] of pts) top = Math.max(top, this.cave.floorAt(x + dx, z + dz));
    return top;
  }
  cellBase(i, j) {
    const f = this._cellPiece(i, j, 'cell');
    if (f) return f.y + this.floorTop;
    const h = G / 2 * 0.9;
    return this._groundMax(i * G, j * G, [[0, 0], [-h, -h], [h, -h], [-h, h], [h, h]]);
  }
  _edgeCells(i, j, side) { return side === 0 ? [[i, j], [i + 1, j]] : [[i, j], [i, j + 1]]; }
  _edgeCentre(i, j, side) { return side === 0 ? { x: (i + 0.5) * G, z: j * G } : { x: i * G, z: (j + 0.5) * G }; }
  edgeBase(i, j, side) {
    let top = -Infinity, any = false;
    for (const [a, b] of this._edgeCells(i, j, side)) { const f = this._cellPiece(a, b, 'cell'); if (f) { any = true; top = Math.max(top, f.y + this.floorTop); } }
    if (any) return top;
    const c = this._edgeCentre(i, j, side), h = G / 2 * 0.9;
    return this._groundMax(c.x, c.z, side === 0 ? [[0, -h], [0, 0], [0, h]] : [[-h, 0], [0, 0], [h, 0]]);
  }
  _cellEdges(i, j) { return [[i, j, 0], [i - 1, j, 0], [i, j, 1], [i, j - 1, 1]]; }

  /** Compute where the selected piece would go, and whether it's valid. */
  _plan(player) {
    const type = this.selected, def = PIECES[type], f = player.forward, P = player.pos;
    const s = {};
    if (def.slot === 'edge') {
      const ax = P.x + f.x * 1.6, az = P.z + f.z * 1.6;
      const u = ax / G - 0.5, w = az / G - 0.5;
      const dV = Math.abs(u - Math.round(u)), dH = Math.abs(w - Math.round(w));
      let i, j, side;
      if (dV < dH) { i = Math.round(u); j = Math.round(az / G); side = 0; } else { i = Math.round(ax / G); j = Math.round(w); side = 1; }
      const c = this._edgeCentre(i, j, side);
      let yaw = side === 0 ? 0 : -HALF; // local +X → world +X (side 0) or +Z (side 1)
      const nx = side === 0 ? 1 : 0, nz = side === 0 ? 0 : 1;
      if ((P.x - c.x) * nx + (P.z - c.z) * nz > 0) yaw += Math.PI; // front faces away from Cam
      if (this.flip) yaw += Math.PI;
      const y = this.edgeBase(i, j, side);
      const key = `edge:${i},${j},${side}`;
      let ok = true, why = '';
      for (const t of [-0.45, 0, 0.45]) {
        const px = c.x + (side === 1 ? t * G : 0), pz = c.z + (side === 0 ? t * G : 0);
        if (this.cave.field(px, pz) < 0.35) { ok = false; why = 'Too close to the cave wall'; }
      }
      const smp = this.cave.sample(c.x, c.z, s);
      if (ok && smp.ceil < y + H + 0.05) { ok = false; why = 'The ceiling is too low here'; }
      if (ok && y - this.cave.floorAt(c.x, c.z) > 0.7) { ok = false; why = 'Too uneven'; }
      if (ok && this.slots.has(key)) { ok = false; why = 'Something is already there'; }
      if (ok && this.blocked?.(c.x, c.z, 0.9)) { ok = false; why = 'A tree or rock is in the way'; }
      // don't wall Cam in
      const along = side === 0 ? P.z - c.z : P.x - c.x, across = side === 0 ? P.x - c.x : P.z - c.z;
      if (ok && Math.abs(across) < 0.5 && Math.abs(along) < G / 2 + 0.3) { ok = false; why = 'You are standing in the way'; }
      return { type, key, i, j, side, x: c.x, y, z: c.z, yaw, ok, why };
    }
    const ax = P.x + f.x * CONFIG.build.reach, az = P.z + f.z * CONFIG.build.reach;
    const i = Math.round(ax / G), j = Math.round(az / G), x = i * G, z = j * G;
    const yaw = this.rot * HALF;
    let ok = true, why = '';
    if (def.slot === 'cell') {
      const h = G / 2 * 0.9;
      for (const [dx, dz] of [[0, 0], [-h, -h], [h, -h], [-h, h], [h, h]]) if (this.cave.field(x + dx, z + dz) < 0.6) { ok = false; why = 'Too close to the cave wall'; }
      const y = this._groundMax(x, z, [[0, 0], [-h, -h], [h, -h], [-h, h], [h, h]]);
      if (ok && y - this.cave.floorAt(x, z) > 0.6) { ok = false; why = 'Too sloped'; }
      const key = `cell:${i},${j}`;
      if (ok && this.slots.has(key)) { ok = false; why = 'Something is already there'; }
      if (ok && this._cellPiece(i, j, 'prop')) { ok = false; why = 'Move the furniture first'; }
      if (ok && this.blocked?.(x, z, 1.1)) { ok = false; why = 'A tree or rock is in the way'; }
      return { type, key, i, j, x, y, z, yaw, ok, why };
    }
    if (def.slot === 'roof') {
      let y = this.cellBase(i, j), support = false;
      for (const [a, b, sd] of this._cellEdges(i, j)) { const w = this.slots.get(`edge:${a},${b},${sd}`); if (w) { support = true; y = Math.max(y, w.y); } }
      y += H;
      const key = `roof:${i},${j}`;
      if (!support) { ok = false; why = 'A roof needs a wall under one edge'; }
      const smp = this.cave.sample(x, z, s);
      if (ok && smp.ceil < y + 0.5) { ok = false; why = 'The ceiling is too low here'; }
      if (ok && this.slots.has(key)) { ok = false; why = 'Something is already there'; }
      return { type, key, i, j, x, y, z, yaw, ok, why };
    }
    // prop
    const y = this._cellPiece(i, j, 'cell') ? this.cellBase(i, j) : this.cave.floorAt(x, z);
    const key = `prop:${i},${j}`;
    if (this.cave.field(x, z) < 0.9) { ok = false; why = 'Too close to the cave wall'; }
    const smp = this.cave.sample(x, z, s);
    if (ok && smp.ceil < y + 1.9) { ok = false; why = 'The ceiling is too low here'; }
    if (ok && this.slots.has(key)) { ok = false; why = 'Something is already there'; }
    if (ok && Math.hypot(P.x - x, P.z - z) < 0.75 && type !== 'bedroll') { ok = false; why = 'You are standing in the way'; }
    if (ok && this.blocked?.(x, z, 0.8)) { ok = false; why = 'A tree or rock is in the way'; }
    if (ok && type === 'hearth' && this.fires.nearest(_v.set(x, y, z), 3.5)) { ok = false; why = 'Too close to another fire'; }
    return { type, key, i, j, x, y, z, yaw, ok, why };
  }

  _removeTarget(player) {
    const f = player.forward, ax = player.pos.x + f.x * 1.7, az = player.pos.z + f.z * 1.7;
    const up = player.pitch > 0.35;
    let best = null, bs = Infinity;
    for (const p of this.pieces) {
      const d = Math.hypot(p.x - ax, p.z - az);
      if (d > 1.7) continue;
      const slot = PIECES[p.type].slot;
      const s = d + (slot === 'cell' ? 0.7 : 0) + (slot === 'roof' ? (up ? -0.8 : 1.2) : 0) + (slot === 'edge' ? -0.1 : 0);
      if (s < bs) { bs = s; best = p; }
    }
    return best;
  }

  _ensureGhost(type) {
    if (this._ghostType === type) return;
    this.ghost.clear();
    const b = this.batches[type];
    const add = (g, m) => { const mesh = new THREE.Mesh(g, this.ghostMat); if (m) mesh.matrix.copy(m), mesh.matrixAutoUpdate = false; this.ghost.add(mesh); };
    if (type === 'hearth') { const g = new THREE.CylinderGeometry(0.55, 0.6, 0.25, 8); g.translate(0, 0.12, 0); add(g); }
    for (const p of b.src.static) add(p.geometry);
    if (b.src.anim) add(b.src.anim.geometry, new THREE.Matrix4().makeTranslation(b.src.anim.pivot));
    this._ghostType = type;
  }

  update(player, dt = 0.016) {
    this._animate(dt);
    if (!this.active) { this.ghost.visible = false; return; }
    if (this.removeMode) {
      const p = this._removeTarget(player);
      this.target = p ? { remove: p } : null;
      this.ghost.visible = !!p;
      if (p) {
        this._ensureGhost(p.type);
        this.ghost.position.set(p.x, p.y + 0.01, p.z); this.ghost.rotation.set(0, p.yaw, 0); this.ghost.scale.setScalar(1.04);
        this.ghostMat.color.setHex(0xff5a4a);
      }
      return;
    }
    const t = this._plan(player);
    this.target = t;
    this._ensureGhost(t.type);
    this.ghost.visible = true;
    this.ghost.scale.setScalar(1);
    this.ghost.position.set(t.x, t.y + 0.01, t.z); this.ghost.rotation.set(0, t.yaw, 0);
    this._affordable = this.canAfford(player.inventory);
    this.ghostMat.color.setHex(t.ok && this._affordable ? 0x6fdc8c : 0xff6a6a);
  }

  // ---------------------------------------------------------------- instances
  _write(p) {
    const b = this.batches[p.type];
    for (const im of b.stat) { im.setMatrixAt(p.index, p.matrix); im.instanceMatrix.needsUpdate = true; }
    if (b.anim) this._writeAnim(p);
  }
  _writeAnim(p) {
    const b = this.batches[p.type], piv = b.src.anim.pivot;
    _m.copy(p.matrix).multiply(_m2.makeTranslation(piv.x, piv.y, piv.z));
    // door_hinge Y → −100°, lid_hinge X → −75° (art notes)
    if (p.type === 'door') _m.multiply(_m2.makeRotationAxis(_yAxis, -p.open * 1.745));
    else _m.multiply(_m2.makeRotationAxis(_xAxis, -p.open * 1.309));
    b.anim.setMatrixAt(p.index, _m); b.anim.instanceMatrix.needsUpdate = true;
  }
  _syncCount(type) {
    const b = this.batches[type];
    const n = b.items.length;
    for (const im of b.stat) { im.count = n; im.visible = n > 0; } // empty instanced meshes still cost a call
    if (b.anim) { b.anim.count = n; b.anim.visible = n > 0; }
  }
  /** Place the current ghost. Returns {ok, why?, piece?}. */
  place(inv) {
    const t = this.target;
    if (!t || t.remove) return { ok: false, why: 'Nothing to place' };
    if (!t.ok) return { ok: false, why: t.why || 'Can’t build there' };
    if (!this.canAfford(inv, t.type)) return { ok: false, why: `Needs ${this.costText(t.type)}` };
    const b = this.batches[t.type];
    if (b.items.length >= CAP) return { ok: false, why: 'That’s plenty of those' };
    for (const [k, n] of Object.entries(PIECES[t.type].cost)) inv[k] -= n;
    const p = { id: ++this._id, type: t.type, key: t.key, i: t.i, j: t.j, side: t.side, x: t.x, y: t.y, z: t.z, yaw: t.yaw, open: 0, openTarget: 0, colliders: [] };
    p.matrix = new THREE.Matrix4().compose(_v.set(p.x, p.y, p.z), _q.setFromAxisAngle(_yAxis, p.yaw), _one);
    p.index = b.items.length; b.items.push(p); this._syncCount(t.type);
    this._write(p);
    this.pieces.push(p); this.slots.set(p.key, p);
    this._attach(p);
    return { ok: true, piece: p };
  }

  _attach(p) {
    const C = this.colliders;
    switch (p.type) {
      case 'wall': case 'window': p.colliders.push(C.box(p.x, p.z, 0.12, G / 2, p.yaw)); break;
      case 'door': {
        // two side posts always, plus the leaf while closed. Local Z runs along the edge.
        const s = Math.sin(p.yaw), c = Math.cos(p.yaw);
        for (const lz of [-0.72, 0.72]) p.colliders.push(C.box(p.x + lz * s, p.z + lz * c, 0.12, 0.28, p.yaw));
        p.leaf = C.box(p.x, p.z, 0.1, 0.44, p.yaw); p.colliders.push(p.leaf);
        break;
      }
      case 'chest': p.colliders.push(C.circle(p.x, p.z, 0.4)); p.store = {}; break;
      case 'table': p.colliders.push(C.circle(p.x, p.z, 0.5)); break;
      case 'lantern': {
        p.colliders.push(C.circle(p.x, p.z, 0.15));
        p.glowPos = new THREE.Vector3(p.x, p.y + 1.55, p.z); // between lantern_L/R (emissive glass)
        p.emitter = this.budget?.add(new Emitter({ color: 0xffb35c, intensity: 3.0, distance: 6, decay: 2, priority: 1 }));
        if (p.emitter) p.emitter.pos.copy(p.glowPos);
        break;
      }
      case 'hearth': p.fire = this.fires.build(new THREE.Vector3(p.x, p.y, p.z), 0); p.fire.hearth = true; break;
      default: break;
    }
  }

  /** Remove the targeted piece (remove mode) with a full refund. Returns {ok, why?, refund?, piece?, contents?}. */
  remove(inv, piece = this.target?.remove) {
    if (!piece) return { ok: false, why: 'Aim at a piece to remove' };
    const slot = PIECES[piece.type].slot;
    if (slot === 'cell' && (this._cellPiece(piece.i, piece.j, 'prop') || this._cellPiece(piece.i, piece.j, 'roof'))) return { ok: false, why: 'Clear what’s on this floor first' };
    if (slot === 'edge') {
      // a roof must keep at least one supporting wall
      for (const [a, b] of this._edgeCells(piece.i, piece.j, piece.side)) {
        const r = this._cellPiece(a, b, 'roof'); if (!r) continue;
        const others = this._cellEdges(a, b).filter(([x, y, s]) => { const w = this.slots.get(`edge:${x},${y},${s}`); return w && w !== piece; });
        if (!others.length) return { ok: false, why: 'That wall is holding up a roof' };
      }
    }
    const refund = { ...PIECES[piece.type].cost };
    for (const [k, n] of Object.entries(refund)) inv[k] = (inv[k] || 0) + n;
    let contents = null;
    if (piece.store) { contents = { ...piece.store }; for (const [k, n] of Object.entries(piece.store)) inv[k] = (inv[k] || 0) + n; }
    for (const c of piece.colliders) this.colliders.remove(c);
    if (piece.emitter) this.budget?.remove(piece.emitter);
    if (piece.fire) this.fires.remove(piece.fire);
    // swap-remove the instance
    const b = this.batches[piece.type];
    const last = b.items.pop();
    if (last !== piece) { last.index = piece.index; b.items[last.index] = last; this._write(last); }
    for (const im of b.stat) im.setMatrixAt(b.items.length, ZERO);
    if (b.anim) b.anim.setMatrixAt(b.items.length, ZERO);
    this._syncCount(piece.type);
    this.pieces = this.pieces.filter((p) => p !== piece); this.slots.delete(piece.key);
    if (this.target?.remove === piece) this.target = null;
    return { ok: true, refund, piece, contents };
  }

  // ---------------------------------------------------------------- doors + chests
  /** Nearest door/chest Cam can use (outside build mode). */
  findInteractable(pos, forward, reach = 2.1) {
    let best = null, bs = Infinity;
    for (const p of this.pieces) {
      if (p.type !== 'door' && p.type !== 'chest') continue;
      const dx = p.x - pos.x, dz = p.z - pos.z, d = Math.hypot(dx, dz);
      if (d > reach) continue;
      const facing = d > 0.01 ? (dx * forward.x + dz * forward.z) / d : 1;
      if (facing < 0.35) continue;
      const s = d - facing;
      if (s < bs) { bs = s; best = p; }
    }
    return best;
  }
  pickScreen(x, y, camera, pos) {
    let best = null, bd = Infinity;
    for (const p of this.pieces) {
      if (p.type !== 'door' && p.type !== 'chest') continue;
      const d = Math.hypot(p.x - pos.x, p.z - pos.z);
      if (d > 3) continue;
      _v.set(p.x, p.y + (p.type === 'door' ? 1.0 : 0.35), p.z).project(camera);
      if (_v.z > 1) continue;
      const e = Math.hypot((_v.x + 1) / 2 * window.innerWidth - x, (1 - _v.y) / 2 * window.innerHeight - y);
      if (e < 130 / Math.max(1, d) && e < bd) { bd = e; best = p; }
    }
    return best;
  }
  toggleDoor(p) { p.openTarget = p.openTarget ? 0 : 1; return !!p.openTarget; }
  setChestOpen(p, on) { p.openTarget = on ? 1 : 0; }

  _animate(dt) {
    for (const p of this.pieces) {
      if (p.open === p.openTarget || (p.type !== 'door' && p.type !== 'chest')) continue;
      const step = dt * (p.type === 'door' ? 2.6 : 3.2);
      p.open = p.openTarget > p.open ? Math.min(p.openTarget, p.open + step) : Math.max(p.openTarget, p.open - step);
      this._writeAnim(p);
      if (p.leaf) p.leaf.on = p.open < 0.35;
    }
  }

  // ---------------------------------------------------------------- queries
  /** Walkable top of a placed floor tile at (x,z), or -Infinity. */
  heightAt(x, z) {
    const t = this._cellPiece(Math.round(x / G), Math.round(z / G), 'cell');
    return t ? t.y + this.floorTop : -Infinity;
  }
  counts() { const c = {}; for (const p of this.pieces) c[p.type] = (c[p.type] || 0) + 1; return c; }
  summary() {
    if (!this.pieces.length) return 'none';
    return Object.entries(this.counts()).map(([k, n]) => `${PIECES[k].name.toLowerCase()} x${n}`).join(', ');
  }
}
