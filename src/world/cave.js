// Procedural-ish cave: hand-placed chambers + tunnels, wobbled with noise, expressed as a
// 2D signed field f(x,z) (≈ metres from the nearest wall, >0 = open cave). Floor and ceiling
// heights are derived from f, so the same cheap function drives both rendering and collision.
import * as THREE from 'three';
import { makeNoise2D, fbm, mulberry32 } from './noise.js';

export const CHAMBERS = [
  // Names from story/LORE.md. `desc` feeds the companion CONTEXT block.
  { id: 'lanternmouth', name: 'Lanternmouth',       x: 0,   z: 0,   r: 7.5, elev: 0.0, desc: 'the first chamber in from the entrance, dry floor, a good hearth spot' },
  { id: 'flintseam',    name: 'Flintseam Ridge',    x: 23,  z: -6,  r: 9.0, elev: -1.4, desc: 'a wide hall with dry flint seams and humming purple crystals' },
  { id: 'glowcap',      name: 'the Glowcap Galleries', x: 6, z: -27, r: 8.0, elev: 1.1, desc: 'mossy galleries thick with glowing cyan mushrooms and drifting spores' },
  { id: 'mossdrip',     name: 'Mossdrip Grotto',    x: -21, z: -14, r: 6.5, elev: 1.9, desc: 'a raised grotto, low ceiling, water dripping through moss' },
  { id: 'hushing',      name: 'the Hushing Pools',  x: -15, z: 17,  r: 6.5, elev: -0.7, pool: true, desc: 'a still, dark pool that swallows every sound' },
];
// [fromChamber, toChamber, radius]
const TUNNELS = [[0, 1, 2.0], [0, 2, 1.9], [1, 2, 1.7], [0, 3, 1.8], [0, 4, 1.9], [3, 2, 1.6]];

const STEP = 0.5; // mesh grid resolution (m)

export class Cave {
  constructor(seed = 1337) {
    this.noiseA = makeNoise2D(seed);
    this.noiseB = makeNoise2D(seed + 17);
    this.noiseC = makeNoise2D(seed + 91);
    this.chambers = CHAMBERS;
    this.tunnels = TUNNELS.map(([a, b, r]) => ({ a: CHAMBERS[a], b: CHAMBERS[b], r }));
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const c of CHAMBERS) {
      minX = Math.min(minX, c.x - c.r); maxX = Math.max(maxX, c.x + c.r);
      minZ = Math.min(minZ, c.z - c.r); maxZ = Math.max(maxZ, c.z + c.r);
    }
    const pad = 6;
    this.bounds = { minX: minX - pad, maxX: maxX + pad, minZ: minZ - pad, maxZ: maxZ + pad };
    this._g = new THREE.Vector2();
  }

  /** Signed "openness" field: >0 inside the cave, roughly metres to the wall. */
  field(x, z) {
    const n = this.noiseA;
    const wx = x + n(x * 0.08, z * 0.08) * 2.2;
    const wz = z + n(x * 0.08 + 31.7, z * 0.08 - 12.3) * 2.2;
    let f = -1e9;
    for (const c of this.chambers) {
      const d = Math.hypot(wx - c.x, wz - c.z);
      f = Math.max(f, c.r - d);
    }
    for (const t of this.tunnels) {
      const ax = t.a.x, az = t.a.z, bx = t.b.x - ax, bz = t.b.z - az;
      const h = Math.max(0, Math.min(1, ((wx - ax) * bx + (wz - az) * bz) / (bx * bx + bz * bz)));
      const d = Math.hypot(wx - ax - bx * h, wz - az - bz * h);
      f = Math.max(f, t.r - d);
    }
    return f + fbm(this.noiseB, x * 0.25, z * 0.25, 2) * 0.7;
  }

  /** Base floor elevation: each chamber has its own height, blended smoothly through tunnels. */
  floorBase(x, z) {
    let wsum = 0, esum = 0, dip = 0;
    for (const c of this.chambers) {
      const d = Math.hypot(x - c.x, z - c.z);
      const k = Math.max(d - c.r * 0.6, 0.1);
      const w = 1 / (k * k);
      wsum += w; esum += w * c.elev;
      if (c.pool && d < 4) { const s = 1 - d / 4; dip -= 0.9 * s * s * (3 - 2 * s); }
    }
    return esum / wsum + dip + fbm(this.noiseC, x * 0.12, z * 0.12, 2) * 0.35;
  }

  /** Returns {f, floor, ceil, wall} where wall∈[0,1] is how much this point is "wall". */
  sample(x, z, out = {}) {
    const f = this.field(x, z);
    const base = this.floorBase(x, z);
    const ceilBase = base + 2.7 + Math.min(Math.max(f, 0), 8) * 0.55 + fbm(this.noiseC, x * 0.2 + 50, z * 0.2, 2) * 0.6;
    const t = Math.min(1, Math.max(0, (1.4 - f) / 1.9));
    const s = t * t * (3 - 2 * t);
    const mid = base + 1.5;
    out.f = f;
    out.wall = s;
    out.floor = base + (mid - base) * s * s;
    out.ceil = ceilBase + (mid - ceilBase) * Math.pow(s, 0.6);
    return out;
  }

  floorAt(x, z) { return this.sample(x, z, this._tmp || (this._tmp = {})).floor; }

  gradient(x, z) {
    const h = 0.08;
    this._g.set(
      (this.field(x + h, z) - this.field(x - h, z)) / (2 * h),
      (this.field(x, z + h) - this.field(x, z - h)) / (2 * h));
    return this._g;
  }

  /** Push a point (Vector3, uses x/z) out of walls so field(p) >= minF. Robust Newton steps. */
  resolve(p, minF) {
    for (let i = 0; i < 5; i++) {
      const f = this.field(p.x, p.z);
      if (f >= minF) return;
      const g = this.gradient(p.x, p.z);
      const l2 = g.x * g.x + g.y * g.y;
      if (l2 < 1e-6) return;
      const k = Math.min((minF - f) / l2, 0.6) + 0.002;
      p.x += g.x * k; p.z += g.y * k;
    }
  }

  chamberAt(x, z) {
    for (const c of this.chambers) if (Math.hypot(x - c.x, z - c.z) < c.r * 0.85) return c;
    return null;
  }

  /** Random open point; optional chamber restricts to inside it. */
  randomPoint(rng, minF = 1, maxF = 99, chamber = null) {
    const b = this.bounds;
    for (let i = 0; i < 400; i++) {
      let x, z;
      if (chamber) {
        const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * chamber.r;
        x = chamber.x + Math.cos(a) * r; z = chamber.z + Math.sin(a) * r;
      } else {
        x = b.minX + rng() * (b.maxX - b.minX); z = b.minZ + rng() * (b.maxZ - b.minZ);
      }
      const f = this.field(x, z);
      if (f >= minF && f <= maxF) return new THREE.Vector3(x, this.floorAt(x, z), z);
    }
    return null;
  }

  /** Build floor + ceiling meshes (flat-shaded, vertex-coloured, 2 draw calls total). */
  buildMeshes() {
    const b = this.bounds;
    const nx = Math.ceil((b.maxX - b.minX) / STEP) + 1;
    const nz = Math.ceil((b.maxZ - b.minZ) / STEP) + 1;
    const N = nx * nz;
    const F = new Float32Array(N), FY = new Float32Array(N), CY = new Float32Array(N), W = new Float32Array(N);
    const s = {};
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      this.sample(b.minX + i * STEP, b.minZ + j * STEP, s);
      F[k] = s.f; FY[k] = s.floor; CY[k] = s.ceil; W[k] = s.wall;
    }
    const remapAndBuild = (isCeil) => {
      const pos = [], col = [], idx = [];
      const map = new Int32Array(N).fill(-1);
      const c = new THREE.Color();
      // Palette: art/STYLE_GUIDE.md §2 (Cave Stone, Hollow Moss, Wet Stone, Deep Slate, Hearth Earth)
      const floorA = new THREE.Color(0x2b3440), moss = new THREE.Color(0x4f6b3a), wallC = new THREE.Color(0x3e4a57);
      const ceilA = new THREE.Color(0x2b3440), ceilB = new THREE.Color(0x1a2029), earth = new THREE.Color(0x5a4636);
      const vert = (k, i, j) => {
        if (map[k] >= 0) return map[k];
        const x = b.minX + i * STEP, z = b.minZ + j * STEP;
        const jit = this.noiseA(x * 1.7 + 9, z * 1.7) * 0.22 * W[k];
        const y = isCeil ? CY[k] + jit : FY[k] + jit * 0.6;
        pos.push(x, y, z);
        const v = this.noiseC(x * 0.6, z * 0.6) * 0.5 + 0.5;
        if (isCeil) {
          c.copy(ceilA).lerp(ceilB, v);
        } else {
          c.copy(floorA);
          const m = this.noiseB(x * 0.15 + 3, z * 0.15) + (this.chamberAt(x, z) === CHAMBERS[2] ? 0.5 : 0);
          if (m > 0.15) c.lerp(moss, Math.min(1, (m - 0.15) * 2.5) * 0.8);
          const hd = Math.hypot(x - CHAMBERS[0].x, z - CHAMBERS[0].z);
          if (hd < 5) c.lerp(earth, (1 - hd / 5) * 0.7); // firelit dirt around the hearth
          c.lerp(wallC, W[k]);
          c.multiplyScalar(0.85 + v * 0.3);
        }
        col.push(c.r, c.g, c.b);
        return (map[k] = pos.length / 3 - 1);
      };
      for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
        const ka = j * nx + i, kb = ka + 1, kc = ka + nx, kd = kc + 1;
        if (Math.max(F[ka], F[kb], F[kc], F[kd]) < -0.9) continue;
        const a = vert(ka, i, j), bb = vert(kb, i + 1, j), cc = vert(kc, i, j + 1), d = vert(kd, i + 1, j + 1);
        if (isCeil) idx.push(a, bb, cc, bb, d, cc); else idx.push(a, cc, bb, bb, cc, d);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      g.computeBoundingSphere();
      return g;
    };
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const floor = new THREE.Mesh(remapAndBuild(false), mat);
    const ceil = new THREE.Mesh(remapAndBuild(true), mat);
    floor.name = 'cave-floor'; ceil.name = 'cave-ceiling';
    floor.matrixAutoUpdate = ceil.matrixAutoUpdate = false;
    const group = new THREE.Group();
    group.add(floor, ceil);
    return group;
  }
}

export { mulberry32 };
