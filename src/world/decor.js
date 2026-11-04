// Cave dressing: glowing mushrooms, crystals, stalactites, a still pool and drifting spores.
// All instanced (one draw call per kind) and unlit/emissive so they glow without extra lights.
import * as THREE from 'three';
import { mulberry32 } from './noise.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _e = new THREE.Euler();

function scatter(cave, rng, count, { minF, maxF, chamber = null, chance = null }) {
  const pts = [];
  let guard = 0;
  while (pts.length < count && guard++ < count * 60) {
    const p = cave.randomPoint(rng, minF, maxF, chamber);
    if (p && (!chance || chance(p))) pts.push(p);
  }
  return pts;
}

export function buildDecor(scene, cave, seed = 1, sources = {}) {
  const rng = mulberry32(seed * 7 + 3);
  const group = new THREE.Group();
  const [hearth, grotto, glade, rootfall, pool] = cave.chambers;
  const s = {};

  // --- Glowing mushrooms (stem + cap instanced) -----------------------------------------
  const mushPts = [
    ...scatter(cave, rng, 70, { minF: 0.2, maxF: 1.6, chamber: glade }),
    ...scatter(cave, rng, 40, { minF: 0.2, maxF: 1.3 }),
    ...scatter(cave, rng, 8, { minF: 0.3, maxF: 1.5, chamber: hearth }),
  ];
  const stemGeo = new THREE.CylinderGeometry(0.03, 0.045, 1, 5); stemGeo.translate(0, 0.5, 0);
  const capGeo = new THREE.SphereGeometry(1, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2);
  const stems = new THREE.InstancedMesh(stemGeo, new THREE.MeshBasicMaterial({ color: 0x8fb5b0 }), mushPts.length);
  const caps = new THREE.InstancedMesh(capGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), mushPts.length);
  const capCol = new THREE.Color();
  const palette = [0x7fe3ff, 0x6fd0f0, 0x9fefff, 0x7fffd0]; // Glowcap Cyan family
  mushPts.forEach((p, i) => {
    const h = 0.12 + rng() * 0.35, r = 0.07 + rng() * 0.14;
    _q.setFromEuler(_e.set((rng() - 0.5) * 0.4, rng() * 6.28, (rng() - 0.5) * 0.4));
    _m.compose(_p.set(p.x, cave.floorAt(p.x, p.z) - 0.02, p.z), _q, _s.set(1, h, 1)); stems.setMatrixAt(i, _m);
    _p.y += h;
    _m.compose(_p, _q, _s.set(r, r * 0.6, r)); caps.setMatrixAt(i, _m);
    caps.setColorAt(i, capCol.setHex(palette[(rng() * palette.length) | 0]));
  });
  group.add(stems, caps);

  // --- Crystals ----------------------------------------------------------------------------
  // (procedural octahedron fallback; skipped when the art-director crystal GLBs are dressed in)
  const crysPts = sources.skipCrystals ? [] : [
    ...scatter(cave, rng, 55, { minF: -0.2, maxF: 1.4, chamber: grotto }),
    ...scatter(cave, rng, 14, { minF: -0.1, maxF: 1.0 }),
  ];
  const crysGeo = new THREE.OctahedronGeometry(1, 0); crysGeo.translate(0, 0.6, 0);
  const crystals = new THREE.InstancedMesh(crysGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), crysPts.length);
  const cpal = [0x8a5cd6, 0xb98cff, 0x9a6ce6, 0x7a4cc6]; // Amethyst
  crysPts.forEach((p, i) => {
    const sz = 0.15 + rng() * 0.45;
    _q.setFromEuler(_e.set((rng() - 0.5) * 0.9, rng() * 6.28, (rng() - 0.5) * 0.9));
    _m.compose(_p.set(p.x, cave.floorAt(p.x, p.z) - 0.1, p.z), _q, _s.set(sz * 0.35, sz * 1.4, sz * 0.35));
    crystals.setMatrixAt(i, _m);
    crystals.setColorAt(i, capCol.setHex(cpal[(rng() * cpal.length) | 0]).multiplyScalar(0.75 + rng() * 0.35));
  });
  if (crysPts.length) group.add(crystals);

  // --- Stalactites & stalagmites -----------------------------------------------------------
  const tites = scatter(cave, rng, 120, { minF: 0.4, maxF: 6 });
  const mites = scatter(cave, rng, 50, { minF: -0.1, maxF: 0.7 });
  const coneGeo = new THREE.ConeGeometry(1, 1, 5); coneGeo.translate(0, -0.5, 0); // tip at y=-1
  const rockMat = new THREE.MeshLambertMaterial({ color: 0x3e4a57, flatShading: true });
  const cones = new THREE.InstancedMesh(coneGeo, rockMat, tites.length + mites.length);
  let ci = 0;
  for (const p of tites) {
    cave.sample(p.x, p.z, s);
    const len = Math.min(0.4 + rng() * 1.6, (s.ceil - s.floor) * 0.35);
    _q.identity();
    _m.compose(_p.set(p.x, s.ceil + 0.1, p.z), _q, _s.set(0.12 + rng() * 0.18, len, 0.12 + rng() * 0.18));
    cones.setMatrixAt(ci++, _m);
  }
  for (const p of mites) {
    cave.sample(p.x, p.z, s);
    const len = 0.3 + rng() * 1.1;
    _q.setFromEuler(_e.set(Math.PI, rng() * 6, 0));
    _m.compose(_p.set(p.x, s.floor - 0.05, p.z), _q, _s.set(0.15 + rng() * 0.2, len, 0.15 + rng() * 0.2));
    cones.setMatrixAt(ci++, _m);
  }
  group.add(cones);

  // --- Still pool --------------------------------------------------------------------------
  const water = new THREE.Mesh(
    new THREE.CircleGeometry(4.2, 24),
    new THREE.MeshLambertMaterial({ color: 0x0d2a44, emissive: 0x06182c, transparent: true, opacity: 0.82, depthWrite: false }));
  water.rotation.x = -Math.PI / 2;
  water.position.set(pool.x, pool.elev - 0.35, pool.z);
  water.renderOrder = 1;
  group.add(water);

  // --- Drifting spores / motes (Points, animated in update) ---------------------------------
  const moteCount = 90;
  const motePos = new Float32Array(moteCount * 3);
  const moteBase = [];
  for (let i = 0; i < moteCount; i++) {
    const ch = i < 50 ? glade : i < 75 ? grotto : hearth;
    const p = cave.randomPoint(rng, 1, 99, ch) || new THREE.Vector3();
    cave.sample(p.x, p.z, s);
    const y = s.floor + 0.4 + rng() * Math.max(0.5, (s.ceil - s.floor) * 0.6);
    moteBase.push({ x: p.x, y, z: p.z, ph: rng() * 6.28, sp: 0.2 + rng() * 0.4 });
    motePos.set([p.x, y, p.z], i * 3);
  }
  const moteGeo = new THREE.BufferGeometry();
  moteGeo.setAttribute('position', new THREE.BufferAttribute(motePos, 3));
  const motes = new THREE.Points(moteGeo, new THREE.PointsMaterial({
    color: 0x9fffe0, size: 0.07, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
  motes.frustumCulled = false;
  group.add(motes);

  // Kenney rock GLBs (instanced) as boulders + stalagmite pillars, recoloured to the style palette.
  const rockSets = [
    [sources.boulder, scatter(cave, rng, 45, { minF: 0.0, maxF: 1.1 }), 0.9, 2.2],
    [sources.pillar, scatter(cave, rng, 30, { minF: -0.2, maxF: 0.6 }), 0.8, 2.4],
  ];
  const boulders = []; // placements (for moss caps): {x, z, top, sc, yaw}
  for (const [src, pts, smin, smax] of rockSets) {
    if (!src) continue;
    // one transform per placement, shared by all of the model's parts
    const xf = pts.map((p) => {
      const sc = smin + rng() * (smax - smin), sy = sc * (0.8 + rng() * 0.6), yaw = rng() * 6.28;
      const y = cave.floorAt(p.x, p.z) - 0.1 * sc;
      if (src === sources.boulder) boulders.push({ x: p.x, z: p.z, top: y + (src.height || 1) * sy, sc, yaw });
      return { p: new THREE.Vector3(p.x, y, p.z), q: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), s: new THREE.Vector3(sc, sy, sc) };
    });
    for (const part of src) {
      const im = new THREE.InstancedMesh(part.geometry, part.material, pts.length);
      xf.forEach((t, i) => { _m.compose(t.p, t.q, t.s); im.setMatrixAt(i, _m); });
      group.add(im);
    }
  }

  for (const o of group.children) if (o.isInstancedMesh) { o.instanceMatrix.needsUpdate = true; o.computeBoundingSphere(); }
  scene.add(group);

  let t = 0;
  return {
    group,
    mushrooms: mushPts,
    crystals: crysPts,
    boulders,
    update(dt) {
      t += dt;
      const a = moteGeo.attributes.position.array;
      for (let i = 0; i < moteCount; i++) {
        const m = moteBase[i];
        a[i * 3] = m.x + Math.sin(t * m.sp + m.ph) * 0.6;
        a[i * 3 + 1] = m.y + Math.sin(t * m.sp * 1.3 + m.ph * 2) * 0.35;
        a[i * 3 + 2] = m.z + Math.cos(t * m.sp * 0.8 + m.ph) * 0.6;
      }
      moteGeo.attributes.position.needsUpdate = true;
    },
  };
}
