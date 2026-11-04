// Shelter building (M1). Build mode shows a green/red ghost of the selected piece snapped to
// 2 m cells laid on the 1 m grid (cell centres on even metres, edges on odd metres; the art's
// pieces are 2 m wide): floors/props/roofs snap to cells, walls/windows/doors to cell edges. Use places,
// ⟳ rotates (props/floors/roofs in 90° steps, edge pieces flip which way they face), 🗑 toggles
// remove mode (full refund). While pieces are being placed every type is ONE InstancedMesh per
// material part; once the build has been idle for a moment (Chunk B) all static parts of every piece
// are merged into ONE vertex-coloured mesh (+ one unlit mesh for glowing parts), so a 60-piece shelter
// costs ~2 draw calls + 1 per animated part type (door leaves, chest lids, chime). Chunk B also adds
// decorations (rug / hanging / prop), keepsakes on table + chest tops, save/restore, and the
// enclosure test (floor + walls + door + roof) behind inShelter and shelter_complete.
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
const _yAxis = new THREE.Vector3(0, 1, 0), _xAxis = new THREE.Vector3(1, 0, 0), _zAxis = new THREE.Vector3(0, 0, 1);

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
const isGlow = (m) => !!(m.isMeshBasicMaterial || (m.emissive && m.emissive.getHex() !== 0 && m.emissiveIntensity > 0));
/** Geometry for the idle static batch: position + normal + baked colour (glow parts → emissive colour). */
export function batchGeometry(p) {
  if (p.material.map) return null; // textured parts stay instanced
  const g = strip(p.geometry, false);
  const src = p.geometry.attributes.color;
  const glow = isGlow(p.material);
  const c = glow ? (p.material.isMeshBasicMaterial ? p.material.color.clone() : p.material.emissive.clone().multiplyScalar(Math.min(2, p.material.emissiveIntensity)))
    : p.material.color;
  if (src && !glow) {
    const flat = p.geometry.index ? p.geometry.toNonIndexed().attributes.color : src;
    const a = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < a.length / 3; i++) { a[i * 3] = flat.getX(i) * c.r; a[i * 3 + 1] = flat.getY(i) * c.g; a[i * 3 + 2] = flat.getZ(i) * c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  } else bakeColor(g, c);
  return { geometry: g, glow };
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
const T = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z);
// anims: [{ node, kind, angle?, pivot? (file units; default = the node's own origin) }]
//   kind 'hinge' (Y, angle° × open), 'lid' (X, angle° × open), 'chime' (draft sway), 'sway' (±5° lamp),
//   'show' (scaled to 0 unless p.filled — dog bowl food)
const PREP = {
  lantern: { exclude: ['lantern_R'] }, // the base lantern is one lamp; lantern_double (request reward) has both
  crystal_wind_chime: { anims: [{ node: 'chimes', pivot: new THREE.Vector3(0, -0.13, 0), kind: 'chime' }] },
  wall: { raw: RY90 }, window: { raw: RY90 },
  door: { raw: RY90, anims: [{ node: 'door_hinge', pivot: new THREE.Vector3(-0.39, 0, 0), kind: 'hinge', angle: -100 }] },
  chest: { anims: [{ node: 'lid_hinge', pivot: new THREE.Vector3(0, 0.45, -0.25), kind: 'lid', angle: -75 }] }, // pivots in file units
  // M2 chunk B (CRAFT_ASSETS.md)
  fence: { raw: RY90 },
  fence_gate: { raw: RY90, anims: [{ node: 'gate_door', kind: 'hinge', angle: -100 }] },
  window_shutters: { anims: [{ node: 'shutter_L', kind: 'hinge', angle: -100 }, { node: 'shutter_R', kind: 'hinge', angle: 100 }] },
  crafting_bench: { anims: [{ node: 'ember_lamp', kind: 'sway' }] },
  dog_bowl: { anims: [{ node: 'food', kind: 'show' }] },
  cooking_pot: { exclude: ['embers'] }, // the pot sits beside a fire; no embers of its own
  bookshelf: { raw: T(0, 0, -0.9) }, // back against the cell's rear edge
};
const INTERACT = new Set(['door', 'chest', 'bedroll', 'crafting_bench', 'cooking_pot', 'fence_gate', 'window_shutters', 'dog_bowl']);
const FENCE = new Set(['fence', 'fence_gate']);
const OPENS = new Set(['door', 'chest', 'fence_gate', 'window_shutters']);
const TAP_Y = { door: 1.0, bedroll: 0.15, crafting_bench: 0.9, fence_gate: 0.6, window_shutters: 0.35, dog_bowl: 0.08, cooking_pot: 0.4 };
const ANIM_DEFAULT = { door: 'hinge', chest: 'lid', crystal_wind_chime: 'chime' };

/** Load and prepare every piece's geometry (call once at init). */
export async function loadPieceParts() {
  const out = {};
  await Promise.all(PIECE_ORDER.map(async (type) => {
    const def = PIECES[type], prep = PREP[type] || {};
    if (!def.model) return;
    const parts = await loadParts(def.model, { raw: true });
    if (!parts) { out[type] = fallback(type); return; }
    const anims = prep.anims || [];
    const inAnim = (p) => anims.findIndex((a) => p.node === a.node || p.ancestors?.includes(a.node));
    const stat = [], animParts = anims.map(() => []);
    for (const p of parts) {
      if (prep.exclude && (prep.exclude.includes(p.node) || p.ancestors?.some((a) => prep.exclude.includes(a)))) continue;
      if (prep.raw) p.geometry.applyMatrix4(prep.raw);
      const k = inAnim(p);
      // nested anim nodes (vise_jaw under vise …): the innermost listed node wins
      (k >= 0 ? animParts[k] : stat).push(p);
    }
    const res = { static: mergeParts(stat), anims: [], nodes: {} };
    for (const [n, v] of Object.entries(parts.nodes || {})) res.nodes[n] = prep.raw ? v.clone().applyMatrix4(prep.raw) : v.clone();
    anims.forEach((a, k) => {
      if (!animParts[k].length) return;
      const m = mergeParts(animParts[k])[0];
      const pivot = (a.pivot || parts.nodes?.[a.node] || new THREE.Vector3()).clone(); if (prep.raw) pivot.applyMatrix4(prep.raw);
      m.geometry.translate(-pivot.x, -pivot.y, -pivot.z);
      res.anims.push({ geometry: m.geometry, material: m.material, pivot, kind: a.kind, angle: a.angle || 0 });
    });
    out[type] = res;
  }));
  return out;
}

/** M1 fallbacks + loaded parts → { static, anims[] } with anim kinds filled in. */
function normaliseSrc(type, src) {
  if (!src.anims) src.anims = [];
  if (src.anim && !src.anims.length) src.anims.push({ ...src.anim, kind: ANIM_DEFAULT[type] || 'lid', angle: type === 'door' ? -100 : -75 });
  for (const a of src.anims) { if (!a.kind) a.kind = ANIM_DEFAULT[type] || 'lid'; if (!a.angle) a.angle = a.kind === 'hinge' ? -100 : -75; }
  src.anim = src.anims[0] || null;
  if (!src.nodes) src.nodes = {};
  return src;
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
      const src = normaliseSrc(type, type === 'hearth' ? { static: [] } : (partsByType[type] || fallback(type)));
      for (const p of src.static) p.batch = batchGeometry(p);
      const b = { src, items: [], stat: [], anims: [], anim: null };
      for (const p of src.static) { const im = new THREE.InstancedMesh(p.geometry, p.material, CAP); im.count = 0; im.visible = false; im.frustumCulled = false; im.name = 'piece-' + type; scene.add(im); b.stat.push(im); }
      for (const a of src.anims) { const im = new THREE.InstancedMesh(a.geometry, a.material, CAP); im.count = 0; im.visible = false; im.frustumCulled = false; im.name = 'piece-anim-' + type; scene.add(im); b.anims.push(im); }
      b.anim = b.anims[0] || null;
      this.batches[type] = b;
    }
    // shared ghost
    this.ghostMat = new THREE.MeshBasicMaterial({ color: 0x6fdc8c, transparent: true, opacity: 0.42, depthWrite: false });
    this.ghost = new THREE.Group(); this.ghost.visible = false; scene.add(this.ghost);
    this._ghostType = null;
    this.floorTop = 0.2;
    const fs = partsByType.floor?.static?.[0]?.geometry;
    if (fs) { fs.computeBoundingBox(); this.floorTop = fs.boundingBox.max.y; }
    // surface heights (table / chest tops) for keepsakes
    this.surfaceTop = {};
    for (const t of ['table', 'chest']) {
      const b = this.batches[t], box = new THREE.Box3();
      for (const p of b.src.static) { p.geometry.computeBoundingBox(); box.union(p.geometry.boundingBox); }
      if (b.src.anim) { const g = b.src.anim.geometry; g.computeBoundingBox(); box.union(g.boundingBox.clone().translate(b.src.anim.pivot)); }
      this.surfaceTop[t] = box.isEmpty() ? 0.7 : box.max.y;
    }
    // M2 chunk B: surface spots per host, [lx, ly, lz] in the host's space (table.glb top_0..3, shelf_0..2)
    const tn = this.batches.table.src.nodes, tt = this.surfaceTop.table;
    this.spots = {
      table: [0, 1, 2, 3].map((k) => (tn[`top_${k}`] ? [tn[`top_${k}`].x, tn[`top_${k}`].y, tn[`top_${k}`].z] : [[-0.3, tt, -0.18], [0.3, tt, -0.18], [-0.3, tt, 0.18], [0.3, tt, 0.18]][k])),
      chest: [[-0.2, 0, 0], [0.2, 0, 0], [0, 0, -0.12], [0, 0, 0.12]].map(([x, , z]) => [x, this.surfaceTop.chest, z]),
      wooden_shelves: (() => { const sn = this.batches.wooden_shelves.src.nodes, out = [];
        for (let k = 0; k < 3; k++) { const v = sn[`shelf_${k}`] || new THREE.Vector3(0, 0.275 + k * 0.45, 0.16); out.push([-0.26, v.y, v.z], [0.26, v.y, v.z]); }
        return out; })(),
    };
    // idle static batch: per CONFIG.build.cluster-metre cell, one plain + one glow mesh for the big pieces
    // and one plain + one glow mesh for small decor (frustum culled by three; small decor and far cells are
    // distance-hidden in _cull).
    this.cells = new Map();
    // one material for the whole idle batch: Lambert, but vertices with glow = 1 skip lighting (what the old MeshBasic
    // glow mesh did) — so each cell is a single draw call instead of plain + glow
    this._plainMat = lambert(0xffffff, { vertexColors: true });
    this._plainMat.onBeforeCompile = (sh) => {
      sh.vertexShader = 'attribute float glow;\nvarying float vGlow;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvGlow = glow;');
      sh.fragmentShader = 'varying float vGlow;\n' + sh.fragmentShader.replace('#include <opaque_fragment>', 'outgoingLight = mix(outgoingLight, diffuseColor.rgb, vGlow);\n#include <opaque_fragment>');
    };
    this._plainMat.customProgramCacheKey = () => 'build-batch-glow';
    this._dirty = false; this._idle = 0; this.batched = false;
    this._enclosed = new Set(); this._encDirty = true;
    this.onChange = null; // (piece, added) => void
    this.time = 0;
  }

  // ---------------------------------------------------------------- mode + selection
  toggle() { this.active = !this.active; this.removeMode = false; this.ghost.visible = this.active; this.target = null; return this.active; }
  select(type) { if (PIECES[type]) { this.selected = type; this.removeMode = false; } }
  rotate() { if (PIECES[this.selected].slot === 'edge') this.flip = !this.flip; else this.rot = (this.rot + 1) % 4; }
  setRemove(on) { this.removeMode = on ?? !this.removeMode; this.target = null; return this.removeMode; }
  canAfford(inv, type = this.selected) { return Object.entries(PIECES[type].cost).every(([k, n]) => (inv[k] || 0) >= n); }
  /** Pack copy (crafted at the bench) or the resource cost. */
  canPlace(inv, type = this.selected) { return (inv[type] || 0) > 0 || this.canAfford(inv, type); }
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
  /** Roof-log is a 30° lean-to whose ridge is at local +Z (art note): turn it so the ridge sits on a supporting
   *  wall — the one farthest along the builder's view (the back wall), preferring a solid wall whose opposite
   *  edge is open or a door — and the logs run eave-to-ridge down to the open/door side. */
  _roofYaw(i, j, f) {
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]], opp = [1, 0, 3, 2], edges = this._cellEdges(i, j);
    let best = null, bs = -Infinity;
    edges.forEach(([a, b, sd], k) => {
      const w = this.slots.get(`edge:${a},${b},${sd}`); if (!w) return;
      const [oa, ob, os] = edges[opp[k]], o = this.slots.get(`edge:${oa},${ob},${os}`);
      const sc = (f ? f.x * dirs[k][0] + f.z * dirs[k][1] : 0) + (w.type === 'door' ? -0.6 : 0) + (!o || o.type === 'door' ? 0.3 : 0);
      if (sc > bs) { bs = sc; best = dirs[k]; }
    });
    return best ? Math.atan2(best[0], best[1]) : 0;
  }

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
      for (const [a, b, sd] of this._cellEdges(i, j)) { const w = this.slots.get(`edge:${a},${b},${sd}`); if (w && !FENCE.has(w.type)) { support = true; y = Math.max(y, w.y); } }
      y += H;
      const key = `roof:${i},${j}`;
      const ryaw = this._roofYaw(i, j, f) + this.rot * HALF; // ⟳ still turns it in 90° steps from there
      if (!support) { ok = false; why = 'A roof needs a wall under one edge'; }
      const smp = this.cave.sample(x, z, s);
      if (ok && smp.ceil < y + 0.5) { ok = false; why = 'The ceiling is too low here'; }
      if (ok && this.slots.has(key)) { ok = false; why = 'Something is already there'; }
      return { type, key, i, j, x, y, z, yaw: ryaw, ok, why };
    }
    if (def.slot === 'rug') {
      const y = (this._cellPiece(i, j, 'cell') ? this.cellBase(i, j) : this.cave.floorAt(x, z)) + 0.006;
      const key = `rug:${i},${j}`;
      if (this.cave.field(x, z) < 0.9) { ok = false; why = 'Too close to the cave wall'; }
      if (ok && this.slots.has(key)) { ok = false; why = 'There’s a rug here already'; }
      if (ok && this.blocked?.(x, z, 0.8)) { ok = false; why = 'A tree or rock is in the way'; }
      return { type, key, i, j, x, y, z, yaw, ok, why };
    }
    if (def.slot === 'hang') {
      const r = this._cellPiece(i, j, 'roof');
      const key = `hang:${i},${j}`;
      const y = r ? r.y - 0.04 : this.cave.floorAt(x, z) + H;
      if (!r) { ok = false; why = 'Hang it under a roof'; }
      if (ok && this.slots.has(key)) { ok = false; why = 'Something already hangs here'; }
      return { type, key, i, j, x, y, z, yaw, ok, why };
    }
    if (def.slot === 'surface') {
      // nearest table/chest in front of Cam with a free spot on top
      let host = null, hd = Infinity;
      const hx = P.x + f.x * 1.3, hz = P.z + f.z * 1.3;
      for (const q of this.pieces) {
        if (!this.spots[q.type]) continue;
        const d = Math.hypot(q.x - hx, q.z - hz) - (q.free = this.spots[q.type].some((_, n) => !this.slots.has(`surf:${q.id}:${n}`))) * 0.4;
        if (d < 1.6 && d < hd) { hd = d; host = q; }
      }
      if (!host) return { type, key: null, i, j, x: ax, y: this.cave.floorAt(ax, az), z: az, yaw, ok: false, why: 'Aim at a table, chest or shelf' };
      const spots = this.spots[host.type];
      const k = spots.findIndex((_, n) => !this.slots.has(`surf:${host.id}:${n}`));
      if (k < 0) return { type, key: null, i, j, x: host.x, y: host.y + (spots[0][1] || 0.7), z: host.z, yaw, ok: false, why: 'That top is full' };
      const [lx, ly, lz] = spots[k], c = Math.cos(host.yaw), sn = Math.sin(host.yaw);
      return { type, key: `surf:${host.id}:${k}`, parent: host.id, i: host.i, j: host.j, x: host.x + lx * c + lz * sn, y: host.y + ly + 0.002, z: host.z - lx * sn + lz * c, yaw: host.yaw + yaw, ok: true, why: '' };
    }
    if (def.slot === 'wallmount' || def.slot === 'shutter') {
      // the face of a placed wall (shelves, painting) / a window wall's opening (shutters) Cam is looking at
      const want = def.slot === 'shutter' ? 'window' : 'wall';
      const hx = P.x + f.x * 1.2, hz = P.z + f.z * 1.2;
      let host = null, hd = Infinity;
      for (const q of this.pieces) { if (q.type !== want) continue; const d = Math.hypot(q.x - hx, q.z - hz); if (d < 1.8 && d < hd) { hd = d; host = q; } }
      if (!host) return { type, key: null, i, j, x: ax, y: this.cave.floorAt(ax, az), z: az, yaw, ok: false, why: want === 'window' ? 'Aim at a window wall' : 'Aim at a wall' };
      const nx = Math.cos(host.yaw), nz = -Math.sin(host.yaw); // the wall's local +X (front)
      const sd = (P.x - host.x) * nx + (P.z - host.z) * nz >= 0 ? 1 : -1;
      const off = 0.13, y = host.y + (def.slot === 'shutter' ? 0.8 : type === 'painting' ? 1.15 : 0.45);
      const key = def.slot === 'shutter' ? `shut:${host.id}:${sd > 0 ? 1 : 0}` : `wm:${host.id}:${sd > 0 ? 1 : 0}`;
      ok = !this.slots.has(key); why = ok ? '' : 'Something hangs there already';
      if (ok && def.slot === 'shutter' && this.slots.has(`shut:${host.id}:${sd > 0 ? 0 : 1}`)) { ok = false; why = 'This window has shutters'; }
      return { type, key, parent: host.id, i: host.i, j: host.j, side: host.side, x: host.x + nx * sd * off, y, z: host.z + nz * sd * off, yaw: Math.atan2(nx * sd, nz * sd), ok, why };
    }
    if (def.slot === 'path') { // 1 m stepping-stone grid
      const pi = Math.round(ax), pj = Math.round(az), key = `path:${pi},${pj}`;
      const fl = this.heightAt(pi, pj), y = (Number.isFinite(fl) ? fl : this.cave.floorAt(pi, pj)) + 0.004;
      if (this.cave.field(pi, pj) < 0.5) { ok = false; why = 'Too close to the cave wall'; }
      if (ok && this.slots.has(key)) { ok = false; why = 'There’s a stone here already'; }
      if (ok && this.cave.lakeAt?.(pi, pj, 0.4)) { ok = false; why = 'Not in the water'; }
      return { type, key, i: Math.round(pi / G), j: Math.round(pj / G), x: pi, y, z: pj, yaw, ok, why };
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
      const s = d + (slot === 'cell' ? 0.7 : 0) + (slot === 'rug' ? 0.5 : 0) + (slot === 'roof' ? (up ? -0.8 : 1.2) : 0)
        + (slot === 'hang' ? (up ? -0.9 : 0.6) : 0) + (slot === 'edge' ? -0.1 : 0) + (slot === 'surface' ? -0.45 : 0)
        + (slot === 'wallmount' || slot === 'shutter' ? -0.3 : 0) + (slot === 'path' ? 0.5 : 0);
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
    for (const a of b.src.anims) add(a.geometry, new THREE.Matrix4().makeTranslation(a.pivot));
    this._ghostType = type;
  }

  update(player, dt = 0.016) {
    this._animate(dt, player.pos);
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
    if (PIECES[t.type].keepsake) this.ghost.scale.setScalar(1.6); // keepsakes are tiny
    this._affordable = this.canPlace(player.inventory);
    this.ghostMat.color.setHex(t.ok && this._affordable ? 0x6fdc8c : 0xff6a6a);
  }

  // ---------------------------------------------------------------- instances
  _write(p) {
    const b = this.batches[p.type];
    for (const im of b.stat) { im.setMatrixAt(p.index, p.matrix); im.instanceMatrix.needsUpdate = true; }
    if (b.anims.length) this._writeAnim(p);
  }
  _writeAnim(p) {
    const b = this.batches[p.type];
    b.src.anims.forEach((a, k) => {
      const piv = a.pivot;
      _m.copy(p.matrix).multiply(_m2.makeTranslation(piv.x, piv.y, piv.z));
      if (a.kind === 'hinge') _m.multiply(_m2.makeRotationAxis(_yAxis, p.open * a.angle * Math.PI / 180)); // door/gate −100°, shutters ∓100°
      else if (a.kind === 'chime') { // gentle draft sway
        const t = this.time + p.id * 1.7;
        _m.multiply(_m2.makeRotationAxis(_xAxis, Math.sin(t * 1.3) * 0.12)).multiply(_m2.makeRotationAxis(_zAxis, Math.sin(t * 0.9 + 1) * 0.1));
      } else if (a.kind === 'sway') { // bench ember lamp: ±5°
        const t = this.time + p.id * 1.3;
        _m.multiply(_m2.makeRotationAxis(_xAxis, Math.sin(t * 1.1) * 0.087)).multiply(_m2.makeRotationAxis(_zAxis, Math.sin(t * 0.8 + 2) * 0.06));
      } else if (a.kind === 'show') { if (!p.filled) _m.multiply(ZERO); }
      else _m.multiply(_m2.makeRotationAxis(_xAxis, p.open * a.angle * Math.PI / 180)); // lid_hinge X −75°
      b.anims[k].setMatrixAt(p.index, _m); b.anims[k].instanceMatrix.needsUpdate = true;
    });
  }
  _syncCount(type) {
    const b = this.batches[type];
    const n = b.items.length;
    b.stat.forEach((im, k) => { im.count = n; im.visible = n > 0 && !(this.batched && b.src.static[k].batch); }); // empty instanced meshes still cost a call
    for (const im of b.anims) { im.count = n; im.visible = n > 0; }
  }
  /** Something changed: show the live instanced meshes until the build has been idle for a moment. */
  _changed() {
    this._dirty = true; this._idle = 0; this._encDirty = true;
    if (this.batched) { this.batched = false; for (const m of this.batchMeshes()) m.visible = false; for (const t of PIECE_ORDER) this._syncCount(t); }
  }
  /** Merge every placed piece's static parts into per-cell batch meshes (rebuilt only when idle). */
  _rebuildBatch() {
    // greedy proximity clusters (seed = first piece, radius CONFIG.build.cluster) rather than a fixed grid, so a
    // base sitting on a grid line isn't split in four; the low tier also folds small decor into its cluster's mesh
    const CL = CONFIG.build.cluster || 12, groups = new Map(), seeds = [], split = !CONFIG.debug.low;
    for (const p of this.pieces) {
      let ci = -1, bd = CL;
      seeds.forEach((sd, i) => { const d = Math.hypot(sd[0] - p.x, sd[1] - p.z); if (d < bd) { bd = d; ci = i; } });
      if (ci < 0) { ci = seeds.length; seeds.push([p.x, p.z]); }
      const small = split && !!PIECES[p.type].small;
      const key = `c${ci}|${small ? 's' : 'b'}`;
      let gr = groups.get(key); if (!gr) groups.set(key, gr = { small, list: [] });
      for (const part of this.batches[p.type].src.static) {
        if (!part.batch) continue;
        const g = part.batch.geometry.clone().applyMatrix4(p.matrix);
        g.setAttribute('glow', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(part.batch.glow ? 1 : 0), 1));
        gr.list.push(g);
      }
    }
    for (const c of this.cells.values()) for (const m of c.meshes) { this.scene.remove(m); m.geometry.dispose(); }
    this.cells.clear();
    for (const [key, gr] of groups) {
      const meshes = [];
      if (gr.list.length) {
        const geo = mergeGeometries(gr.list); gr.list.forEach((g) => g.dispose());
        geo.computeBoundingSphere();
        const mesh = new THREE.Mesh(geo, this._plainMat);
        mesh.name = `build-batch-${key}`; mesh.matrixAutoUpdate = false; mesh.visible = true;
        this.scene.add(mesh); meshes.push(mesh);
      }
      if (meshes.length) this.cells.set(key, { small: gr.small, sphere: meshes[0].geometry.boundingSphere, meshes });
    }
    this._dirty = false; this.batched = true;
    for (const t of PIECE_ORDER) this._syncCount(t);
    this._cullT = 1;
  }
  /** Distance cull for the cell batches: small decor past smallCull, any cell past farCull (fog). */
  _cull(pos) {
    if (!pos || !this.batched) return;
    const sc = (CONFIG.build.smallCull || 25) * (this.cullScale || 1), fc = (CONFIG.build.farCull || 46) * (this.cullScale || 1);
    for (const c of this.cells.values()) {
      const d = Math.hypot(c.sphere.center.x - pos.x, c.sphere.center.z - pos.z) - c.sphere.radius;
      const vis = d < (c.small ? sc : fc);
      for (const m of c.meshes) m.visible = vis;
    }
  }
  batchMeshes() { return [...this.cells.values()].flatMap((c) => c.meshes); }
  /** Place the current ghost. Returns {ok, why?, piece?}. */
  place(inv) {
    const t = this.target;
    if (!t || t.remove) return { ok: false, why: 'Nothing to place' };
    if (!t.ok) return { ok: false, why: t.why || 'Can’t build there' };
    if (!this.canPlace(inv, t.type)) return { ok: false, why: `Needs ${this.costText(t.type)}` };
    const b = this.batches[t.type];
    if (b.items.length >= CAP) return { ok: false, why: 'That’s plenty of those' };
    // M2 chunk B: a crafted one in the pack goes first; otherwise base pieces are paid in resources
    const fi = (inv[t.type] || 0) > 0;
    if (fi) inv[t.type] -= 1; else for (const [k, n] of Object.entries(PIECES[t.type].cost)) inv[k] -= n;
    const p = this._add({ ...t, fi });
    return { ok: true, piece: p };
  }
  _add(t, id = ++this._id) {
    const b = this.batches[t.type];
    const p = { id, type: t.type, key: t.key, i: t.i, j: t.j, side: t.side, x: t.x, y: t.y, z: t.z, yaw: t.yaw, parent: t.parent ?? null, open: 0, openTarget: 0, colliders: [], fi: !!t.fi || !!PIECES[t.type].craft || !!PIECES[t.type].decor || !!PIECES[t.type].keepsake, filled: !!t.filled };
    p.matrix = new THREE.Matrix4().compose(_v.set(p.x, p.y, p.z), _q.setFromAxisAngle(_yAxis, p.yaw), _one);
    p.index = b.items.length; b.items.push(p); this._syncCount(t.type);
    this._write(p);
    this.pieces.push(p); this.slots.set(p.key, p);
    this._attach(p);
    this._changed();
    this.onChange?.(p, true);
    return p;
  }

  // ---------------------------------------------------------------- save / restore
  serialize() {
    return this.pieces.map((p) => ({ id: p.id, type: p.type, key: p.key, i: p.i, j: p.j, side: p.side, x: +p.x.toFixed(3), y: +p.y.toFixed(3), z: +p.z.toFixed(3), yaw: +p.yaw.toFixed(4),
      parent: p.parent, open: p.openTarget ? 1 : 0, store: p.store ? { ...p.store } : undefined, ...(p.type === 'roof' ? { ry: 1 } : {}),
      ...(p.fi && !PIECES[p.type].craft ? { fi: 1 } : {}), ...(p.filled ? { filled: 1 } : {}) }));
  }
  /** Re-create saved pieces (no cost). Unknown types are skipped. */
  restore(list = []) {
    for (const d of list) {
      if (!PIECES[d.type] || !d.key || this.slots.has(d.key)) continue;
      const p = this._add(d, d.id);
      this._id = Math.max(this._id, d.id || 0);
      if (d.open) { p.open = p.openTarget = 1; if (this.batches[p.type].anims.length) this._writeAnim(p); if (p.leaf) p.leaf.on = false; }
      if (p.store && d.store) Object.assign(p.store, d.store);
    }
    // saves from before the lean-to fix kept the raw 0/90/180/270° yaw (ridge over the door): re-seat those
    // roofs onto their back wall once everything (walls included) is restored
    for (const d of list) {
      if (d.type !== 'roof' || d.ry) continue;
      const p = this.slots.get(d.key); if (!p || p.type !== 'roof') continue;
      p.yaw = this._roofYaw(p.i, p.j, null);
      p.matrix.compose(_v.set(p.x, p.y, p.z), _q.setFromAxisAngle(_yAxis, p.yaw), _one); this._write(p); this._changed();
    }
  }
  clearAll() { for (const p of [...this.pieces]) if (this.pieces.includes(p)) this.remove({}, p, true); }

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
      case 'lakeside_bench': p.colliders.push(C.box(p.x, p.z, 0.25, 0.8, p.yaw + HALF)); break;
      case 'biscuit_bed': p.sleepPoint = new THREE.Vector3(p.x, p.y + 0.12, p.z); break; // sleep_point node
      case 'lantern': case 'lantern_double': {
        p.colliders.push(C.circle(p.x, p.z, 0.15));
        // single lamp = lantern_L (-0.38 m along local X); the double glows between both
        const off = p.type === 'lantern' ? -0.38 : 0;
        p.glowPos = new THREE.Vector3(p.x + Math.cos(p.yaw) * off, p.y + 1.55, p.z - Math.sin(p.yaw) * off);
        p.emitter = this.budget?.add(new Emitter({ color: 0xffb35c, intensity: 3.0, distance: 6, decay: 2, priority: 1 }));
        if (p.emitter) p.emitter.pos.copy(p.glowPos);
        break;
      }
      case 'hearth': p.fire = this.fires.build(new THREE.Vector3(p.x, p.y, p.z), 0); p.fire.hearth = true; break;
      // M2 chunk B
      case 'crafting_bench': p.colliders.push(C.box(p.x, p.z, 0.8, 0.4, p.yaw)); p.usePoint = this._local(p, 0, 0, 0.85); break;
      case 'bookshelf': { const c = this._local(p, 0, 0, -0.72); p.colliders.push(C.box(c.x, c.z, 0.51, 0.18, p.yaw)); break; }
      case 'armchair': p.colliders.push(C.circle(p.x, p.z, 0.38)); p.sitPoint = this._local(p, ...this._node(p, 'sit_point', [0, 0.46, 0.08])); break;
      case 'cooking_pot': p.colliders.push(C.circle(p.x, p.z, 0.3)); break;
      case 'dog_bowl': p.eatPoint = this._local(p, ...this._node(p, 'eat_point', [0, 0, 0.32])); break;
      case 'fence': p.colliders.push(C.box(p.x, p.z, 0.08, G / 2, p.yaw)); break;
      case 'fence_gate': {
        const s = Math.sin(p.yaw), c = Math.cos(p.yaw);
        for (const lz of [-0.92, 0.92]) p.colliders.push(C.box(p.x + lz * s, p.z + lz * c, 0.08, 0.08, p.yaw));
        p.leaf = C.box(p.x, p.z, 0.06, 0.82, p.yaw); p.colliders.push(p.leaf);
        break;
      }
      case 'torch': case 'stained_crystal_lamp': case 'ember_lamp': {
        if (p.type !== 'ember_lamp') p.colliders.push(C.circle(p.x, p.z, 0.14));
        const L = { torch: [0xff9a3c, 2.6, 6, 1.35], stained_crystal_lamp: [0xb98cff, 2, 4, 0.7], ember_lamp: [0xff9a3c, 2, 5, 0.2] }[p.type];
        p.glowPos = new THREE.Vector3(p.x, p.y + L[3], p.z);
        p.emitter = this.budget?.add(new Emitter({ color: L[0], intensity: L[1], distance: L[2], decay: 2, priority: p.type === 'torch' ? 1 : 0.9 }));
        if (p.emitter) p.emitter.pos.copy(p.glowPos);
        break;
      }
      default: break;
    }
  }

  /** Piece-local (x, y, z) → world. */
  _local(p, x, y, z) { const c = Math.cos(p.yaw), s = Math.sin(p.yaw); return new THREE.Vector3(p.x + x * c + z * s, p.y + y, p.z - x * s + z * c); }
  _node(p, name, def) { const v = this.batches[p.type].src.nodes[name]; return v ? [v.x, v.y, v.z] : def; }
  /** Remove the targeted piece (remove mode) with a full refund. Returns {ok, why?, refund?, piece?, contents?}. */
  remove(inv, piece = this.target?.remove, force = false) {
    if (!piece) return { ok: false, why: 'Aim at a piece to remove' };
    const slot = PIECES[piece.type].slot;
    if (!force && slot === 'cell' && (this._cellPiece(piece.i, piece.j, 'prop') || this._cellPiece(piece.i, piece.j, 'roof') || this._cellPiece(piece.i, piece.j, 'rug'))) return { ok: false, why: 'Clear what’s on this floor first' };
    if (!force && slot === 'roof' && this._cellPiece(piece.i, piece.j, 'hang')) return { ok: false, why: 'Take down what hangs here first' };
    if (slot === 'edge' && !force) {
      // a roof must keep at least one supporting wall
      for (const [a, b] of this._edgeCells(piece.i, piece.j, piece.side)) {
        const r = this._cellPiece(a, b, 'roof'); if (!r) continue;
        const others = this._cellEdges(a, b).filter(([x, y, s]) => { const w = this.slots.get(`edge:${x},${y},${s}`); return w && w !== piece; });
        if (!others.length) return { ok: false, why: 'That wall is holding up a roof' };
      }
    }
    const own = piece.fi ? { [piece.type]: 1 } : PIECES[piece.type].cost; // crafted → back to the pack
    const refund = { ...own };
    // keepsakes on a table/chest top come back with it
    for (const q of this.pieces.filter((q) => q.parent === piece.id)) { const r = this.remove(inv, q, true); for (const [k, n] of Object.entries(r.refund || {})) refund[k] = (refund[k] || 0) + n; }
    for (const [k, n] of Object.entries(own)) inv[k] = (inv[k] || 0) + n;
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
    for (const im of b.anims) im.setMatrixAt(b.items.length, ZERO);
    this._syncCount(piece.type);
    this.pieces = this.pieces.filter((p) => p !== piece); this.slots.delete(piece.key);
    if (this.target?.remove === piece) this.target = null;
    this._changed();
    this.onChange?.(piece, false);
    return { ok: true, refund, piece, contents };
  }

  // ---------------------------------------------------------------- doors + chests
  /** Nearest door/chest Cam can use (outside build mode). */
  findInteractable(pos, forward, reach = 2.1) {
    let best = null, bs = Infinity;
    for (const p of this.pieces) {
      if (!INTERACT.has(p.type)) continue; // chunk C: bed roll → sleep
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
      if (!INTERACT.has(p.type)) continue;
      const d = Math.hypot(p.x - pos.x, p.z - pos.z);
      if (d > 3) continue;
      _v.set(p.x, p.y + (TAP_Y[p.type] ?? 0.35), p.z).project(camera);
      if (_v.z > 1) continue;
      const e = Math.hypot((_v.x + 1) / 2 * window.innerWidth - x, (1 - _v.y) / 2 * window.innerHeight - y);
      if (e < 130 / Math.max(1, d) && e < bd) { bd = e; best = p; }
    }
    return best;
  }
  setFilled(p, on) { p.filled = !!on; this._writeAnim(p); }
  toggleDoor(p) { p.openTarget = p.openTarget ? 0 : 1; return !!p.openTarget; }
  setChestOpen(p, on) { p.openTarget = on ? 1 : 0; }

  _animate(dt, pos) {
    this.time += dt;
    if (this._dirty && (this._idle += dt) > 0.6) this._rebuildBatch();
    if (pos && (this._cullT -= dt) <= 0) { this._cullT = 0.25; this._cull(pos); }
    for (const t of ['crystal_wind_chime', 'crafting_bench']) {
      const b = this.batches[t];
      if (b?.anims.length && b.items.length) for (const p of b.items) if (!pos || Math.hypot(p.x - pos.x, p.z - pos.z) < 20) this._writeAnim(p);
    }
    for (const p of this.pieces) {
      if (p.open === p.openTarget || !OPENS.has(p.type)) continue;
      const step = dt * (p.type === 'chest' ? 3.2 : 2.6);
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
  /** Enclosed floor cells: connected floor tiles whose every outer edge is a wall/window/door, with at
   * least one door and a roof over every tile. Cached until something changes. */
  enclosedCells() {
    if (!this._encDirty) return this._enclosed;
    const out = new Set(), seen = new Set();
    for (const f of this.pieces) {
      if (f.type !== 'floor' || seen.has(`${f.i},${f.j}`)) continue;
      const comp = [], stack = [[f.i, f.j]]; let leak = false, door = false;
      seen.add(`${f.i},${f.j}`);
      while (stack.length) {
        const [i, j] = stack.pop(); comp.push(`${i},${j}`);
        if (!this._cellPiece(i, j, 'roof')) leak = true;
        for (const [a, b, sd] of this._cellEdges(i, j)) {
          const e = this.slots.get(`edge:${a},${b},${sd}`);
          if (e && FENCE.has(e.type)) { leak = true; continue; } // a fence isn't a wall
          if (e) { if (e.type === 'door') door = true; continue; }
          const [[c1, d1], [c2, d2]] = this._edgeCells(a, b, sd);
          const [ni, nj] = c1 === i && d1 === j ? [c2, d2] : [c1, d1];
          if (!this._cellPiece(ni, nj, 'cell')) { leak = true; continue; }
          const k = `${ni},${nj}`; if (!seen.has(k)) { seen.add(k); stack.push([ni, nj]); }
        }
      }
      if (!leak && door) for (const k of comp) out.add(k);
    }
    this._enclosed = out; this._encDirty = false;
    return out;
  }
  // Chunk C: rain masking / rain-on-roof / warmth. A roof piece's y is already the wall top.
  /** True when a roof tile covers (x,z) — open-sided lean-tos count (rain, not warmth). */
  underRoof(pos) {
    for (const p of this.pieces) if (p.type === 'roof' && Math.abs(p.x - pos.x) <= G / 2 && Math.abs(p.z - pos.z) <= G / 2) return true;
    return false;
  }
  /** Roof rects for the rain shader: [{x, z, top}] (G-sized squares). */
  roofs() { return this.pieces.filter((p) => p.type === 'roof').map((p) => ({ x: p.x, z: p.z, top: p.y + 1.2 })); }
  inShelter(pos) { return this.enclosedCells().has(`${Math.round(pos.x / G)},${Math.round(pos.z / G)}`); }
  find(type) { return this.pieces.find((p) => p.type === type) || null; }
  summary() {
    if (!this.pieces.length) return 'none';
    return Object.entries(this.counts()).map(([k, n]) => `${PIECES[k].name.toLowerCase()} x${n}`).join(', ');
  }
}
