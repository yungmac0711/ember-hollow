// Chunk D: the Glowmere — an underground lake off the Hushing Pools, built from art/assets/glowmere.
// Lit by emissive glow only (no new lights): glowcap clusters, reed tips, lily blooms and the
// crystals in shore_rock_2 are unlit vertex-coloured glow; the water is the glowmere.json material
// (Lambert #1E4A5C, emissive #0F3A4A pulsing 0.8–1.2 over 4 s, opacity 0.82, no depth write).
// Draw calls: plain props 1 + glow props 1 + water 1 + wisps 1 (+ the shared firefly Points 1).
// A peaceful sit spot: a flat shore rock facing the water (Cam and Wren sit, the camera eases out).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from './noise.js';

const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _e = new THREE.Euler();
const mat4 = (x, y, z, yaw = 0, s = 1, tilt = 0) => new THREE.Matrix4().compose(_v.set(x, y, z), _q.setFromEuler(_e.set(tilt, yaw, 0, 'YXZ')), _s.set(s, s, s));

/** Split loadParts output into vertex-coloured plain / glow geometries under matrix m. */
function bake(parts, m, plain, glow, glowGain = 1) {
  for (const p of parts || []) {
    const g = p.geometry.index ? p.geometry.toNonIndexed() : p.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    g.applyMatrix4(m);
    const em = p.material.emissive && p.material.emissive.getHex() ? p.material.emissive : null;
    const c = em ? em.clone().multiplyScalar(0.55 * glowGain * Math.min(1.5, p.material.emissiveIntensity ?? 1)) : p.material.color;
    const n = g.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    (em ? glow : plain).push(g);
  }
}

function spriteTex(url) {
  const t = new THREE.TextureLoader().load(url);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Glowmere {
  constructor(scene, cave, seed, P, colliders) {
    this.cave = cave; this.scene = scene;
    const c = this.chamber = cave.chambers.find((ch) => ch.id === 'glowmere');
    const L = this.lake = c.lake;
    const wy = this.waterY = cave.waterY(c);
    const rng = mulberry32((seed ^ 0x61e3) >>> 0);
    const plain = [], glow = [];
    this.group = new THREE.Group(); this.group.name = 'glowmere';
    // direction from the lake toward the tunnel mouth (Hushing Pools side): the sit spot looks back over the water
    const hush = cave.chambers.find((ch) => ch.id === 'hushing');
    const tdx = hush.x - L.x, tdz = hush.z - L.z, tl = Math.hypot(tdx, tdz);
    const tu = { x: tdx / tl, z: tdz / tl };
    const shore = (ang, rr) => { const x = L.x + Math.cos(ang) * rr, z = L.z + Math.sin(ang) * rr; return { x, z, y: cave.floorAt(x, z), f: cave.field(x, z) }; };
    const tunnelAng = Math.atan2(tu.z, tu.x);

    // --- sit rock: a flat shore_rock_1 on the tunnel side, long axis across the view ---------------
    const sr = shore(tunnelAng + 0.35, L.r + 0.7);
    const seatYaw = Math.atan2(L.x - sr.x, L.z - sr.z); // direction rock → lake centre (atan2(dx, dz))
    bake(P.rock1, mat4(sr.x, sr.y - 0.04, sr.z, seatYaw, 0.85), plain, glow); // long axis (local X) across the view
    const seatTop = sr.y - 0.04 + 0.3 * 0.85;
    const fx = Math.sin(seatYaw), fz = Math.cos(seatYaw), rx = Math.cos(seatYaw), rz = -Math.sin(seatYaw);
    // Cam on the left half, Wren on the right; Cam's player yaw faces the lake (forward = (-sin, -cos))
    this.seat = {
      id: 'glowmere-rock',
      pos: new THREE.Vector3(sr.x - rx * 0.8, seatTop, sr.z - rz * 0.8),
      yaw: Math.atan2(-fx, -fz),
      wren: { pos: new THREE.Vector3(sr.x + rx * 0.45, seatTop, sr.z + rz * 0.45), heading: seatYaw },
      stand: new THREE.Vector3(sr.x - fx * 1.1, 0, sr.z - fz * 1.1),
    };
    this.seat.stand.y = cave.floorAt(this.seat.stand.x, this.seat.stand.z);
    colliders?.circle(sr.x - rx * 0.35, sr.z - rz * 0.35, 0.5);

    // --- shore rocks around the rim (some with crystals: shore_rock_2) + two half-sunk in the water ---
    const rocks = [];
    for (let i = 0; i < 9; i++) {
      const a = tunnelAng + 1.0 + i * (Math.PI * 2 - 1.6) / 9 + (rng() - 0.5) * 0.3;
      const s = shore(a, L.r + 0.4 + rng() * 0.9);
      if (s.f < 0.6) continue;
      const k = 0.6 + rng() * 0.5, yaw = a + Math.PI / 2 + (rng() - 0.5) * 0.6;
      bake(i % 2 ? P.rock2 : P.rock1, mat4(s.x, s.y - 0.06, s.z, yaw, k), plain, glow, 1.6);
      rocks.push(s); colliders?.circle(s.x, s.z, 0.5 * k);
    }
    for (const [a, rr] of [[tunnelAng + 2.4, L.r * 0.55], [tunnelAng - 2.2, L.r * 0.45]]) { // crystals in the water
      const x = L.x + Math.cos(a) * rr, z = L.z + Math.sin(a) * rr;
      bake(P.rock2, mat4(x, wy - 0.18, z, a, 0.75), plain, glow, 1.8);
    }
    // --- glowcap clusters on the shore and up the walls ---------------------------------------------
    const caps = [P.cap1, P.cap2, P.cap3];
    this.caps = [];
    for (let i = 0, n = 0; i < 80 && n < 14; i++) {
      const a = rng() * Math.PI * 2, rr = c.r * (0.25 + rng() * 0.75);
      const x = c.x + Math.cos(a) * rr, z = c.z + Math.sin(a) * rr, f = cave.field(x, z);
      if (f < 0.4 || f > 2.6 || cave.lakeAt(x, z, 0.5)) continue;
      if (Math.hypot(x - this.seat.pos.x, z - this.seat.pos.z) < 1.4) continue;
      const y = cave.floorAt(x, z);
      bake(caps[n % 3], mat4(x, y - 0.02, z, rng() * 6.28, 1.1 + rng() * 0.9), plain, glow, 1.4);
      this.caps.push(new THREE.Vector3(x, y, z)); n++;
    }
    // --- glow reeds in the shallows -----------------------------------------------------------------
    for (let i = 0; i < 12; i++) {
      const a = rng() * Math.PI * 2;
      if (Math.abs(Math.atan2(Math.sin(a - tunnelAng - 0.35), Math.cos(a - tunnelAng - 0.35))) < 0.35) continue; // keep the view clear
      const rr = L.r - 0.3 + rng() * 0.6, x = L.x + Math.cos(a) * rr, z = L.z + Math.sin(a) * rr;
      bake(P.reeds, mat4(x, Math.min(cave.floorAt(x, z), wy) - 0.05, z, rng() * 6.28, 0.9 + rng() * 0.6), plain, glow, 1.3);
    }
    // --- lily pads floating on the water ------------------------------------------------------------
    for (let i = 0; i < 10; i++) {
      const a = rng() * Math.PI * 2, rr = Math.sqrt(rng()) * (L.r - 1.2);
      bake(i % 3 === 0 ? P.lily1 : P.lily2, mat4(L.x + Math.cos(a) * rr, wy + 0.004, L.z + Math.sin(a) * rr, rng() * 6.28, 0.8 + rng() * 0.6), plain, glow, 1.5);
    }
    // --- the message-in-a-jar spot (note_glowmere_wish: "In a stoppered jar on the lakeshore") -------
    const js = shore(tunnelAng - 0.55, L.r + 0.5);
    this.jarSpot = { x: js.x, z: js.z, y: js.y, yaw: Math.atan2(L.x - js.x, L.z - js.z) };

    if (plain.length) {
      this.plain = new THREE.Mesh(mergeGeometries(plain), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
      this.plain.name = 'glowmere-props'; this.group.add(this.plain);
    }
    if (glow.length) {
      this.glowMat = new THREE.MeshBasicMaterial({ vertexColors: true });
      this.glow = new THREE.Mesh(mergeGeometries(glow), this.glowMat);
      this.glow.name = 'glowmere-glow'; this.group.add(this.glow);
    }
    for (const m of [this.plain, this.glow]) if (m) { m.matrixAutoUpdate = false; m.geometry.computeBoundingSphere(); }

    // --- water: water_plane_tile (4×4 m) tiled 3×3 over the lake, clipped to the lake disc ----------
    const tileGeo = P.water?.find((p) => p.geometry)?.geometry;
    const tiles = [];
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const g = (tileGeo || new THREE.PlaneGeometry(4, 4).rotateX(-Math.PI / 2)).clone();
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
      g.applyMatrix4(mat4(L.x + i * 4, wy, L.z + j * 4)); tiles.push(g.index ? g.toNonIndexed() : g);
    }
    this.waterMat = new THREE.MeshLambertMaterial({ color: 0x1e4a5c, emissive: 0x0f3a4a, emissiveIntensity: 1, transparent: true, opacity: 0.82, depthWrite: false, flatShading: true });
    const lake = L;
    this.waterMat.onBeforeCompile = (sh) => { // clip the tiles to a soft-edged disc (the shore hides the rim)
      sh.uniforms.uLake = { value: new THREE.Vector3(lake.x, lake.z, lake.r + 0.6) };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vWXZ;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vWXZ;\nuniform vec3 uLake;')
        .replace('void main() {', 'void main() {\n\tif (distance(vWXZ, uLake.xy) > uLake.z) discard;');
    };
    this.waterMat.customProgramCacheKey = () => 'glowmere-water';
    this.water = new THREE.Mesh(mergeGeometries(tiles), this.waterMat);
    this.water.name = 'glowmere-water'; this.water.renderOrder = 2; this.water.matrixAutoUpdate = false;
    this.group.add(this.water);
    colliders?.circle(L.x, L.z, L.r - 0.55); // Cam and the companions stay on the shore

    // --- wisps (glowmere.json: 6, 0.25 m, additive #7FE3FF, 0.8; figure-8 lissajous r 1.5–3, speed 0.3, bob 0.4)
    const N = 6;
    this.wisps = [];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + rng() * 0.5, rr = rng() * (L.r - 1.5);
      this.wisps.push({ cx: L.x + Math.cos(a) * rr, cz: L.z + Math.sin(a) * rr, cy: wy + 0.7 + rng() * 0.8,
        R: 1.5 + rng() * 1.5, ph: rng() * 6.28, dir: rng() < 0.5 ? 1 : -1, pull: 0 });
    }
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    this.wispPts = new THREE.Points(wg, new THREE.PointsMaterial({ map: spriteTex('assets/textures/wisp_sprite.png'), color: 0x7fe3ff, size: 0.25, sizeAttenuation: true,
      transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.wispPts.name = 'glowmere-wisps'; this.wispPts.frustumCulled = false; this.wispPts.renderOrder = 3;
    this.group.add(this.wispPts);
    this.t = 0; this.pulse = 1; this.near = false; this.pull = 0;
    scene.add(this.group);
  }

  /** Is this point within the grotto (for triggers, fireflies and perf hiding)? */
  weight(pos) { const c = this.chamber; return 1 - THREE.MathUtils.smoothstep(Math.hypot(pos.x - c.x, pos.z - c.z), c.r, c.r + 4); }

  /** @param env {lanternOn: 0..1, sitting: bool} */
  update(dt, playerPos, env = {}) {
    const c = this.chamber, d = Math.hypot(playerPos.x - c.x, playerPos.z - c.z);
    this.near = d < c.r + 22;
    this.group.visible = this.near; // whole grotto off from the far side of the cave (fog hides it anyway)
    // ...and its own cave floor/ceiling meshes too (they'd otherwise pass the frustum test from Lanternmouth)
    if (!this._caveM) this._caveM = ['cave-floor-glowmere', 'cave-ceiling-glowmere', 'lore-jar', 'lore-jar-glow'].map((n) => this.scene.getObjectByName(n)).filter(Boolean);
    for (const m of this._caveM) m.visible = this.near;
    if (!this.near) return;
    this.t += dt;
    // water: pulse emissive 0.8–1.2 over 4 s (cheapest option in glowmere.json)
    this.waterMat.emissiveIntensity = 1 + 0.2 * Math.sin(this.t * Math.PI * 2 / 4);
    if (this.glowMat) this.glowMat.color.setScalar(0.92 + 0.08 * Math.sin(this.t * 0.9));
    // wisps drift toward Cam while Wren's lantern is lit — and closer still when Cam sits still
    const want = Math.min(1, (env.lanternOn || 0) * 0.45 + (env.sitting ? 0.45 : 0)) * (d < c.r + 2 ? 1 : 0);
    this.pull += (want - this.pull) * Math.min(1, dt * 0.4);
    const a = this.wispPts.geometry.attributes.position;
    for (let i = 0; i < this.wisps.length; i++) {
      const w = this.wisps[i], t = this.t * 0.3 * w.dir + w.ph;
      let x = w.cx + Math.sin(t) * w.R, z = w.cz + Math.sin(2 * t) * w.R * 0.5;
      const y0 = w.cy + Math.sin(this.t * 0.7 + w.ph * 2) * 0.4;
      // pulled toward a point ~1.6 m in front of Cam at head height (never right on top of them)
      const k = this.pull * (0.5 + 0.5 * ((i % 3) / 2));
      const tx = playerPos.x + (this.lake.x - playerPos.x) * 0.25, tz = playerPos.z + (this.lake.z - playerPos.z) * 0.25;
      x += (tx - x) * k; z += (tz - z) * k;
      const y = y0 + ((playerPos.y + 1.3) - y0) * k * 0.6;
      a.setXYZ(i, x, Math.max(y, this.waterY + 0.25), z);
    }
    a.needsUpdate = true;
  }
}

/**
 * Fireflies (glowmere.json): one shared Points draw, a 12×3×12 m box that follows Cam (points wrap).
 * Counts: caves 0, surface at dusk 40 (#FFD27A), the grotto 25 (#BFF4FF). Blink: smooth 0..1 pulse,
 * 2–4 s period, random phase — done through vertex colours (additive blending: colour = brightness).
 */
export class Fireflies {
  constructor(scene, seed) {
    const N = this.max = 40, rng = mulberry32((seed ^ 0xf1f1) >>> 0);
    this.p = []; for (let i = 0; i < N; i++) this.p.push({ x: rng() * 12, y: rng() * 3, z: rng() * 12, per: 2 + rng() * 2, ph: rng(), vx: (rng() - 0.5) * 0.3, vz: (rng() - 0.5) * 0.3, vy: (rng() - 0.5) * 0.1 });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    this.mat = new THREE.PointsMaterial({ map: spriteTex('assets/textures/firefly_sprite.png'), size: 0.08, sizeAttenuation: true, vertexColors: true,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.points = new THREE.Points(g, this.mat);
    this.points.name = 'fireflies'; this.points.frustumCulled = false; this.points.renderOrder = 3; this.points.visible = false;
    this.col = new THREE.Color(); this.t = 0; this.count = 0; this.k = 0;
    scene.add(this.points);
  }
  /** mode: 'grotto' | 'dusk' | null, k: 0..1 fade */
  update(dt, pos, mode, k = 1) {
    this.k += ((mode ? k : 0) - this.k) * Math.min(1, dt * 0.8);
    const n = mode === 'grotto' ? 25 : mode === 'dusk' ? 40 : this.count;
    if (mode) { this.count = n; this.col.set(mode === 'grotto' ? 0xbff4ff : 0xffd27a); }
    this.points.visible = this.k > 0.02 && this.count > 0;
    if (!this.points.visible) return;
    this.t += dt;
    const P = this.points.geometry.attributes.position, C = this.points.geometry.attributes.color;
    const ox = pos.x - 6, oy = pos.y - 0.3, oz = pos.z - 6, w = (v, m) => ((v % m) + m) % m;
    for (let i = 0; i < this.count; i++) {
      const f = this.p[i];
      f.x += f.vx * dt; f.y += f.vy * dt; f.z += f.vz * dt;
      if (Math.random() < dt * 0.3) { f.vx = (Math.random() - 0.5) * 0.3; f.vz = (Math.random() - 0.5) * 0.3; f.vy = (Math.random() - 0.5) * 0.1; }
      // positions wrap inside the box anchored on Cam's grid, so the swarm stays put as Cam walks
      P.setXYZ(i, ox + w(f.x - ox, 12), oy + w(f.y, 3), oz + w(f.z - oz, 12));
      const s = 0.5 - 0.5 * Math.cos(((this.t / f.per + f.ph) % 1) * Math.PI * 2);
      const b = s * s * (3 - 2 * s) * this.k;
      C.setXYZ(i, this.col.r * b, this.col.g * b, this.col.b * b);
    }
    this.points.geometry.setDrawRange(0, this.count);
    P.needsUpdate = true; C.needsUpdate = true;
  }
}
