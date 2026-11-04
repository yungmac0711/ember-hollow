// Chunk C: day/night + weather on the surface, per art/STYLE_GUIDE.md §8.2 (exact table values).
// 24-minute cycle: day 10 min, dusk 2, night 10, dawn 2. Dusk/dawn cross-fade with smoothstep (day →
// dusk keyframe → night over the 2-min segment); the sun swaps for the moon at the segment midpoint.
// The sun/moon is the LightBudget's DirectionalLight (one pool slot, drop-the-moon rule in lights.js).
// Cave ↔ surface: everything here is blended over the §8.1 cave ambient by
// b = 1 - smoothstep(0, 6, depthIntoCave) of the camera, so the cave keeps §8.1 exactly.
// Sky dome (3 stops by view-dir Y + sun glow + stars_512 sampled by direction) and rain from
// art/assets/surface/sky_rain.json. Rain is occasional, surface only, a camera-following box.
import * as THREE from 'three';
import { CONFIG } from '../config.js';

export const CYCLE = 1440;
export const T = { dayEnd: 600, duskMid: 660, duskEnd: 720, nightEnd: 1320, dawnMid: 1380, morning: 30 };
const ss = (t) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
const C = (h) => new THREE.Color(h);

// §8.2 table. az: 0 = east (+x), 90 = south (+z), 180 = west (−x); elev in degrees.
const PH = {
  dawn:  { sky: C(0xE8A87C), ground: C(0x3A3040), hemi: 0.6,  dir: C(0xFFB37A), dirI: 1.2,  elev: 10, az: 0,   fog: C(0xC9A08A), dens: 0.020 },
  day:   { sky: C(0x9CC4E8), ground: C(0x4A5A3A), hemi: 0.9,  dir: C(0xFFF1D6), dirI: 2.2,  elev: 50, az: 90,  fog: C(0xA9C2D6), dens: 0.012 },
  dusk:  { sky: C(0xC77A6A), ground: C(0x2E2838), hemi: 0.55, dir: C(0xFF8A4A), dirI: 1.0,  elev: 8,  az: 180, fog: C(0x8A6A78), dens: 0.022 },
  night: { sky: C(0x2A3A5C), ground: C(0x0B0E14), hemi: 0.55, dir: C(0x9FB4D9), dirI: 0.35, elev: 40, az: 120, fog: C(0x1E2636), dens: 0.030 },
};
const NIGHT_DROP = { hemi: 0.7, sky: C(0x33466B) }; // drop-the-moon compensation
// Sky dome stops: dusk / night / rain_night from sky_rain.json; day + dawn derived from the §8.2 row.
const SKY = {
  day:   { zenith: C(0x5D8CC4), horizon: C(0xA9C2D6), ground: C(0x4A5A3A), glow: C(0xFFF1D6), glowAmt: 0.12, stars: 0 },
  dawn:  { zenith: C(0x3B4A6E), horizon: C(0xE8A87C), ground: C(0x3A3040), glow: C(0xFFB37A), glowAmt: 0.55, stars: 0.1 },
  dusk:  { zenith: C(0x2B3A5C), horizon: C(0xC26A4A), ground: C(0x1A2029), glow: C(0xFFB347), glowAmt: 0.65, stars: 0.25 },
  night: { zenith: C(0x0B1020), horizon: C(0x24304A), ground: C(0x0E1117), glow: C(0x9FB4D9), glowAmt: 0.06, stars: 1.0 },
};
const RAIN_NIGHT = { zenith: C(0x141A24), horizon: C(0x2E3742), ground: C(0x0E1117), fog: C(0x2E3742) };
const RAIN_GREY = C(0x8A97A6);

/** Which two keyframes are blending at cycle time t, and how far (k). */
function keyframes(t) {
  if (t < T.dayEnd) return ['day', 'day', 0];
  if (t < T.duskMid) return ['day', 'dusk', ss((t - T.dayEnd) / 60)];
  if (t < T.duskEnd) return ['dusk', 'night', ss((t - T.duskMid) / 60)];
  if (t < T.nightEnd) return ['night', 'night', 0];
  if (t < T.dawnMid) return ['night', 'dawn', ss((t - T.nightEnd) / 60)];
  return ['dawn', 'day', ss((t - T.dawnMid) / 60)];
}
/** DATA_FORMATS time word: day | dusk | night | deep_night (dawn counts as day). */
export function timeWord(t) {
  t = ((t % CYCLE) + CYCLE) % CYCLE;
  if (t < T.dayEnd) return 'day';
  if (t < T.duskEnd) return 'dusk';
  if (t < T.nightEnd) return t >= 840 && t < 1200 ? 'deep_night' : 'night';
  return 'day';
}
/** Sleep is allowed from dusk until the end of dawn. */
export const canSleepAt = (t) => { t = ((t % CYCLE) + CYCLE) % CYCLE; return t >= T.dayEnd; };

const dirFrom = (elev, az, out) => {
  const e = THREE.MathUtils.degToRad(elev), a = THREE.MathUtils.degToRad(az);
  return out.set(Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a));
};

const SKY_VS = `varying vec3 vDir;
void main() { vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`;
const SKY_FS = `uniform vec3 uZenith, uHorizon, uGround, uGlow, uSunDir, uStarCol; uniform float uGlowAmt, uStars, uTime; uniform sampler2D uStarTex;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir); float y = d.y;
  vec3 c = y > 0.0 ? mix(uHorizon, uZenith, pow(smoothstep(0.0, 1.0, y), 0.6)) : mix(uHorizon, uGround, smoothstep(0.0, 0.25, -y));
  float g = max(dot(d, uSunDir), 0.0);
  c += uGlow * uGlowAmt * (pow(g, 6.0) * 0.6 + pow(g, 60.0) * 0.9) * smoothstep(-0.1, 0.12, y);
  if (uStars > 0.01) {
    vec2 uv = vec2(atan(d.z, d.x) / 6.28318, asin(clamp(y, -1.0, 1.0)) / 1.5708) * 4.0;
    vec4 s = texture2D(uStarTex, uv);
    float h = fract(sin(dot(floor(uv * 48.0), vec2(12.9898, 78.233))) * 43758.5453);
    float tw = 0.8 + 0.2 * sin(uTime * 2.0 + h * 6.28318);
    c += uStarCol * s.rgb * s.a * tw * uStars * smoothstep(0.05, 0.4, y);
  }
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;

const RAIN_VS = `attribute float aSpeed; uniform float uTime, uWind, uScale, uOpacity; uniform vec3 uOrigin; uniform vec3 uCenter;
uniform vec4 uRoofs[24]; uniform int uRoofN; varying float vA;
void main() {
  vec3 p = position + vec3(uWind * uTime, -aSpeed * uTime, 0.0);
  vec3 lo = uOrigin - vec3(10.0, 6.0, 10.0);
  p = lo + mod(p - lo, vec3(20.0, 12.0, 20.0));
  float a = uOpacity * (1.0 - smoothstep(uCenter.z, uCenter.z + 1.0, length(p.xz - uCenter.xy)));
  for (int i = 0; i < 24; i++) { if (i >= uRoofN) break; vec4 r = uRoofs[i];
    if (abs(p.x - r.x) < 1.05 && abs(p.z - r.y) < 1.05 && p.y < r.z) a = 0.0; }
  vA = a;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = a > 0.002 ? min(72.0, uScale * 0.45 / max(0.2, -mv.z)) : 0.0;
}`;
const RAIN_FS = `uniform sampler2D uMap; uniform vec3 uColor; varying float vA;
void main() {
  vec2 pc = gl_PointCoord; float u = (pc.x - 0.5) * 15.0 + 0.5;
  if (u < 0.0 || u > 1.0) discard;
  float a = texture2D(uMap, vec2(u, 1.0 - pc.y)).a * vA;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}`;

export class DayNight {
  constructor(scene, cave, budget, { low = false } = {}) {
    this.cave = cave; this.budget = budget; this.low = low;
    this.tod = 120;             // seconds into the cycle (new game: early day)
    this.weather = 'clear'; this.rainK = 0;
    this._wT = 200 + Math.random() * 160; // first spell of weather no sooner than ~3 min in
    this.forceRain = new URLSearchParams(location.search).get('rain') === '1';
    this.b = 0; this.nightness = 0; this.starAlpha = 0;
    const loader = new THREE.TextureLoader();
    // --- sky dome
    const starTex = loader.load('assets/textures/stars_512.png');
    starTex.wrapS = starTex.wrapT = THREE.RepeatWrapping; starTex.generateMipmaps = false; starTex.minFilter = THREE.LinearFilter; starTex.colorSpace = THREE.SRGBColorSpace;
    this.skyU = {
      uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uGround: { value: new THREE.Color() },
      uGlow: { value: new THREE.Color() }, uGlowAmt: { value: 0 }, uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uStars: { value: 0 }, uTime: { value: 0 }, uStarTex: { value: starTex }, uStarCol: { value: C(0xEADFC8) },
    };
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(30, 20, 12),
      new THREE.ShaderMaterial({ uniforms: this.skyU, vertexShader: SKY_VS, fragmentShader: SKY_FS, side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false }));
    this.sky.name = 'sky-dome'; this.sky.renderOrder = -100; this.sky.frustumCulled = false;
    scene.add(this.sky);
    // --- rain (one Points draw call)
    const n = low ? 600 : 1200;
    const pos = new Float32Array(n * 3), spd = new Float32Array(n);
    for (let i = 0; i < n; i++) { pos[i * 3] = Math.random() * 20; pos[i * 3 + 1] = Math.random() * 12; pos[i * 3 + 2] = Math.random() * 20; spd[i] = 9 + Math.random() * 3; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aSpeed', new THREE.BufferAttribute(spd, 1));
    const rainTex = loader.load('assets/textures/rain_streak.png');
    this.rainU = {
      uTime: { value: 0 }, uWind: { value: 0.8 }, uScale: { value: 400 }, uOpacity: { value: 0 }, uOrigin: { value: new THREE.Vector3() },
      uCenter: { value: new THREE.Vector3(cave.clearing.x, cave.clearing.z, cave.clearing.r + 0.5) },
      uRoofs: { value: Array.from({ length: 24 }, () => new THREE.Vector4()) }, uRoofN: { value: 0 },
      uMap: { value: rainTex }, uColor: { value: C(0x9AB0C8) },
    };
    this.rain = new THREE.Points(g, new THREE.ShaderMaterial({ uniforms: this.rainU, vertexShader: RAIN_VS, fragmentShader: RAIN_FS, transparent: true, depthWrite: false, fog: false }));
    this.rain.name = 'rain'; this.rain.frustumCulled = false; this.rain.visible = false;
    scene.add(this.rain);
    this.rainCount = n;
    // scratch
    this._d = new THREE.Vector3(); this._d2 = new THREE.Vector3();
    this._c = { sky: new THREE.Color(), ground: new THREE.Color(), fog: new THREE.Color(), dir: new THREE.Color(), z: new THREE.Color(), h: new THREE.Color(), gr: new THREE.Color(), gl: new THREE.Color() };
    this.surf = { hemi: 0, dens: 0 };
  }

  get time() { return timeWord(this.tod); }
  get phaseName() { const [a, b, k] = keyframes(this.tod); return k < 0.5 ? a : b; }

  /** Roof cells over which rain must not fall: [{x, z, top}] (from the BuildSystem). */
  setRoofs(list) {
    const u = this.rainU.uRoofs.value; let i = 0;
    for (const r of list) { if (i >= u.length) break; u[i++].set(r.x, r.z, r.top, 0); }
    this.rainU.uRoofN.value = i;
  }

  _updateWeather(dt) {
    if (this.forceRain) this.weather = 'rain';
    else if ((this._wT -= dt) <= 0) {
      if (this.weather === 'rain') { this.weather = 'clear'; this._wT = 300 + Math.random() * 300; }
      else if (Math.random() < 0.45) { this.weather = 'rain'; this._wT = 120 + Math.random() * 150; }
      else this._wT = 180 + Math.random() * 240;
    }
    const target = this.weather === 'rain' ? 1 : 0;
    this.rainK += Math.sign(target - this.rainK) * Math.min(Math.abs(target - this.rainK), dt / 25); // ~25 s tween
  }

  /**
   * @param camPos   camera world position
   * @param caveFog  {density} the §8.1 cave fog density this frame (main's fog logic)
   * @param fireK    AmbientController.k (0 at a lit fire … 1 exploring) — §8.1 rule on the surface at night
   */
  update(dt, { advance = true, camPos, hemi, fog, scene, fireK = 1, caveDensity, renderer }) {
    if (advance) { this.tod = (this.tod + dt) % CYCLE; this._updateWeather(dt); }
    this.skyU.uTime.value += dt; this.rainU.uTime.value = (this.rainU.uTime.value + dt) % 600;
    const t = this.tod, [ka, kb, k] = keyframes(t);
    const A = PH[ka], B = PH[kb], c = this._c;
    const nightW = (ka === 'night' ? 1 - k : 0) + (kb === 'night' ? k : 0);
    const dayW = (ka === 'day' ? 1 - k : 0) + (kb === 'day' ? k : 0);
    this.nightness = nightW;
    const rk = this.rainK;
    const b = this.b = 1 - ss(this.cave.depthIntoCave(camPos.x, camPos.z) / 6);
    const drop = this.budget.moonDropped * nightW;

    // ---- surface hemisphere + fog
    c.sky.lerpColors(A.sky, B.sky, k).lerp(NIGHT_DROP.sky, drop);
    c.ground.lerpColors(A.ground, B.ground, k);
    let hI = THREE.MathUtils.lerp(A.hemi, B.hemi, k);
    hI = THREE.MathUtils.lerp(hI, NIGHT_DROP.hemi, drop);
    hI = THREE.MathUtils.lerp(hI, THREE.MathUtils.lerp(0.45, hI, fireK), nightW); // §8.1 campfire rule at night
    hI *= 1 - 0.2 * rk * dayW;                                                       // rain: day hemi ×0.8
    c.fog.lerpColors(A.fog, B.fog, k);
    let dens = THREE.MathUtils.lerp(A.dens, B.dens, k) * (1 + 0.6 * rk);           // rain: fog ×1.6
    const grey = this._c.gl.copy(RAIN_GREY).lerp(RAIN_NIGHT.fog, nightW);
    c.sky.lerp(grey, 0.45 * rk); c.fog.lerp(grey, 0.6 * rk);
    this.surf.hemi = hI; this.surf.dens = dens;

    // ---- blend over the cave (§8.1 values already applied by AmbientController + main)
    if (b > 0.001) {
      hemi.intensity = THREE.MathUtils.lerp(hemi.intensity, hI, b);
      hemi.color.lerp(c.sky, b); hemi.groundColor.lerp(c.ground, b);
      fog.color.lerp(c.fog, b);
      fog.density = THREE.MathUtils.lerp(caveDensity, dens, b);
    } else fog.density = caveDensity;
    scene.background.copy(fog.color);

    // ---- sun / moon (one pool slot; lights.js handles the slot + drop-the-moon)
    const moon = t >= T.duskMid && t < T.dawnMid;
    const swap = Math.min(1, Math.abs(t - T.duskMid) / 6, Math.abs(t - T.dawnMid) / 6);
    let dirI, dir = this._d;
    if (moon) {
      const mk = t < T.duskEnd ? k : t >= T.nightEnd ? 1 - k : 1;
      dirI = PH.night.dirI * mk; c.dir.copy(PH.night.dir); dirFrom(PH.night.elev, PH.night.az, dir);
    } else {
      dirI = THREE.MathUtils.lerp(A.dirI, B.dirI, k); c.dir.lerpColors(A.dir, B.dir, k);
      dirFrom(A.elev, A.az, dir).lerp(dirFrom(B.elev, B.az, this._d2), k).normalize();
    }
    dirI *= swap * (1 - 0.5 * rk);
    this.budget.isMoon = moon;
    this.budget.sunTarget = dirI * b;
    const sun = this.budget.sun;
    sun.color.copy(c.dir);
    sun.position.copy(dir).multiplyScalar(20);

    // ---- sky dome
    const S = (n) => SKY[n];
    const sa = S(ka), sb = S(kb);
    c.z.lerpColors(sa.zenith, sb.zenith, k); c.h.lerpColors(sa.horizon, sb.horizon, k); c.gr.lerpColors(sa.ground, sb.ground, k);
    // rain: desaturate toward #8A97A6 by day, rain_night set by night
    const rzC = this._rz || (this._rz = new THREE.Color()), rhC = this._rh || (this._rh = new THREE.Color());
    rzC.copy(RAIN_GREY).lerp(RAIN_NIGHT.zenith, nightW); rhC.copy(RAIN_GREY).lerp(RAIN_NIGHT.horizon, nightW);
    c.z.lerp(rzC, 0.75 * rk); c.h.lerp(rhC, 0.75 * rk);
    const su = this.skyU;
    su.uZenith.value.copy(c.z); su.uHorizon.value.copy(c.h); su.uGround.value.copy(c.gr);
    su.uGlow.value.lerpColors(sa.glow, sb.glow, k); su.uGlowAmt.value = THREE.MathUtils.lerp(sa.glowAmt, sb.glowAmt, k) * (1 - rk);
    su.uSunDir.value.copy(moon ? dirFrom(PH.night.elev, PH.night.az, this._d2) : dir);
    this.starAlpha = THREE.MathUtils.lerp(sa.stars, sb.stars, k) * (1 - rk);
    su.uStars.value = this.starAlpha;
    const depth = this.cave.depthIntoCave(camPos.x, camPos.z);
    this.sky.visible = depth < 24;
    this.sky.position.copy(camPos);

    // ---- rain box (surface only)
    const ro = rk * (CONFIG.weather?.rainOpacity ?? 0.35) * ss((4 - depth) / 6);
    this.rain.visible = ro > 0.01;
    if (this.rain.visible) {
      this.rainU.uOpacity.value = ro; this.rainU.uOrigin.value.copy(camPos);
      if (renderer) { const h = renderer.getDrawingBufferSize(this._sz || (this._sz = new THREE.Vector2())).y; this.rainU.uScale.value = h * 0.5 * this._proj; }
    }
  }
  setProjection(camera) { this._proj = camera.projectionMatrix.elements[5]; }

  // ---- save
  serialize() { return { tod: +this.tod.toFixed(1), weather: this.weather, rainK: +this.rainK.toFixed(2), wT: Math.round(this._wT) }; }
  restore(d) {
    if (!d) return;
    if (Number.isFinite(d.tod)) this.tod = ((d.tod % CYCLE) + CYCLE) % CYCLE;
    if (d.weather === 'rain' || d.weather === 'clear') this.weather = d.weather;
    if (Number.isFinite(d.rainK)) this.rainK = d.rainK;
    if (Number.isFinite(d.wT)) this._wT = d.wT;
  }
}
