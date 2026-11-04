// Chunk C perf: per-instance culling for STATIC InstancedMeshes (cave decor, surface vegetation).
// An InstancedMesh's bounds cover every placement, so three draws all of them whenever any one is in
// view. Every 0.2 s this keeps only the instances inside the camera frustum and within `maxDist`
// (past it the §8.1 fog has swallowed them anyway), compacting matrices (and colours) to the front and
// setting .count. Only for meshes whose matrices never change after build (not flames, items, trees).
import * as THREE from 'three';

const _fr = new THREE.Frustum(), _sph = new THREE.Sphere(), _m = new THREE.Matrix4(), _c = new THREE.Vector3(), _s = new THREE.Vector3(), _q = new THREE.Quaternion();

export class InstanceCuller {
  constructor() { this.sets = []; this._t = 1; this.scale = 1; }
  /** Polish: scale every cull distance (graphics tier, applied live). */
  setScale(k) { this.scale = k; for (const r of this.sets) r.d2 = (r.d0 * k) ** 2; this._t = 1; }

  add(im, maxDist = 32) {
    if (!im?.isInstancedMesh || im.userData.instCull) return;
    im.userData.instCull = true;
    const n = im.count, geo = im.geometry;
    if (!geo.boundingSphere) geo.computeBoundingSphere();
    const bs = geo.boundingSphere, sph = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      im.getMatrixAt(i, _m); _m.decompose(_c, _q, _s);
      const p = bs.center.clone().applyMatrix4(_m);
      sph.set([p.x, p.y, p.z, bs.radius * Math.max(_s.x, _s.y, _s.z) + 0.05], i * 4);
    }
    this.sets.push({ im, n, sph, mat: im.instanceMatrix.array.slice(0, n * 16), col: im.instanceColor ? im.instanceColor.array.slice(0, n * 3) : null, d0: maxDist, d2: (maxDist * this.scale) ** 2 });
  }

  /** M2 chunk B: change one instance's matrix after build (glowberries picked / regrown). */
  setMatrix(im, i, m) {
    const r = this.sets.find((x) => x.im === im);
    if (!r) { im.setMatrixAt(i, m); im.instanceMatrix.needsUpdate = true; return; }
    m.toArray(r.mat, i * 16); this._t = 1;
  }
  addAll(root, maxDist) { root.traverse((o) => { if (o.isInstancedMesh && o.frustumCulled !== false) this.add(o, maxDist); }); }

  update(dt, camera, force = false) {
    if (!force && (this._t += dt) < 0.2) return; this._t = 0;
    camera.updateMatrixWorld();
    const cp = camera.getWorldPosition(_c);
    _fr.setFromProjectionMatrix(_m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    for (const r of this.sets) {
      if (!r.im.visible && !force) continue;
      const dm = r.im.instanceMatrix.array, dc = r.im.instanceColor?.array; let k = 0;
      for (let i = 0; i < r.n; i++) {
        const o = i * 4, x = r.sph[o], y = r.sph[o + 1], z = r.sph[o + 2];
        if ((x - cp.x) ** 2 + (z - cp.z) ** 2 > r.d2) continue;
        _sph.center.set(x, y, z); _sph.radius = r.sph[o + 3];
        if (!_fr.intersectsSphere(_sph)) continue;
        if (k !== i) { dm.set(r.mat.subarray(i * 16, i * 16 + 16), k * 16); if (r.col) dc.set(r.col.subarray(i * 3, i * 3 + 3), k * 3); }
        else if (dm[k * 16 + 12] !== r.mat[i * 16 + 12] || dm[k * 16 + 14] !== r.mat[i * 16 + 14]) { dm.set(r.mat.subarray(i * 16, i * 16 + 16), k * 16); if (r.col) dc.set(r.col.subarray(i * 3, i * 3 + 3), k * 3); }
        k++;
      }
      r.im.count = k; r.im.instanceMatrix.needsUpdate = true; if (r.col) r.im.instanceColor.needsUpdate = true;
    }
  }
}
