#!/usr/bin/env node
// M2 chunk A screenshots → screenshots/: HUD by day, dark cave with the hand lantern (on + off), Wren following.
// Needs the game served at BASE (default http://localhost:8931/) and `npm i` (playwright). QUERY=low=1 for the low tier.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:8931/';
const OUT = new URL('../screenshots/', import.meta.url).pathname; mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
await page.goto(BASE + 'index.html?nosw=1' + (process.env.QUERY ? '&' + process.env.QUERY : ''), { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.ready, null, { timeout: 60000 });
const b = await page.$eval('#title-new', (e) => { const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
await page.touchscreen.tap(b[0], b[1]); await page.waitForTimeout(2500);
const stats = {};
const info = (k) => page.evaluate((k) => { const g = __game, i = g.renderer.info.render; return { view: k, calls: i.calls, tris: i.triangles, lights: g.budget.activeCount, pointPool: g.budget.slots.length, lantern: g.lantern.lit }; }, k);
// 1. HUD by day on the surface (lantern lit, nothing else on screen)
await page.evaluate(async () => {
  const g = __game, cl = g.cave.clearing, wait = (ms) => new Promise((r) => setTimeout(r, ms));
  g.dayNight.tod = 300; g.dayNight.forceRain = false; g.dayNight.weather = 'clear'; g.dayNight.rainK = 0;
  const x = cl.x + 6, z = cl.z + 6; g.player.pos.set(x, g.cave.floorAt(x, z), z); g.player.yaw = Math.atan2(-(cl.x - x), -(cl.z - z)); g.player.pitch = -0.08;
  g.wren.pos.set(x + 2.2, g.wren.pos.y, z + 1.6); g.hud.say?.('', 0); await wait(3500);
});
stats.day = await info('surface day'); await page.screenshot({ path: OUT + 'm2a-hud-day.png' });
// 2. dark cave (Flintseam Ridge, away from any fire): lantern on, then stowed for comparison
await page.evaluate(async () => {
  const g = __game, c = g.cave.chambers[1], wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const x = c.x - 5, z = c.z + 3; g.player.pos.set(x, g.cave.floorAt(x, z), z); g.player.yaw = Math.atan2(-(c.x - x), -(c.z - z)); g.player.pitch = -0.15;
  g.wren.pos.set(x + 2, g.cave.floorAt(x + 2, z + 2), z + 2); g.lantern.on = true; await wait(4000);
});
stats.caveOn = await info('dark cave, lantern on'); await page.screenshot({ path: OUT + 'm2a-lantern-cave.png' });
await page.evaluate(async () => { __game.lantern.on = false; await new Promise((r) => setTimeout(r, 2500)); });
stats.caveOff = await info('dark cave, lantern stowed'); await page.screenshot({ path: OUT + 'm2a-lantern-cave-off.png' });
// 3. Wren following: walk 3 s through Lanternmouth, then glance back over the right shoulder
await page.evaluate(async () => {
  const g = __game, c = g.cave.chambers[0], wait = (ms) => new Promise((r) => setTimeout(r, ms)), key = (k, d) => window.dispatchEvent(new KeyboardEvent(d ? 'keydown' : 'keyup', { code: k }));
  g.lantern.on = true; const x = c.x + 5, z = c.z + 5; g.player.pos.set(x, g.cave.floorAt(x, z), z); g.player.yaw = Math.atan2(-(c.x - x), -(c.z - z)); g.player.pitch = -0.05;
  g.wren.pos.set(x + 1.5, g.wren.pos.y, z + 2); await wait(2000);
  key('KeyW', true); await wait(3000); key('KeyW', false); await wait(1800);
  const w = g.wren, p = g.player; p.yaw = Math.atan2(-(w.pos.x - p.pos.x), -(w.pos.z - p.pos.z)) - 0.35; await wait(600);
  window.__wd = +Math.hypot(w.pos.x - p.pos.x, w.pos.z - p.pos.z).toFixed(2);
});
stats.wren = { ...(await info('Lanternmouth, Wren in view')), wrenDist: await page.evaluate(() => window.__wd) };
await page.screenshot({ path: OUT + 'm2a-wren-follow.png' });
// extra budget views: spawn hollow + surface night
await page.evaluate(async () => { const g = __game, cl = g.cave.clearing, x = cl.x + 9, z = cl.z - 6; g.dayNight.tod = 960; g.player.pos.set(x, g.cave.floorAt(x, z), z); g.player.yaw = 0.6; await new Promise((r) => setTimeout(r, 3500)); });
stats.night = await info('surface night, away from fire');
console.log(JSON.stringify(stats, null, 1));
await browser.close();
