#!/usr/bin/env node
// Headless smoke test: loads the game in an emulated iPhone (landscape, touch), checks for console
// errors, plays a scripted run (gather → light a fire → refuel → chat), and saves screenshots.
// Needs the game served at BASE (default http://localhost:8931/) and `npm i` (playwright).
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:8931/';
const OUT = new URL('../docs/', import.meta.url).pathname;
mkdirSync(OUT + 'test-output', { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const ctx = await browser.newContext({
  viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
});
const page = await ctx.newPage();
const errors = [], warnings = [], failed = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); if (m.type() === 'warning') warnings.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('requestfailed', (r) => failed.push(r.url() + ' ' + r.failure()?.errorText));
page.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });

await page.goto(BASE + 'index.html?fps=1' + (process.env.QUERY ? '&' + process.env.QUERY : ''), { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.ready, null, { timeout: 60000 });
await page.screenshot({ path: OUT + 'test-output/01-start.png' });
await page.touchscreen.tap(422, 300); // "Tap to begin"
await page.waitForTimeout(1500);
await page.screenshot({ path: OUT + 'test-output/02-spawn.png' });

// Touch controls: drag joystick (left) and look (right) with real touch events via CDP
const cdp = await ctx.newCDPSession(page);
const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
const before = await page.evaluate(() => ({ x: __game.player.pos.x, z: __game.player.pos.z, yaw: __game.player.yaw }));
await touch('touchStart', [{ x: 150, y: 280, id: 1 }, { x: 600, y: 200, id: 2 }]);
for (let i = 1; i <= 20; i++) {
  await touch('touchMove', [{ x: 150, y: 280 - i * 3, id: 1 }, { x: 600 + i * 4, y: 200, id: 2 }]);
  await page.waitForTimeout(30);
}
await page.waitForTimeout(600);
await touch('touchEnd', []);
const after = await page.evaluate(() => ({ x: __game.player.pos.x, z: __game.player.pos.z, yaw: __game.player.yaw }));
const moved = Math.hypot(after.x - before.x, after.z - before.z);
const turned = Math.abs(after.yaw - before.yaw);

// Scripted gameplay through the real systems: walk to items and press Interact.
const result = await page.evaluate(async () => {
  const g = __game, wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const pressInteract = async () => { g.input.pressed.add('interact'); await wait(80); };
  const collect = async (kind, n) => {
    for (let k = 0; k < n; k++) {
      const it = g.items.list.filter((i) => i.alive && i.kind === kind)
        .sort((a, b) => a.pos.distanceTo(g.player.pos) - b.pos.distanceTo(g.player.pos))[0];
      if (!it) return;
      g.player.pos.set(it.pos.x + 0.6, it.pos.y, it.pos.z + 0.6);
      g.player.yaw = Math.atan2(0.6, 0.6); // face the item
      await wait(80); await pressInteract();
    }
  };
  await collect('wood', 7); await collect('flint', 1); await collect('stone', 1);
  // back to Lanternmouth to light the fire
  const c = g.cave.chambers[0];
  g.player.pos.set(c.x - 1.5, g.cave.floorAt(c.x - 1.5, c.z + 1), c.z + 1);
  g.player.yaw = -1.1; g.player.pitch = -0.32;
  await wait(200); await pressInteract();
  const fire = g.fires.fires[0];
  await wait(300); await pressInteract(); // add one wood
  return { inv: { ...g.player.inventory }, fires: g.fires.fires.length, fuel: fire ? Math.round(fire.fuel) : 0, ctx: g.gameState() };
});

await page.evaluate(() => { // step back so the fire, Wren and Biscuit are framed
  const g = __game, f = g.fires.fires[0]; if (!f) return;
  const c = g.cave.chambers[0];
  let dx = c.x + 0.5 - f.pos.x, dz = c.z + 2 - f.pos.z; const L = Math.hypot(dx, dz) || 1;
  const px = f.pos.x + dx / L * 4.6, pz = f.pos.z + dz / L * 4.6;
  g.player.pos.set(px, g.cave.floorAt(px, pz), pz);
  g.player.yaw = Math.atan2(-(f.pos.x - px), -(f.pos.z - pz)); g.player.pitch = -0.22;
});
await page.waitForTimeout(9000); // let Biscuit + Wren walk over and settle by the fire, fog thin out
const settle = await page.evaluate(() => ({ puppy: __game.puppy.state, wren: __game.wren.status, fog: __game.scene.fog.density.toFixed(3) }));
await page.screenshot({ path: OUT + 'screenshot.png' });

// Chat: open, type, send, read reply
await page.evaluate(() => __game.chat.show());
await page.fill('#chat-input', 'How is the fire doing?');
const nBefore = await page.$$eval('.msg', (e) => e.length);
await page.click('#chat-send');
await page.waitForFunction((n) => document.querySelectorAll('.msg').length >= n + 2 && !document.querySelector('.msg.typing'), nBefore, { timeout: 8000 });
const chatLog = await page.$$eval('.msg', (els) => els.map((e) => `${e.classList.contains('me') ? 'Cam' : 'Wren'}: ${e.textContent}`));
await page.screenshot({ path: OUT + 'test-output/04-chat.png' });
const mem = await page.evaluate(() => JSON.parse(localStorage.getItem('ember_hollow.companion_memory')));
const ctxBlock = await page.evaluate(async () => (await import('./src/companion/context.js')).buildContextBlock(__game.gameState()));
await page.evaluate(() => __game.chat.hide());

const perf = await page.evaluate(() => { const i = __game.renderer.info; let pl = 0; __game.scene.traverse((o) => { if (o.isPointLight) pl++; }); return { calls: i.render.calls, tris: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures, webgl2: __game.renderer.capabilities.isWebGL2, pointLights: pl, activePointLights: __game.budget.activeCount, hemi: +__game.hemi.intensity.toFixed(2), wrenHoodUp: __game.wren.hoodUp, torches: __game.dressing.torches.length }; });
const sw = await page.evaluate(async () => { const r = await navigator.serviceWorker?.getRegistration(); return r ? (r.active || r.installing || r.waiting)?.state : 'none'; });

console.log(JSON.stringify({ moved: moved.toFixed(2), turned: turned.toFixed(2), result: { ...result, ctx: undefined }, settle, perf, sw, chatLog, memoryKeys: Object.keys(mem || {}), memorySummary: mem?.memory_summary, ctxBlock, errors, warnings, failed }, null, 2));
await browser.close();
process.exit(errors.length || failed.length ? 1 : 0);
