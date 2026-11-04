// Asset pipeline. Every visual entity asks for a model by name. If CONFIG.assets.models[name]
// is set to a .glb URL we load it (GLTFLoader is only fetched when needed); otherwise — or if the
// load fails — we use the primitive placeholder factory. This lets the Art Director drop models in
// later (copy them to game/assets/models/ and set the URL in config.js) without touching gameplay code.
import * as THREE from 'three';
import { CONFIG } from './config.js';

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
  const url = CONFIG.assets.models[name];
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

// Shared helper for primitive builders
export function lambert(color, extra = {}) {
  return new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });
}

/**
 * Load a static GLB as flat parts for InstancedMesh use: node transforms are baked into each
 * geometry, materials become cheap Lambert (keeping the Kenney colormap texture).
 * @param {string} name  CONFIG.assets.models key
 * @param {object} opts  { size: target max horizontal extent in metres, color: tint override, emissive }
 * @returns {Promise<Array<{geometry: THREE.BufferGeometry, material: THREE.Material}>|null>}
 */
export async function loadParts(name, opts = {}) {
  const url = CONFIG.assets.models[name];
  if (!url) return null;
  try {
    const loader = await gltfLoader();
    const gltf = await loader.loadAsync(url);
    const root = gltf.scene;
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const k = opts.size ? opts.size / Math.max(size.x, size.z, 1e-4) : 1;
    const norm = new THREE.Matrix4().makeScale(k, k, k)
      .multiply(new THREE.Matrix4().makeTranslation(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2));
    const parts = [];
    root.traverse((o) => {
      if (!o.isMesh) return;
      const g = o.geometry.clone();
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(norm, o.matrixWorld));
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const src = mats[0];
      const material = new THREE.MeshLambertMaterial({
        map: src.map || null,
        color: opts.color != null ? opts.color : (src.color ? src.color.clone() : 0xffffff),
        emissive: opts.emissive != null ? opts.emissive : 0x000000,
        flatShading: true,
      });
      parts.push({ geometry: g, material });
    });
    return parts;
  } catch (err) {
    console.warn(`[assets] ${name}: failed to load ${url}`, err);
    return null;
  }
}

/** Load + normalise a full model (keeps hierarchy, skinning and animations). */
export async function loadScene(name, { height } = {}) {
  const url = CONFIG.assets.models[name];
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
        const src = o.material;
        o.material = new THREE.MeshLambertMaterial({ map: src.map || null, color: src.color || 0xffffff, flatShading: true });
      }
    });
    return { root, animations: gltf.animations || [] };
  } catch (err) {
    console.warn(`[assets] ${name}: failed to load ${url}`, err);
    return null;
  }
}
