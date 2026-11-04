#!/usr/bin/env node
// M1 screenshots: 4 landscape shots at 1688x780 (iPhone landscape 844x390 @2x) into screenshots/m1-*.png.
// Needs the game served at BASE (default http://localhost:8931/) and playwright.
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8931/';
const OUT = new URL('../screenshots/', import.meta.url).pathname;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(BASE + 'index.html?nosw=1', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.ready, null, { timeout: 60000 });
const b = await page.$eval('#title-new', (e) => { const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
await page.touchscreen.tap(b[0], b[1]);
await page.waitForTimeout(1500);
// clean frames: hide the touch controls / hotbar (Wren's speech bubble and the area title stay)
await page.addStyleTag({ content: '#buttons,#hotbar,#tip,#btn-pause,#warmth,#joystick,#crosshair,#request,#objective,#hint,.toast,#toast{display:none!important}' });
const shot = async (name, setup, ms = 2500) => { await page.evaluate(setup); await page.waitForTimeout(ms); await page.screenshot({ path: OUT + name }); console.log('saved', name); };

// shared helpers inside the page
await page.evaluate(() => {
  const g = window.__game, B = g.build, G = 2;
  window.__h = {
    stand(x, z, tx, tz, pitch = -0.12) { const p = g.player; p.pos.set(x, g.cave.floorAt(x, z), z); p.yaw = Math.atan2(-(tx - x), -(tz - z)); p.pitch = pitch; },
    put(type, ax, az, fx, fz, rot = 0) { // plan a piece aiming at (ax, az) from the direction (fx, fz), add it without cost
      B.select(type); B.rot = rot; const L = Math.hypot(fx, fz); fx /= L; fz /= L;
      const slot = (window.__PIECES || {})[type]?.slot;
      const d = type === 'wall' || type === 'door' || type === 'window' ? 1.6 : 2.2;
      const pl = { pos: new g.THREE.Vector3(ax - fx * d, 0, az - fz * d), forward: new g.THREE.Vector3(fx, 0, fz), pitch: -0.3, yaw: Math.atan2(-fx, -fz), inventory: g.player.inventory };
      pl.pos.y = g.cave.floorAt(pl.pos.x, pl.pos.z);
      const t = B._plan(pl); if (!t.ok) return t.why || 'no'; return B._add(t);
    },
    friends(wx, wz, dx, dz) { g.wren.pos.set(wx, g.cave.floorAt(wx, wz), wz); g.puppy.pos.set(dx, g.cave.floorAt(dx, dz), dz); },
  };
});

// 1. a built cabin in the clearing, hearth lit, Wren and Biscuit inside (evening)
const cabin = await page.evaluate(() => {
  const g = __game, h = __h, cl = g.cave.clearing, G = 2, out = [];
  g.dayNight.forceRain = false; g.dayNight.weather = 'clear'; g.dayNight.rainK = 0; g.dayNight.tod = 830;
  const a = Math.round((cl.x - 3) / G), bj = Math.round((cl.z + 1) / G); // cells (a,bj) and (a+1,bj)
  const X = (i) => i * G, Z = (j) => j * G;
  g.build.toggle();
  for (const i of [a, a + 1]) out.push(h.put('floor', X(i), Z(bj), 0, -1));
  // back walls (−z), side walls; a window on the right; door on the front-left, front-right left open
  out.push(h.put('wall', X(a), Z(bj) - 1, 0, -1)); out.push(h.put('window', X(a + 1), Z(bj) - 1, 0, -1));
  out.push(h.put('wall', X(a) - 1, Z(bj), -1, 0)); out.push(h.put('wall', X(a + 1) + 1, Z(bj), 1, 0));
  out.push(h.put('door', X(a), Z(bj) + 1, 0, 1));
  for (const i of [a, a + 1]) out.push(h.put('roof', X(i), Z(bj), 0, -1));
  const hearth = h.put('hearth', X(a + 1), Z(bj), 0, -1); out.push(hearth);
  out.push(h.put('woven_rug', X(a), Z(bj), 0, -1));
  g.build.toggle();
  if (hearth?.fire) hearth.fire.addWood(4);
  const door = g.build.pieces.find((p) => p.type === 'door'); if (door) door.openTarget = 1;
  h.friends(X(a) + 0.3, Z(bj) - 0.1, X(a + 1) - 0.2, Z(bj) + 0.5);
  h.stand(X(a) + 2.3, Z(bj) + 5.2, X(a) + 0.6, Z(bj), -0.1);
  g.ambient.sayNow?.('Our own walls, a fire in the hearth. Biscuit, we live here now.', 'shot');
  return out.map((p) => typeof p === 'string' ? p : p.type);
});
console.log('cabin', JSON.stringify(cabin));
await page.waitForTimeout(6000);
await page.evaluate(() => { const g = __game; const p = g.build.pieces.find((q) => q.type === 'hearth'); g.wren.pos.set(p.x - 1.3, g.wren.pos.y, p.z + 0.1); g.puppy.pos.set(p.x - 0.6, g.puppy.pos.y, p.z + 0.8); });
await page.waitForTimeout(1500);
await page.screenshot({ path: OUT + 'm1-cabin-hearth.png' }); console.log('saved m1-cabin-hearth.png');

// 2. the clearing at night, stars out (looking up over the trees)
await shot('m1-clearing-night.png', () => {
  const g = __game, cl = g.cave.clearing, h = __h;
  g.dayNight.tod = 960; g.dayNight.weather = 'clear'; g.dayNight.rainK = 0;
  h.stand(cl.x + 6, cl.z - 5, cl.x - 4, cl.z + 6, 0.32);
  h.friends(cl.x + 4.2, cl.z - 2.6, cl.x + 5.2, cl.z - 3.2);
}, 4000);

await page.evaluate((v) => { window.__DYAW = v; }, +(process.env.DYAW || 0.35));
// 3. the Glowmere with wisps (lantern on, wisps drifting over the water)
await shot('m1-glowmere.png', () => {
  const g = __game, s = g.glowmere.seat, L = g.glowmere.chamber.lake, h = __h;
  const ax = s.stand.x - L.x, az = s.stand.z - L.z, d = Math.hypot(ax, az);
  // low on the shore, looking across the water past the glowcaps
  h.stand(L.x + ax / d * (L.r + 1.4), L.z + az / d * (L.r + 1.4), L.x - az / d * 0.8, L.z + ax / d * 0.8, -0.16);
  h.friends(s.stand.x + 1.2, s.stand.z + 0.4, s.stand.x + 1.8, s.stand.z - 0.4);
}, 5000);

// 4. a cozy interaction: sitting with Wren by the Glowmere (Biscuit at their feet), Wren talking
await shot('m1-cozy-sit.png', () => { const DYAW = +(window.__DYAW || 0);
  const g = __game, s = g.glowmere.seat, h = __h;
  h.stand(s.stand.x, s.stand.z, s.pos.x, s.pos.z);
  g.wren.pos.set(s.wren.pos.x, s.wren.pos.y, s.wren.pos.z);
  g.puppy.pos.set(s.stand.x + 0.4, g.cave.floorAt(s.stand.x + 0.4, s.stand.z), s.stand.z);
  g.sitDown(s);
  setTimeout(() => { g.player.yaw += DYAW; }, 1500); // turn the view a touch toward Wren
}, 6000);
console.log(errors.length ? 'errors: ' + errors.join(' | ') : 'no console errors');
await browser.close();
