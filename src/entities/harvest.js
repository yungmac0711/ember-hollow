// Hold-to-gather nodes: chunky "root trees" (procedural — the Kenney kits have no trees; they grow
// where surface roots break through near Lanternmouth, the Galleries and Mossdrip) chop into wood,
// and Kenney cave rocks break into stone (+ flint in Flintseam). Tap-hold the target or hold Use.
// Each node type is instanced (trees: full + stump meshes; rocks: one InstancedMesh per variant),
// so the whole system costs 5 draw calls. Spent nodes regrow out of sight.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CONFIG } from '../config.js';
import { mulberry32 } from '../world/noise.js';
import { lambert } from '../assets.js';

const HC = CONFIG.harvest;
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();

function colored(g, hex) {
  g = g.index ? g.toNonIndexed() : g;
  const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k);
  return g;
}

/** Root tree, ~3.3 m tall, origin at the base. Returns {full, stump} geometries (vertex colours). */
function treeGeometry(rng) {
  const bark = 0x6b4a2f, barkDark = 0x4e3622, leaf = 0x4f6b3a, leafLight = 0x6f8f4a;
  const roots = [];
  for (let i = 0; i < 4; i++) {
    const a = i / 4 * Math.PI * 2 + 0.4;
    const r = new THREE.CylinderGeometry(0.05, 0.14, 0.9, 5); r.translate(0, 0.45, 0);
    r.rotateZ(1.05); r.rotateY(a); r.translate(Math.cos(a) * 0.15, 0, -Math.sin(a) * 0.15);
    roots.push(colored(r, barkDark));
  }
  const stumpTop = new THREE.CylinderGeometry(0.3, 0.36, 0.5, 6); stumpTop.translate(0, 0.25, 0);
  const stump = mergeGeometries([colored(stumpTop, bark), ...roots.map((g) => g.clone())]);
  const trunk = new THREE.CylinderGeometry(0.2, 0.34, 2.3, 6); trunk.translate(0, 1.15, 0);
  const branch = new THREE.CylinderGeometry(0.06, 0.1, 0.9, 5); branch.translate(0, 0.45, 0); branch.rotateZ(-0.8); branch.translate(0.1, 1.5, 0);
  const blobs = [];
  for (const [x, y, z, r, c] of [[0, 2.55, 0, 0.85, leaf], [0.55, 2.25, 0.2, 0.55, leafLight], [-0.45, 2.3, -0.25, 0.6, leaf], [0.1, 3.0, -0.1, 0.5, leafLight]]) {
    const b = new THREE.IcosahedronGeometry(r, 0); b.scale(1, 0.75, 1); b.translate(x, y, z); blobs.push(colored(b, c));
  }
  const full = mergeGeometries([colored(trunk, bark), colored(branch, bark), ...roots, ...blobs]);
  full.computeVertexNormals(); stump.computeVertexNormals();
  return { full, stump };
}

export class Harvest {
  /** @param rockSources array of loadParts() results (rock-a/b/c), may contain nulls */
  constructor(scene, cave, seed, colliders, rockSources = []) {
    this.cave = cave; this.colliders = colliders;
    const rng = mulberry32(seed * 7 + 41);
    this.nodes = [];
    this._t = 0;
    const [lanternmouth, flintseam, glowcapCh, mossdrip, hushing] = cave.chambers;
    const s = {};
    const farFrom = (p, list, d) => list.every((q) => Math.hypot(p.x - q.pos.x, p.z - q.pos.z) > d);

    // --- root trees
    const treeSpots = [[lanternmouth, 5], [glowcapCh, 3], [mossdrip, 2]];
    for (const [ch, n] of treeSpots) {
      for (let i = 0, guard = 0; i < n && guard++ < 200; ) {
        const p = cave.randomPoint(rng, 1.3, 3.0, ch);
        if (!p) continue;
        if (Math.hypot(p.x - lanternmouth.x, p.z - lanternmouth.z) < 3.2) continue; // spawn + first-fire area
        if (!farFrom(p, this.nodes, 2.6)) continue;
        const smp = cave.sample(p.x, p.z, s);
        const room = smp.ceil - smp.floor - 0.25;
        const scale = Math.min(1.1, room / 3.4);
        if (scale < 0.7) continue;
        this.nodes.push({ type: 'tree', pos: p, rot: rng() * Math.PI * 2, scale, alive: true, respawnAt: 0, wobble: 0 });
        i++;
      }
    }
    // --- breakable rocks: spread through the cave, a few guaranteed in Flintseam
    const rockSpots = [[flintseam, 4], [lanternmouth, 2], [null, HC.rock.count - 6]];
    for (const [ch, n] of rockSpots) {
      for (let i = 0, guard = 0; i < n && guard++ < 300; ) {
        const p = cave.randomPoint(rng, 1.0, 4.0, ch);
        if (!p) continue;
        if (Math.hypot(p.x - lanternmouth.x, p.z - lanternmouth.z) < 2.5) continue;
        if (!farFrom(p, this.nodes, 2.0)) continue;
        const inFlint = Math.hypot(p.x - flintseam.x, p.z - flintseam.z) < flintseam.r + 2;
        this.nodes.push({ type: 'rock', variant: 0, pos: p, rot: rng() * Math.PI * 2, scale: 0.9 + rng() * 0.35, alive: true, respawnAt: 0, wobble: 0, flinty: inFlint });
        i++;
      }
    }

    // --- meshes
    const tg = treeGeometry(rng);
    const treeMat = lambert(0xffffff, { vertexColors: true });
    const nTree = this.nodes.filter((n) => n.type === 'tree').length;
    this.treeMesh = new THREE.InstancedMesh(tg.full, treeMat, Math.max(1, nTree));
    this.stumpMesh = new THREE.InstancedMesh(tg.stump, treeMat, Math.max(1, nTree));
    this.rockMeshes = [0].map((v) => { // one variant (rock-b) = one draw call; random yaw/scale for variety
      const src = rockSources[v];
      let parts = src && src.length ? src : null;
      if (!parts) { const g = new THREE.DodecahedronGeometry(0.5, 0); g.scale(1, 0.75, 1); g.translate(0, 0.32, 0); parts = [{ geometry: g, material: lambert(0x6d6a66) }]; }
      const n = this.nodes.filter((x) => x.type === 'rock' && x.variant === v).length;
      return parts.map((pt) => new THREE.InstancedMesh(pt.geometry, pt.material, Math.max(1, n)));
    });
    this.meshes = [this.treeMesh, this.stumpMesh, ...this.rockMeshes.flat()];
    for (const m of this.meshes) { m.frustumCulled = false; scene.add(m); }
    const idx = { tree: 0, r0: 0 };
    for (const n of this.nodes) {
      n.index = n.type === 'tree' ? idx.tree++ : idx['r' + n.variant]++;
      _q.setFromEuler(_e.set(0, n.rot, 0));
      n.matrix = new THREE.Matrix4().compose(_p.set(n.pos.x, n.pos.y - 0.03, n.pos.z), _q, _s.setScalar(n.scale));
      n.collider = colliders.circle(n.pos.x, n.pos.z, n.type === 'tree' ? 0.34 * n.scale : 0.42 * n.scale);
      n.height = n.type === 'tree' ? 3.0 * n.scale : 0.5 * n.scale;
      this._show(n);
    }
    this.treeMesh.count = this.stumpMesh.count = nTree;
  }

  _show(n, matrix = n.matrix) {
    if (n.type === 'tree') {
      this.treeMesh.setMatrixAt(n.index, n.alive ? matrix : ZERO);
      this.stumpMesh.setMatrixAt(n.index, n.alive ? ZERO : n.matrix);
      this.treeMesh.instanceMatrix.needsUpdate = this.stumpMesh.instanceMatrix.needsUpdate = true;
      this._cullDirty = true;
    } else {
      for (const m of this.rockMeshes[n.variant]) { m.setMatrixAt(n.index, n.alive ? matrix : ZERO); m.instanceMatrix.needsUpdate = true; }
    }
  }

  cfg(n) { return HC[n.type]; }

  /** Best node in front of the player within reach (for the Use button). */
  findTarget(pos, forward) {
    let best = null, bestScore = Infinity;
    for (const n of this.nodes) {
      if (!n.alive) continue;
      const dx = n.pos.x - pos.x, dz = n.pos.z - pos.z, d = Math.hypot(dx, dz);
      if (d > this.cfg(n).reach) continue;
      const facing = d > 0.01 ? (dx * forward.x + dz * forward.z) / d : 1;
      if (facing < 0.45) continue;
      const score = d - facing;
      if (score < bestScore) { bestScore = score; best = n; }
    }
    return best;
  }

  /** Node under a screen point (tap-hold), within reach + 1 m. */
  pickScreen(x, y, camera, pos) {
    let best = null, bd = Infinity;
    const w = window.innerWidth, h = window.innerHeight;
    for (const n of this.nodes) {
      if (!n.alive) continue;
      const d = Math.hypot(n.pos.x - pos.x, n.pos.z - pos.z);
      if (d > this.cfg(n).reach + 1) continue;
      for (const fy of [0.35, 0.7]) {
        _p.set(n.pos.x, n.pos.y + n.height * fy, n.pos.z).project(camera);
        if (_p.z > 1) continue;
        const sx = (_p.x + 1) / 2 * w, sy = (1 - _p.y) / 2 * h;
        const tol = (n.type === 'tree' ? 140 : 110) / Math.max(1, d);
        const e = Math.hypot(sx - x, sy - y);
        if (e < tol && e < bd) { bd = e; best = n; }
      }
    }
    return best;
  }

  /** Screen position of a node's centre (for the progress ring). */
  screenPos(n, camera) {
    _p.set(n.pos.x, n.pos.y + n.height * 0.5, n.pos.z).project(camera);
    return { x: (_p.x + 1) / 2 * window.innerWidth, y: (1 - _p.y) / 2 * window.innerHeight, visible: _p.z < 1 };
  }

  /** Finish a node: returns the yield {wood|stone|flint: n}. */
  harvest(n, rng = Math.random) {
    const c = this.cfg(n);
    const out = { ...c.yield };
    if (n.type === 'rock' && n.flinty && rng() < c.flintChance) out.flint = 1;
    n.alive = false; n.respawnAt = this._t + c.respawn; n.wobble = 0;
    if (n.type === 'rock') n.collider.on = false; else n.collider.r = 0.3 * n.scale;
    this._show(n);
    return out;
  }

  /** Visual feedback while being worked on (0..1). */
  shake(n, k) { n.wobble = k; }

  update(dt, playerPos) {
    this._t += dt;
    if ((this._cull = (this._cull || 0) + dt) > 0.5 || this._cullDirty) { // whole-mesh distance cull
      this._cull = 0; this._cullDirty = false;
      const near = (pred) => this.nodes.some((n) => pred(n) && Math.hypot(n.pos.x - playerPos.x, n.pos.z - playerPos.z) < 28);
      this.treeMesh.visible = near((n) => n.type === 'tree' && n.alive);
      this.stumpMesh.visible = near((n) => n.type === 'tree' && !n.alive);
      for (const m of this.rockMeshes[0]) m.visible = near((n) => n.type === 'rock' && n.alive);
    }
    for (const n of this.nodes) {
      if (n.wobble > 0 && n.alive) {
        const a = Math.sin(this._t * 38) * 0.035 * (0.4 + n.wobble);
        _q.setFromEuler(_e.set(a, n.rot, a * 0.6));
        _m.compose(_p.set(n.pos.x, n.pos.y - 0.03, n.pos.z), _q, _s.setScalar(n.scale));
        this._show(n, _m);
        n._shaken = true; n.wobble = 0; // must be re-applied each frame while held
      } else if (n._shaken) { n._shaken = false; this._show(n); }
      if (!n.alive && this._t >= n.respawnAt && Math.hypot(n.pos.x - playerPos.x, n.pos.z - playerPos.z) > 7 && (!this.canRespawn || this.canRespawn(n))) { // never regrow under a built piece
        n.alive = true; n.collider.on = true; if (n.type === 'tree') n.collider.r = 0.34 * n.scale;
        this._show(n);
      }
    }
  }

  counts() { const c = { tree: 0, rock: 0, spent: 0 }; for (const n of this.nodes) n.alive ? c[n.type]++ : c.spent++; return c; }
}
