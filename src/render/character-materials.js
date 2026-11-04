// STYLE_GUIDE §8 backlight fix for Wren and Biscuit: a cool emissive lift (#16202C @ 1.0) so they
// never drop to pure black against the fire, plus an optional fresnel rim (#7FA3C8, power 2.5,
// strength 0.35) patched into Lambert via onBeforeCompile. No extra lights. Materials are shared per
// colour (cache) and all rim materials share one program (customProgramCacheKey).
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { toLambert } from '../assets.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const cache = new Map();
const L = () => CONFIG.render.characterLift;
const rimUniforms = {
  uRimColor: { value: new THREE.Color(0x7fa3c8) },
  uRimPower: { value: 2.5 },
  uRimStrength: { value: 0.35 },
};

function patchRim(mat) {
  const r = L().rim;
  if (!r) return mat;
  rimUniforms.uRimColor.value.set(r.color); rimUniforms.uRimPower.value = r.power; rimUniforms.uRimStrength.value = r.strength;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, rimUniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRimColor;\nuniform float uRimPower;\nuniform float uRimStrength;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        // fresnel rim (view space): vViewPosition is provided by the Lambert vertex shader
        float rimK = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), uRimPower);
        totalEmissiveRadiance += uRimColor * rimK * uRimStrength;`);
  };
  mat.customProgramCacheKey = () => 'eh-character-rim';
  return mat;
}

/**
 * Returns a shared, lifted Lambert material equivalent to `src` (any three material type:
 * glTF MeshStandardMaterial is converted to Lambert, keeping colour, map, vertex colours).
 * Materials that are themselves glowing (non-black emissive or MeshBasic) are returned untouched.
 */
export function characterMaterial(src) {
  if (!src || src.isMeshBasicMaterial || src.isPointsMaterial || src.isSpriteMaterial) return src;
  if (src.emissive && src.emissive.getHex() !== 0) {
    // glowing parts (lantern crystal, collar tag): keep their own emissive, no lift/rim; just make
    // sure they're cheap Lambert rather than glTF PBR
    if (src.isMeshLambertMaterial) return src;
    const gk = `glow|${src.name}|${src.emissive.getHexString()}`;
    if (!cache.has(gk)) cache.set(gk, toLambert(src));
    return cache.get(gk);
  }
  if (src.transparent && src.opacity < 1) return src;          // blob shadows, hearts
  const key = `${src.color ? src.color.getHexString() : 'fff'}|${src.map ? src.map.uuid : ''}|${src.vertexColors ? 1 : 0}|${src.side}`;
  let m = cache.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({
      color: src.color ? src.color.clone() : 0xffffff,
      map: src.map || null,
      vertexColors: !!src.vertexColors,
      flatShading: true,
      side: src.side,
      emissive: L().emissive,
      emissiveIntensity: L().emissiveIntensity,
    });
    m.name = `character:${src.name || key}`;
    patchRim(m);
    cache.set(key, m);
  }
  return m;
}

const _I = new THREE.Matrix4();
const mergeable = (m) => m && !Array.isArray(m) && !m.map && !m.vertexColors && !m.isMeshBasicMaterial
  && !(m.emissive && m.emissive.getHex() !== 0) && !(m.transparent && m.opacity < 1);

/**
 * Draw-call saver: glTF meshes with several primitives (one per flat colour) load as a Group of
 * identity-transform child meshes. Merge those per pivot into ONE mesh with vertex colours, so each
 * animated pivot is a single draw call (Wren 25 → 13, Biscuit 19 → 12). Glowing parts (lantern
 * crystal, collar tag) and anything transparent stay separate.
 */
function mergePrimitives(root) {
  const parents = [];
  root.traverse((o) => parents.push(o));
  for (const P of parents) {
    const prims = P.children.filter((c) => c.isMesh && !c.isInstancedMesh && !c.isSkinnedMesh && c.children.length === 0
      && c.matrix.equals(_I) && c.position.lengthSq() === 0 && mergeable(c.material));
    const bySide = new Map();
    for (const c of prims) { const k = c.material.side; if (!bySide.has(k)) bySide.set(k, []); bySide.get(k).push(c); }
    for (const [side, list] of bySide) {
      if (list.length < 2) continue;
      const geos = list.map((c) => {
        const g = c.geometry.index ? c.geometry.toNonIndexed() : c.geometry.clone();
        for (const a of Object.keys(g.attributes)) if (a !== 'position' && a !== 'normal') g.deleteAttribute(a);
        const n = g.attributes.position.count, col = new Float32Array(n * 3), cc = c.material.color || new THREE.Color(1, 1, 1);
        for (let i = 0; i < n; i++) col.set([cc.r, cc.g, cc.b], i * 3);
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        return g;
      });
      const merged = mergeGeometries(geos, false);
      if (!merged) continue;
      geos.forEach((g) => g.dispose());
      const mesh = new THREE.Mesh(merged, new THREE.MeshLambertMaterial({ vertexColors: true, side }));
      mesh.name = `${P.name || 'part'}:merged`;
      mesh.frustumCulled = false;
      for (const c of list) P.remove(c);
      P.add(mesh);
    }
  }
}

/** Merge per-pivot primitives, then apply the lift to every mesh under root (Wren, Biscuit). */
export function liftCharacter(root) {
  mergePrimitives(root);
  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || o.material?.visible === false) return;
    o.material = Array.isArray(o.material) ? o.material.map(characterMaterial) : characterMaterial(o.material);
  });
}
