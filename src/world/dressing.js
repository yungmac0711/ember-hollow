// Art-director cave dressing (M0 art pass): crystal clusters, moss and torches, placed per chamber.
//
// Placement follows LORE.md:
//  • Torches only near the entrance. Wren's family were Lanternmouth's lamplighters and still keep
//    the first stretch lit: 2 standing torches flank the Lanternmouth → Flintseam path, and lit wall
//    torches line the first part of the tunnels out of Lanternmouth. Deeper in, the Keepers' old
//    sconces are cold and dark ("the waylamps went out, one after another"), so a few unlit wall
//    torches (no flame) sit in the deep tunnels.
//  • Crystals ("veins of humming crystal") are densest on Flintseam Ridge's walls, with a few in the
//    Glowcap Galleries, Mossdrip Grotto and around the Hushing Pools. They hum (brighten) while a
//    fire burns.
//  • Moss lives "where the air is damp": Mossdrip Grotto, the Glowcap Galleries and the Hushing
//    Pools, plus caps on the boulders there; only a little at the dry entrance.
//
// Perf: all static meshes are merged per material (one draw call per material for the whole cave),
// torch flames are 2 InstancedMeshes per torch type with per-instance flicker, and every torch's
// glow halo is one additive Points draw. Torch *lights* are LightBudget emitters (priority 1), so
// only the nearest torch borrows a real PointLight when the fire/lantern don't need the slot.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CONFIG } from '../config.js';
import { mulberry32 } from './noise.js';
import { Emitter } from '../render/lights.js';

const UP = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _v = new THREE.Vector3();

/** Collects transformed copies of GLB parts and merges them per material name. */
class Batch {
  constructor() { this.byMat = new Map(); }
  add(parts, matrix, filter = null) {
    for (const part of parts) {
      if (filter && !filter(part)) continue;
      const key = part.material.name || part.material.uuid;
      if (!this.byMat.has(key)) this.byMat.set(key, { material: part.material, geos: [] });
      let g = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry.clone();
      for (const a of Object.keys(g.attributes)) if (a !== 'position' && a !== 'normal') g.deleteAttribute(a);
      g.applyMatrix4(matrix);
      this.byMat.get(key).geos.push(g);
    }
  }
  build(group, name) {
    const meshes = {};
    for (const [key, { material, geos }] of this.byMat) {
      const merged = mergeGeometries(geos, false);
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, material);
      mesh.name = `${name}:${key}`;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
      meshes[key] = mesh;
      for (const g of geos) g.dispose();
    }
    return meshes;
  }
}

function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,200,140,1)'); grd.addColorStop(0.25, 'rgba(255,150,70,0.55)');
  grd.addColorStop(0.6, 'rgba(255,110,40,0.12)'); grd.addColorStop(1, 'rgba(255,90,30,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Point near the cave wall in a chamber (field between minF and maxF). */
function wallPoints(cave, rng, count, chamber, minF = 0.05, maxF = 0.9, minGap = 0.9) {
  const pts = [];
  let guard = 0;
  while (pts.length < count && guard++ < count * 120) {
    const p = cave.randomPoint(rng, minF, maxF, chamber);
    if (!p) continue;
    if (pts.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < minGap)) continue;
    pts.push(p);
  }
  return pts;
}

/** Matrix for a prop standing on the floor at p, leaning `lean` rad away from the nearest wall. */
function standMatrix(cave, p, scale, lean, yaw, sink = 0.04) {
  const g = cave.gradient(p.x, p.z);
  const len = Math.hypot(g.x, g.y) || 1;
  _v.set(g.x / len * Math.sin(lean), Math.cos(lean), g.y / len * Math.sin(lean));
  _q.setFromUnitVectors(UP, _v);
  _q2.setFromAxisAngle(UP, yaw);
  _q.multiply(_q2);
  return new THREE.Matrix4().compose(_p.set(p.x, cave.floorAt(p.x, p.z) - sink * scale, p.z), _q, _s.setScalar(scale));
}

/**
 * Find a wall-torch mount on tunnel `t` at fraction `u`, on side `side` (±1). Returns
 * { pos, yaw } or null. The torch's back plate (z=0) goes against the rock; it faces the
 * tunnel's centre.
 */
function wallMount(cave, t, u, side) {
  const ax = t.a.x, az = t.a.z, dx = t.b.x - ax, dz = t.b.z - az;
  const L = Math.hypot(dx, dz), tx = dx / L, tz = dz / L, nx = -tz * side, nz = tx * side;
  // local tunnel centre: the noise warps it, so search across for the most open point
  let cx = ax + dx * u, cz = az + dz * u, best = -1e9, bo = 0;
  for (let o = -3; o <= 3; o += 0.25) { const f = cave.field(cx + nx * o, cz + nz * o); if (f > best) { best = f; bo = o; } }
  if (best < 0.8) return null;
  cx += nx * bo; cz += nz * bo;
  const floorC = cave.floorAt(cx, cz);
  // tunnels are low (≈3.5 m at the crown, walls curve straight into the roof), so the torch sits
  // with its flame ≈1.5 m above the path; the back plate touches the rock about halfway up
  const mountY = floorC + 0.75;
  const s = {};
  for (let o = 0.3; o < 6; o += 0.05) {
    cave.sample(cx + nx * o, cz + nz * o, s);
    if (s.floor >= mountY + 0.45) {
      const b = Math.max(0.2, o - 0.06);
      const x = cx + nx * b, z = cz + nz * b;
      cave.sample(cx + nx * (b - 0.4), cz + nz * (b - 0.4), s); // headroom over the flame
      if (s.ceil < mountY + 1.0) return null;
      return { pos: new THREE.Vector3(x, mountY, z), yaw: Math.atan2(-nx, -nz) };
    }
  }
  return null;
}

export function buildDressing(scene, cave, seed, src, budget, { boulders = [] } = {}) {
  const rng = mulberry32(seed * 13 + 5);
  const group = new THREE.Group();
  group.name = 'dressing';
  const [lanternmouth, flintseam, glowcap, mossdrip, hushing] = cave.chambers;
  const crystalPts = [];
  const crystalLights = [];

  // ------------------------------------------------------------------ crystals
  const crystals = (src.crystals || []).filter(Boolean);
  const crysBatch = new Batch();
  if (crystals.length) {
    const plan = [[flintseam, 14, 0.75, 1.6], [glowcap, 4, 0.6, 1.0], [mossdrip, 3, 0.55, 0.9], [hushing, 5, 0.6, 1.1], [lanternmouth, 1, 0.5, 0.7]];
    for (const [ch, n, smin, smax] of plan) {
      const pts = wallPoints(cave, rng, n, ch, 0.0, ch === flintseam ? 0.9 : 0.6, ch === flintseam ? 1.1 : 1.6);
      for (const p of pts) {
        const sc = smin + rng() * (smax - smin);
        const parts = crystals[(rng() * crystals.length) | 0];
        const m = standMatrix(cave, p, sc, 0.15 + rng() * 0.35, rng() * 6.28, 0.08);
        crysBatch.add(parts, m);
        crystalPts.push(p);
        // the art's optional crystal light (#B98CFF 0.8/3): only for the big clusters, as the
        // lowest-priority emitter, so it only borrows a slot nobody warmer needs (deep chambers)
        const L = parts.extras?.pointLight;
        if (L && sc > 1.1) {
          const e = new Emitter({ color: L.color, intensity: L.intensity * sc, distance: L.distance * sc, decay: 2, priority: 0.5 });
          e.pos.fromArray(L.offset || [0, 0.3, 0]).applyMatrix4(m);
          budget?.add(e);
          crystalLights.push({ e, base: e.intensity });
        }
      }
    }
  }
  const crysMeshes = crysBatch.build(group, 'crystals');
  const humMats = Object.values(crysMeshes).map((m) => m.material).filter((m) => m.emissive && m.emissive.getHex() !== 0);
  const humBase = humMats.map((m) => m.emissiveIntensity);

  // ------------------------------------------------------------------ moss
  const clumps = (src.mossClumps || []).filter(Boolean), caps = (src.mossCaps || []).filter(Boolean);
  const mossBatch = new Batch();
  if (clumps.length) {
    const plan = [[mossdrip, 14], [glowcap, 12], [hushing, 8], [lanternmouth, 3]];
    for (const [ch, n] of plan) {
      for (const p of wallPoints(cave, rng, n, ch, 0.1, 1.4, 0.7)) {
        mossBatch.add(clumps[(rng() * clumps.length) | 0], standMatrix(cave, p, 0.9 + rng() * 0.9, 0.1 + rng() * 0.25, rng() * 6.28, 0.2));
      }
    }
    // a few in the damp tunnels (Mossdrip ↔ Glowcap and Lanternmouth ↔ Mossdrip)
    for (const t of cave.tunnels.filter((t) => t.a === mossdrip || t.b === mossdrip)) {
      for (let i = 0; i < 4; i++) {
        const u = 0.2 + rng() * 0.6;
        const p = new THREE.Vector3(t.a.x + (t.b.x - t.a.x) * u, 0, t.a.z + (t.b.z - t.a.z) * u);
        cave.resolve(p, 0.3);
        if (cave.field(p.x, p.z) > 1.2) continue;
        mossBatch.add(clumps[(rng() * clumps.length) | 0], standMatrix(cave, p, 0.8 + rng() * 0.6, 0.2, rng() * 6.28, 0.2));
      }
    }
  }
  if (caps.length) {
    // caps on boulders in the damp chambers (boulders come from decor: {x,y,z,sc,sy,height})
    const damp = [mossdrip, glowcap, hushing];
    for (const b of boulders) {
      const ch = cave.chamberAt ? cave.chamberAt(b.x, b.z) : null;
      const isDamp = ch ? damp.includes(ch) : damp.some((c) => Math.hypot(b.x - c.x, b.z - c.z) < c.r);
      if (!isDamp || rng() < 0.25) continue;
      _q.setFromAxisAngle(UP, b.yaw + rng() * 0.6);
      const m = new THREE.Matrix4().compose(_p.set(b.x, b.top - 0.06 * b.sc, b.z), _q, _s.set(b.sc * 0.6, b.sc * 0.8, b.sc * 0.6));
      mossBatch.add(caps[(rng() * caps.length) | 0], m);
    }
  }
  mossBatch.build(group, 'moss');

  // ------------------------------------------------------------------ torches
  const torches = [];
  const bodyBatch = new Batch();
  const isFlame = (part) => part.node === 'flame';
  const addTorch = (parts, pos, yaw, lit) => {
    const m = new THREE.Matrix4().compose(pos, _q.setFromAxisAngle(UP, yaw), _s.setScalar(1));
    bodyBatch.add(parts, m, (p) => !isFlame(p));
    if (!lit) return;
    const L = parts.extras?.pointLight || { color: '#FF9A3C', intensity: 3, distance: 6, offset: [0, 0.6, 0] };
    const lightPos = new THREE.Vector3().fromArray(L.offset || [0, 0.6, 0]).applyMatrix4(m);
    const e = new Emitter({ color: L.color, intensity: 0, distance: L.distance, decay: L.decay ?? 2, priority: 1 });
    e.pos.copy(lightPos);
    budget?.add(e);
    torches.push({ parts, matrix: m, lightPos, emitter: e, base: L.intensity * CONFIG.torches.lightScale, ph: rng() * 100 });
  };

  const tw = src.torchWall, ts = src.torchStanding;
  if (ts) {
    // two standing torches flanking the path from Lanternmouth toward Flintseam
    const dx = flintseam.x - lanternmouth.x, dz = flintseam.z - lanternmouth.z, L = Math.hypot(dx, dz);
    const fx = dx / L, fz = dz / L;
    for (const side of [-1, 1]) {
      const p = new THREE.Vector3(lanternmouth.x + fx * 5.2 - fz * side * 1.9, 0, lanternmouth.z + fz * 5.2 + fx * side * 1.9);
      cave.resolve(p, 1.0);
      p.y = cave.floorAt(p.x, p.z) - 0.02;
      addTorch(ts, p, rng() * 6.28, true);
    }
  }
  if (tw) {
    const T = (a, b) => cave.tunnels.find((t) => (t.a === a && t.b === b) || (t.a === b && t.b === a));
    const along = (t, from, u) => (t.a === from ? u : 1 - u);
    const lit = [[flintseam, [0.35, 0.65]], [glowcap, [0.3, 0.55, 0.8]], [hushing, [0.5]]];
    for (const [to, us] of lit) {
      const t = T(lanternmouth, to); if (!t) continue;
      us.forEach((u, i) => {
        const mnt = wallMount(cave, t, along(t, lanternmouth, u), i % 2 ? 1 : -1) || wallMount(cave, t, along(t, lanternmouth, u), i % 2 ? -1 : 1);
        if (mnt) addTorch(tw, mnt.pos, mnt.yaw, true);
      });
    }
    // the Keepers' cold sconces, deeper in
    const cold = [[T(flintseam, glowcap), [0.4]], [T(mossdrip, glowcap), [0.5]], [T(lanternmouth, mossdrip), [0.75]]];
    for (const [t, us] of cold) {
      if (!t) continue;
      for (const u of us) { const mnt = wallMount(cave, t, u, 1) || wallMount(cave, t, u, -1); if (mnt) addTorch(tw, mnt.pos, mnt.yaw, false); }
    }
  }
  bodyBatch.build(group, 'torches');

  // flames: per torch type, one InstancedMesh per flame material; flicker = per-instance scale
  const flameSets = [];
  for (const parts of [tw, ts]) {
    if (!parts) continue;
    const list = torches.filter((t) => t.parts === parts);
    if (!list.length) continue;
    for (const part of parts.filter(isFlame)) {
      // flames are modelled in place on the torch; pivot them about their base for the flicker
      part.geometry.computeBoundingBox();
      const bb = part.geometry.boundingBox;
      const pivot = new THREE.Vector3((bb.min.x + bb.max.x) / 2, bb.min.y, (bb.min.z + bb.max.z) / 2);
      const geo = part.geometry.clone().translate(-pivot.x, -pivot.y, -pivot.z);
      const mat = part.material; mat.fog = true;
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      im.frustumCulled = false;
      group.add(im);
      flameSets.push({ im, list, pivot });
    }
  }

  // glow halos: one additive Points draw for every lit torch (fakes far lights)
  let glow = null;
  if (torches.length) {
    const pos = new Float32Array(torches.length * 3), col = new Float32Array(torches.length * 3);
    torches.forEach((t, i) => pos.set([t.lightPos.x, t.lightPos.y + 0.05, t.lightPos.z], i * 3));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    glow = new THREE.Points(g, new THREE.PointsMaterial({
      size: 1.6, map: glowTexture(), vertexColors: true, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, sizeAttenuation: true }));
    glow.frustumCulled = false;
    glow.renderOrder = 2;
    group.add(glow);
  }

  scene.add(group);
  let time = 0, hum = 0;
  const _fm = new THREE.Matrix4(), _sm = new THREE.Matrix4(), _fp = new THREE.Vector3(), _fs = new THREE.Vector3();
  return {
    group,
    crystals: crystalPts,
    torches,
    crystalLights,
    update(dt, { anyFireLit = false } = {}) {
      time += dt;
      // crystals hum (brighten + slow pulse) while a fire burns
      hum += ((anyFireLit ? 1 : 0) - hum) * Math.min(1, dt * 0.6);
      const humK = 1 + hum * (0.3 + Math.sin(time * 1.3) * 0.06);
      humMats.forEach((m, i) => { m.emissiveIntensity = humBase[i] * humK; });
      for (const c of crystalLights) c.e.intensity = c.base * humK;
      // torch flicker: shared by the flame scale, the glow sprite and the light emitter
      const col = glow?.geometry.attributes.color;
      torches.forEach((t, i) => {
        const fl = 0.86 + Math.sin(time * 9.1 + t.ph) * 0.06 + Math.sin(time * 23.7 + t.ph * 2) * 0.04 + Math.sin(time * 3.3 + t.ph) * 0.04;
        t.flicker = fl;
        t.emitter.intensity = t.base * fl;
        if (col) col.setXYZ(i, 0.55 * fl, 0.32 * fl, 0.14 * fl);
      });
      if (col) col.needsUpdate = true;
      for (const fs of flameSets) {
        fs.list.forEach((t, i) => {
          const f = t.flicker ?? 1;
          _fp.copy(fs.pivot).applyMatrix4(t.matrix);
          _fm.copy(t.matrix).setPosition(_fp);
          _fm.multiply(_sm.makeScale(0.9 + f * 0.12, 0.75 + f * 0.3, 0.9 + f * 0.12));
          fs.im.setMatrixAt(i, _fm);
        });
        fs.im.instanceMatrix.needsUpdate = true;
      }
    },
  };
}
