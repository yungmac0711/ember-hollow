// Art-review screenshots: iPhone landscape 844×390 @2x (1688×780) → screenshots/.
// Usage (from game/, with the dev server on :8931):  node tools/screenshots.mjs
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:8931/';
const OUT = new URL('../screenshots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROME || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const ctx = await browser.newContext({
  viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(BASE + 'index.html?nosw=1', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.ready, null, { timeout: 60000 });
await page.touchscreen.tap(422, 300);
await page.waitForTimeout(1000);

const stats = () => page.evaluate(() => {
  const i = __game.renderer.info.render;
  return { calls: i.calls, tris: i.triangles, activeLights: __game.budget.activeCount, hemi: +__game.hemi.intensity.toFixed(2), hoodUp: __game.wren.hoodUp, wren: __game.wren.status, biscuit: __game.puppy.state };
});
const place = (x, z, lookX, lookZ, pitch = -0.08) => page.evaluate(([x, z, lx, lz, pitch]) => {
  const g = __game, p = g.player;
  p.pos.set(x, g.cave.floorAt(x, z), z); p.vel?.set?.(0, 0, 0);
  p.yaw = Math.atan2(-(lx - x), -(lz - z)); p.pitch = pitch;
}, [x, z, lookX, lookZ, pitch]);
const report = {};

// 1) lit campfire in Lanternmouth with Wren and Biscuit
await page.evaluate(() => {
  const g = __game, THREE = g.scene.constructor; // (vector via existing objects)
  const spot = g.player.pos.clone(); spot.x = 0.6; spot.z = -0.6; spot.y = g.cave.floorAt(spot.x, spot.z);
  g.fires.build(spot, 6);
});
await place(0.6 + 3.6, -0.6 + 2.6, 0.6, -0.6, -0.16);
await page.waitForTimeout(14000);
await place(0.6 + 3.6, -0.6 + 2.6, 0.6, -0.6, -0.16);
await page.waitForTimeout(600);
await page.screenshot({ path: OUT + '01-campfire-wren-biscuit.png' });
report.campfire = await stats();

// 2) crystal chamber (Flintseam Ridge): face the densest wall of clusters
const target = await page.evaluate(() => {
  const g = __game, fl = g.cave.chambers[1];
  const pts = g.dressing.crystals.filter((p) => Math.hypot(p.x - fl.x, p.z - fl.z) < fl.r + 1);
  let best = pts[0], bn = -1;
  for (const p of pts) { const n = pts.filter((q) => Math.hypot(q.x - p.x, q.z - p.z) < 3.5).length; if (n > bn) { bn = n; best = p; } }
  const dx = fl.x - best.x, dz = fl.z - best.z, L = Math.hypot(dx, dz);
  return { x: best.x + dx / L * 5.2, z: best.z + dz / L * 5.2, lx: best.x, lz: best.z };
});
await place(target.x, target.z, target.lx, target.lz, -0.1);
await page.waitForTimeout(5000);
// Wren walks ahead toward the crystals with her lantern (she's normally behind-right of Cam)
await page.evaluate(([lx, lz]) => {
  const g = __game, p = g.player, w = g.wren, dx = lx - p.pos.x, dz = lz - p.pos.z, L = Math.hypot(dx, dz);
  w.pos.set(p.pos.x + dx / L * 2.6 - dz / L * 0.9, 0, p.pos.z + dz / L * 2.6 + dx / L * 0.9);
  w.pos.y = g.cave.floorAt(w.pos.x, w.pos.z);
  w.heading = Math.atan2(dx, dz);
}, [target.lx, target.lz]);
await page.waitForTimeout(150);
await page.screenshot({ path: OUT + '02-crystal-chamber.png' });
report.crystals = await stats();

// 3) torchlit tunnel: Lanternmouth → Glowcap Galleries, looking down the tunnel
const tun = await page.evaluate(() => {
  const g = __game, [a, , b] = g.cave.chambers;
  const at = (u) => ({ x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u });
  return { p: at(0.38), l: at(0.9) };
});
await place(tun.p.x, tun.p.z, tun.l.x, tun.l.z, 0.02);
await page.waitForTimeout(5000);
await place(tun.p.x, tun.p.z, tun.l.x, tun.l.z, 0.02);
await page.waitForTimeout(500);
await page.screenshot({ path: OUT + '03-torchlit-tunnel.png' });
report.tunnel = await stats();

console.log(JSON.stringify({ report, errors }, null, 2));
await browser.close();
