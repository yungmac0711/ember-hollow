// Chunk C: the surface clearing outside the cave mouth (art/assets/surface, Style A, metres, origin
// at base). Everything is instanced: three grass tufts, bush_1, bush_glowberry (body + its emissive
// berries as an unlit MeshBasic instance — glow from emissive materials only, no light). Trees are
// handed to Harvest as variants (pine / round / birch share the root tree's stump mesh): the ones
// inside the bowl are choppable, the ones on the cliff-top rim are deco only. One deco birch at the
// edge carries the clearing lore note (a carved bark blaze, see world/lore.js).
import * as THREE from 'three';
import { mulberry32 } from './noise.js';
import { bakeVertexColors, loadParts } from '../assets.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();

export async function loadSurfaceParts() {
  const raw = { raw: true };
  const [pine, round, birch, bush1, glow, g1, g2, g3] = await Promise.all(
    ['treePine', 'treeRound', 'treeBirch', 'bush1', 'bushGlowberry', 'grass1', 'grass2', 'grass3'].map((k) => loadParts(k, raw)));
  return { pine, round, birch, bush1, glow, grass: [g1, g2, g3] };
}

/** Geometry for Harvest tree variants (one vertex-coloured geometry each). */
export function treeVariants(parts) {
  const out = {};
  for (const v of ['pine', 'round', 'birch']) { const b = bakeVertexColors(parts[v]); if (b.geometry) out[v] = b.geometry; }
  return out;
}

const _fr = new THREE.Frustum(), _sph = new THREE.Sphere();

export class Surface {
  constructor(scene, cave, seed, parts, { low = false } = {}) {
    const rng = mulberry32((seed * 53 + 17) >>> 0);
    const c = cave.clearing; this.cave = cave; this.meshes = [];
    const mouthA = Math.atan2(-c.z, -c.x); // towards Lanternmouth (the tunnel in)
    const angOff = (a) => Math.abs(Math.atan2(Math.sin(a - mouthA), Math.cos(a - mouthA)));
    const taken = [];
    const free = (x, z, d) => taken.every((t) => Math.hypot(t.x - x, t.z - z) > d + t.r);
    const spot = (rMin, rMax, fMin, fMax, sep, keepMouth = 0.5) => {
      for (let i = 0; i < 120; i++) {
        const a = rng() * Math.PI * 2, r = rMin + Math.sqrt(rng()) * (rMax - rMin);
        if (keepMouth && angOff(a) < keepMouth) continue;
        const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r, f = cave.field(x, z);
        if (f < fMin || f > fMax || !free(x, z, sep)) continue;
        return { x, z, y: cave.floorAt(x, z), a };
      }
      return null;
    };
    // ---- trees: choppable in the bowl, deco on the cliff-top rim
    this.trees = [];
    const tree = (variant, s, deco, scale) => {
      taken.push({ x: s.x, z: s.z, r: 1.2 });
      this.trees.push({ variant, deco, pos: new THREE.Vector3(s.x, s.y, s.z), rot: rng() * Math.PI * 2, scale });
    };
    for (const v of ['pine', 'pine', 'pine', 'round', 'round', 'round', 'birch', 'birch']) {
      const s = spot(5.5, c.r - 1.2, 1.4, 99, 1.6); if (s) tree(v, s, false, 0.9 + rng() * 0.25);
    }
    // the lore birch: deco (never chopped), at the bowl's edge, facing the centre
    const lb = spot(c.r - 3.5, c.r - 1.5, 1.2, 99, 1.4, 0.9);
    if (lb) {
      tree('birch', lb, true, 1.05);
      const t = this.trees[this.trees.length - 1];
      t.rot = 0;
      this.clearingBirch = { x: lb.x, z: lb.z, y: lb.y, yaw: Math.atan2(c.x - lb.x, c.z - lb.z), trunkR: 0.09 * 1.05 };
    }
    for (let i = 0; i < (low ? 12 : 16); i++) { // rim silhouette against the sky
      const s = spot(c.r - 1, c.r + 5, -3.0, -0.9, 1.4, 0); if (!s) continue;
      tree(['pine', 'pine', 'round', 'birch'][i % 4], s, true, 1.0 + rng() * 0.35);
    }
    // ---- instanced vegetation
    const inst = (parts, specs, name, unlitGlow = false) => {
      if (!parts || !specs.length) return;
      const b = bakeVertexColors(parts);
      const add = (geometry, material, nm) => {
        const im = new THREE.InstancedMesh(geometry, material, specs.length); im.name = nm;
        specs.forEach((sp, i) => {
          _q.setFromEuler(_e.set(0, sp.rot, 0));
          im.setMatrixAt(i, _m.compose(_p.set(sp.x, sp.y - 0.02, sp.z), _q, _s.setScalar(sp.scale)));
        });
        im.computeBoundingSphere(); scene.add(im); this.meshes.push(im);

      };
      if (b.geometry) add(b.geometry, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), name);
      if (unlitGlow && b.glow.length) for (const g of b.glow) add(g.geometry, new THREE.MeshBasicMaterial({ color: g.material.emissive.clone() }), name + '-glow');
    };
    const scatter = (n, rMin, rMax, fMin, sep, sMin, sMax, keep = 0.35) => {
      const out = [];
      for (let i = 0; i < n; i++) {
        const s = spot(rMin, rMax, fMin, 99, sep, keep); if (!s) continue;
        out.push({ ...s, rot: rng() * Math.PI * 2, scale: sMin + rng() * (sMax - sMin) });
      }
      return out;
    };
    const bushes = scatter(low ? 10 : 14, 4, c.r - 0.6, 0.7, 0.9, 0.9, 1.4);
    for (const b of bushes) taken.push({ x: b.x, z: b.z, r: 0.4 });
    const glowB = scatter(5, 5, c.r - 1.5, 0.9, 1.6, 0.9, 1.2);
    for (const b of glowB) taken.push({ x: b.x, z: b.z, r: 0.4 });
    inst(parts.bush1, bushes, 'bush');
    inst(parts.glow, glowB, 'bush-glowberry', true);
    this.glowberries = glowB;
    const nGrass = low ? 16 : 24;
    parts.grass.forEach((g, k) => inst(g, scatter(nGrass, 1.2, c.r + 0.3, 0.3, 0.05, 0.8, 1.35, 0.15), 'grass-' + (k + 1)));
    this._cull = 1;
  }

  /** Whole-system cull: the clearing's vegetation only renders from the mouth tunnel outwards. */
  // Inside the tunnel (> 4 m in) it also needs the mouth itself in the camera frustum, so looking
  // back into Lanternmouth doesn't draw the clearing behind the rock.
  update(dt, camPos, camera) {
    if ((this._cull += dt) < 0.2) return; this._cull = 0;
    const depth = this.cave.depthIntoCave(camPos.x, camPos.z);
    let vis = depth < 20;
    if (vis && depth > 4 && camera) {
      const c = this.cave.clearing, a = Math.atan2(-c.z, -c.x);
      camera.updateMatrixWorld();
      _fr.setFromProjectionMatrix(_m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
      _sph.center.set(c.x + Math.cos(a) * (c.r || 12.5), this.cave.floorAt(c.x + Math.cos(a) * (c.r || 12.5), c.z + Math.sin(a) * (c.r || 12.5)) + 1.5, c.z + Math.sin(a) * (c.r || 12.5)); _sph.radius = 3;
      vis = _fr.intersectsSphere(_sph);
    }
    this.visible = vis;
    for (const m of this.meshes) m.visible = vis;
    // per-instance frustum/distance culling: main.js registers this.meshes with the InstanceCuller
  }
}
