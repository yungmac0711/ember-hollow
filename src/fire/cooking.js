// Chunk C: stew cooking. The art/assets/props/stew-pot.glb `pot` node hangs on a lit campfire or
// hearth; two mushrooms/glowcaps in → a short cook (pauses if the fire goes out) with steam → one
// stew. The pot is baked to a vertex-coloured InstancedMesh and the `embers` node (emissive
// ember_glow + coal) to an unlit InstancedMesh shown under a cooking pot — glow from emissive
// materials only, never a light. Steam is one shared Points system (18 per pot); a pot also caps
// its fire's sparks at 12 so the fire stays ≤30 particles. 3 draw calls for every pot in the world.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CONFIG } from '../config.js';
import { bakeVertexColors } from '../assets.js';

const CC = CONFIG.cooking;
const MAX = 8, STEAM = 18;
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1);

function steamTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const g = c.getContext('2d'), grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grd.addColorStop(0, 'rgba(255,255,255,0.9)'); grd.addColorStop(0.5, 'rgba(255,255,255,0.35)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 32, 32);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/** Bake emissive parts to one geometry with vertex colour = emissive × intensity (for MeshBasic). */
function bakeGlow(parts) {
  const gs = parts.map((p) => {
    const g = p.geometry.index ? p.geometry.toNonIndexed() : p.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k);
    const e = p.material.emissive.clone().multiplyScalar(Math.min(1.4, p.material.emissiveIntensity ?? 1));
    const n = g.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = Math.min(1, e.r); a[i * 3 + 1] = Math.min(1, e.g); a[i * 3 + 2] = Math.min(1, e.b); }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return g;
  });
  return gs.length ? mergeGeometries(gs) : null;
}

export class Cooking {
  constructor(scene, parts) {
    this.pots = []; // {fire, ingredients: [kind], t, state: 'idle'|'cooking'|'done', slot}
    const has = (p, name) => p.node === name || (p.ancestors || []).includes(name);
    let potGeo = null, emberGeo = null;
    if (parts) {
      potGeo = bakeVertexColors(parts, (p) => has(p, 'pot')).geometry;
      emberGeo = bakeGlow(parts.filter((p) => has(p, 'embers')));
    }
    if (!potGeo) { // fallback: a little iron pot
      const g = new THREE.CylinderGeometry(0.26, 0.2, 0.36, 8); g.translate(0, 0.34, 0);
      potGeo = bakeVertexColors([{ geometry: g, material: new THREE.MeshLambertMaterial({ color: 0x2c2a2a }) }]).geometry;
    }
    if (!emberGeo) { const g = new THREE.CylinderGeometry(0.18, 0.18, 0.04, 8); g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(0.9), 3)); emberGeo = g; }
    this.potMesh = new THREE.InstancedMesh(potGeo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), MAX);
    this.emberMesh = new THREE.InstancedMesh(emberGeo, new THREE.MeshBasicMaterial({ vertexColors: true }), MAX);
    this.potMesh.name = 'stew-pot'; this.emberMesh.name = 'stew-embers';
    for (const m of [this.potMesh, this.emberMesh]) { for (let i = 0; i < MAX; i++) m.setMatrixAt(i, ZERO); m.count = 0; m.frustumCulled = false; scene.add(m); }
    // steam
    const n = MAX * STEAM;
    this.sPos = new Float32Array(n * 3).fill(-999); this.sVel = new Float32Array(n * 3); this.sAge = new Float32Array(n).fill(9); this.sLife = new Float32Array(n).fill(1);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(this.sPos, 3));
    this.steam = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.28, map: steamTexture(), color: 0xdfe6ee, transparent: true, opacity: 0.38, depthWrite: false }));
    this.steam.name = 'steam'; this.steam.frustumCulled = false; this.steam.visible = false;
    scene.add(this.steam);
  }

  potFor(fire) { return this.pots.find((p) => p.fire === fire) || null; }

  hang(fire) {
    if (this.potFor(fire) || this.pots.length >= MAX) return null;
    const slot = [...Array(MAX).keys()].find((i) => !this.pots.some((p) => p.slot === i));
    const pot = { fire, ingredients: [], t: 0, state: 'idle', slot };
    this.pots.push(pot);
    fire.potOn = true; fire.sparkCap = 12;
    this._place(pot);
    return pot;
  }

  /** Remove a pot (its fire was removed). */
  drop(fire) {
    const p = this.potFor(fire); if (!p) return;
    this.potMesh.setMatrixAt(p.slot, ZERO); this.emberMesh.setMatrixAt(p.slot, ZERO);
    this.potMesh.instanceMatrix.needsUpdate = this.emberMesh.instanceMatrix.needsUpdate = true;
    this.pots = this.pots.filter((x) => x !== p);
  }

  _place(pot) {
    const f = pot.fire;
    _m.compose(_p.set(f.pos.x, f.pos.y + 0.04, f.pos.z), _q.identity(), _s.set(1, 1, 1));
    this.potMesh.setMatrixAt(pot.slot, _m);
    this.potMesh.count = Math.max(this.potMesh.count, pot.slot + 1);
    this.emberMesh.count = this.potMesh.count;
    this.potMesh.instanceMatrix.needsUpdate = true;
    this._embers(pot);
  }
  _embers(pot) {
    const on = pot.state === 'cooking' && pot.fire.lit;
    if (on === pot._emb) return; pot._emb = on;
    const f = pot.fire;
    this.emberMesh.setMatrixAt(pot.slot, on ? _m.compose(_p.set(f.pos.x, f.pos.y + 0.02, f.pos.z), _q.identity(), _s.set(0.9, 1, 0.9)) : ZERO);
    this.emberMesh.instanceMatrix.needsUpdate = true;
  }

  /** Add one ingredient; returns true when that starts the cook. */
  add(pot, kind) {
    if (pot.state !== 'idle' || pot.ingredients.length >= CC.ingredients) return false;
    pot.ingredients.push(kind);
    if (pot.ingredients.length >= CC.ingredients) { pot.state = 'cooking'; pot.t = 0; this._embers(pot); return true; }
    return false;
  }

  /** Take the finished stew; the pot stays on the fire for the next batch. */
  take(pot) {
    if (pot.state !== 'done') return false;
    pot.state = 'idle'; pot.ingredients = []; pot.t = 0; this._embers(pot);
    return true;
  }

  /** @returns array of pots that finished this frame */
  update(dt, camPos) {
    const done = [];
    let anySteam = false;
    for (const pot of this.pots) {
      if (pot.state === 'cooking' && pot.fire.lit) {
        pot.t += dt;
        if (pot.t >= CC.seconds) { pot.state = 'done'; done.push(pot); }
      }
      this._embers(pot);
      // steam: busy while cooking (only with the fire lit), a lazy wisp when done
      const rate = pot.state === 'cooking' && pot.fire.lit ? 1 : pot.state === 'done' ? 0.35 : 0;
      const near = Math.hypot(pot.fire.pos.x - camPos.x, pot.fire.pos.z - camPos.z) < 22;
      const base = pot.slot * STEAM, f = pot.fire.pos;
      for (let i = base; i < base + STEAM; i++) {
        this.sAge[i] += dt;
        if (this.sAge[i] >= this.sLife[i]) {
          if (!near || Math.random() > rate) { this.sPos[i * 3 + 1] = -999; this.sAge[i] = this.sLife[i] - 0.1 - Math.random() * 0.3; continue; }
          const a = Math.random() * 6.28, r = Math.random() * 0.16;
          this.sPos[i * 3] = f.x + Math.cos(a) * r; this.sPos[i * 3 + 1] = f.y + 0.62; this.sPos[i * 3 + 2] = f.z + Math.sin(a) * r;
          this.sVel[i * 3] = (Math.random() - 0.5) * 0.15; this.sVel[i * 3 + 1] = 0.35 + Math.random() * 0.3; this.sVel[i * 3 + 2] = (Math.random() - 0.5) * 0.15;
          this.sAge[i] = 0; this.sLife[i] = 1.4 + Math.random() * 1.2;
        }
        if (this.sPos[i * 3 + 1] > -900) {
          anySteam = true;
          this.sPos[i * 3] += this.sVel[i * 3] * dt; this.sPos[i * 3 + 1] += this.sVel[i * 3 + 1] * dt; this.sPos[i * 3 + 2] += this.sVel[i * 3 + 2] * dt;
          this.sVel[i * 3] += (Math.random() - 0.5) * 0.3 * dt;
        }
      }
    }
    this.steam.visible = anySteam;
    if (anySteam) this.steam.geometry.attributes.position.needsUpdate = true;
    const vis = this.pots.some((p) => Math.hypot(p.fire.pos.x - camPos.x, p.fire.pos.z - camPos.z) < 28);
    this.potMesh.visible = vis; this.emberMesh.visible = vis && this.pots.some((p) => p._emb);
    return done;
  }

  // ---- save: one entry per pot; keyOf(fire) → a stable key (hearth piece id / saved fire index)
  serialize(keyOf) {
    return this.pots.map((p) => ({ key: keyOf(p.fire), ing: p.ingredients, t: +p.t.toFixed(1), state: p.state })).filter((p) => p.key != null);
  }
  restore(list, fireOf) {
    for (const d of list || []) {
      const f = fireOf(d.key); if (!f) continue;
      const pot = this.hang(f); if (!pot) continue;
      pot.ingredients = Array.isArray(d.ing) ? d.ing.slice(0, CC.ingredients) : [];
      pot.state = ['idle', 'cooking', 'done'].includes(d.state) ? d.state : 'idle';
      pot.t = +d.t || 0; this._embers(pot);
    }
  }
}
