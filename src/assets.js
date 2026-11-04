// Asset pipeline. Every visual entity asks for a model by name. If CONFIG.assets.models[name]
// is set to a .glb URL we load it (GLTFLoader is only fetched when needed); otherwise — or if the
// load fails — we use the primitive placeholder factory. This lets the Art Director drop models in
// later (copy them to game/assets/models/ and set the URL in config.js) without touching gameplay code.
import * as THREE from 'three';
import { CONFIG, TIER } from './config.js';
import { LOW_LOD } from './data/lod-manifest.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// M2 chunk B: low-tier LOD hook. Art's -low GLBs (wren-low, cam-*-low, biscuit-*-low: same node tree,
// joints and face parts) land next to the originals; on the low tier any model whose `<name>-low.glb`
// is listed in the build-time manifest loads that file instead. No manifest entry → the original.
const LOW_SET = new Set(LOW_LOD);
export function modelUrl(name) {
  const url = CONFIG.assets.models[name];
  if (!url || !TIER.low) return url;
  const low = url.replace(/\.glb$/i, '-low.glb');
  return LOW_SET.has(low) ? low : url;
}

let _loader = null;
async function gltfLoader() {
  if (!_loader) {
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    _loader = new GLTFLoader();
  }
  return _loader;
}

/**
 * @param {string} name           key in CONFIG.assets.models
 * @param {() => {root: THREE.Object3D, parts?: object}} factory  primitive fallback
 * @returns {Promise<{root: THREE.Object3D, parts: object, animations: THREE.AnimationClip[], fromFile: boolean}>}
 */
export async function loadModel(name, factory) {
  const url = modelUrl(name);
  if (url) {
    try {
      const loader = await gltfLoader();
      const gltf = await loader.loadAsync(url);
      const root = gltf.scene;
      // Convention for drop-in art: name child nodes like the primitive parts
      // (e.g. "head", "tail", "legFL") and the animation code will find them.
      const parts = {};
      root.traverse((o) => { if (o.name) parts[o.name] = o; });
      return { root, parts, animations: gltf.animations || [], fromFile: true };
    } catch (err) {
      console.warn(`[assets] ${name}: failed to load ${url}, using placeholder`, err);
    }
  }
  const { root, parts = {} } = factory();
  return { root, parts, animations: [], fromFile: false };
}

/**
 * glTF materials (MeshStandardMaterial) → cheap flat Lambert, keeping colour, texture map, vertex
 * colours and emissive + emissiveIntensity (KHR_materials_emissive_strength lands in
 * emissiveIntensity in three r150+). Mobile budget: no PBR in the game.
 */
export function toLambert(src, opts = {}) {
  const m = new THREE.MeshLambertMaterial({
    map: src.map || null,
    color: opts.color != null ? opts.color : (src.color ? src.color.clone() : 0xffffff),
    emissive: opts.emissive != null ? opts.emissive : (src.emissive ? src.emissive.clone() : 0x000000),
    emissiveIntensity: src.emissiveIntensity ?? 1,
    vertexColors: !!src.vertexColors,
    transparent: !!src.transparent, opacity: src.opacity ?? 1,
    side: src.side,
    flatShading: true,
  });
  m.name = src.name || '';
  return m;
}

// Shared helper for primitive builders
export function lambert(color, extra = {}) {
  return new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });
}

/**
 * Load a static GLB as flat parts for InstancedMesh use: node transforms are baked into each
 * geometry, materials become cheap Lambert (keeping the Kenney colormap texture).
 * @param {string} name  CONFIG.assets.models key
 * @param {object} opts  { size: target max horizontal extent in metres, color: tint override, emissive, raw }
 * @returns {Promise<Array<{geometry: THREE.BufferGeometry, material: THREE.Material}>|null>}
 */
export async function loadParts(name, opts = {}) {
  const url = modelUrl(name);
  if (!url) return null;
  try {
    const loader = await gltfLoader();
    const gltf = await loader.loadAsync(url);
    const root = gltf.scene;
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const k = opts.size ? opts.size / Math.max(size.x, size.z, 1e-4) : 1;
    // opts.raw: keep the file's own origin/units (art-director GLBs: metres, origin at base, +Z
    // facing; the wall torch's back plate sits at z=0), otherwise centre + normalise (Kenney kits)
    const norm = opts.raw ? new THREE.Matrix4() : new THREE.Matrix4().makeScale(k, k, k)
      .multiply(new THREE.Matrix4().makeTranslation(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2));
    const parts = [];
    root.traverse((o) => {
      if (!o.isMesh) return;
      const g = o.geometry.clone();
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(norm, o.matrixWorld));
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const src = mats[0];
      const material = toLambert(src, opts.keepEmissive === false ? { ...opts, emissive: opts.emissive ?? 0 } : opts);
      // `node` = nearest named ancestor (e.g. 'flame' child of a torch) for per-part handling
      let n = o; while (n && !n.name && n.parent) n = n.parent;
      const ancestors = []; for (let a = o; a; a = a.parent) if (a.name) ancestors.push(a.name);
      parts.push({ geometry: g, material, node: n?.name || '', ancestors });
    });
    // glTF extras on any node (e.g. { pointLight: {color, intensity, distance, decay, offset} })
    let extras = null;
    root.traverse((o) => { if (!extras && o.userData?.pointLight) extras = o.userData; });
    parts.extras = extras || {};
    // M2 chunk B: named node origins in the same (normalised) space — pivots, use/sit/eat points, anchors
    parts.nodes = {};
    root.traverse((o) => { if (o.name) parts.nodes[o.name] = o.getWorldPosition(new THREE.Vector3()).applyMatrix4(norm); });
    parts.scale = k;
    parts.height = size.y * k;
    return parts;
  } catch (err) {
    console.warn(`[assets] ${name}: failed to load ${url}`, err);
    return null;
  }
}

/** Load + normalise a full model (keeps hierarchy, skinning and animations). */
export async function loadScene(name, { height } = {}) {
  const url = modelUrl(name);
  if (!url) return null;
  try {
    const loader = await gltfLoader();
    const gltf = await loader.loadAsync(url);
    const root = gltf.scene;
    root.updateMatrixWorld(true);
    if (height) {
      const box = new THREE.Box3().setFromObject(root);
      const h = box.max.y - box.min.y;
      if (h > 0) root.scale.multiplyScalar(height / h);
    }
    root.traverse((o) => {
      if (o.isMesh) {
        o.frustumCulled = false; // skinned bounds are unreliable; there are only a few of these
        o.material = toLambert(o.material);
      }
    });
    return { root, animations: gltf.animations || [], fromFile: true };
  } catch (err) {
    console.warn(`[assets] ${name}: failed to load ${url}`, err);
    return null;
  }
}

/**
 * Chunk C: bake a multi-material static GLB (loadParts output) into ONE vertex-coloured geometry
 * (1 draw call per InstancedMesh). Emissive parts are returned separately so they can keep their own
 * glow material (glow comes only from emissive materials). `filter(part)` selects which parts to bake.
 * @returns {{geometry: THREE.BufferGeometry|null, glow: Array<{geometry, material}>}}
 */
export function bakeVertexColors(parts, filter = () => true) {
  if (!parts) return { geometry: null, glow: [] };
  const plain = [], glow = [];
  for (const p of parts) {
    if (!filter(p)) continue;
    if (p.material.emissive && p.material.emissive.getHex()) { glow.push(p); continue; }
    const g = p.geometry.index ? p.geometry.toNonIndexed() : p.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    const n = g.attributes.position.count, a = new Float32Array(n * 3), c = p.material.color;
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    plain.push(g);
  }
  return { geometry: plain.length ? mergeGeometries(plain) : null, glow };
}
