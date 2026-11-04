#!/usr/bin/env node
// M2 chunk B screenshots → screenshots/: the bench's recipe panel, a furnished cozy room, gathering in the clearing.
// Needs the game served at BASE (default http://localhost:8931/) and `npm i` (playwright). QUERY=low=1 for the low tier.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:8931/';
const OUT = new URL('../screenshots/', import.meta.url).pathname; mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
await page.goto(BASE + 'index.html?nosw=1' + (process.env.QUERY ? '&' + process.env.QUERY : ''), { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.ready, null, { timeout: 60000 });
const b = await page.$eval('#title-new', (e) => { const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
await page.touchscreen.tap(b[0], b[1]); await page.waitForTimeout(2500);
const stats = {};
const info = (k) => page.evaluate((k) => { const g = __game, i = g.renderer.info.render; return { view: k, calls: i.calls, tris: i.triangles, lights: g.budget.activeCount }; }, k);
// hide Wren's subtitle / area title / toasts for the shot (they come back on their own afterwards)
const quiet = () => page.evaluate(async () => { const h = __game.hud; for (const e of [h.sub, h.area, h.toastEl]) e.style.visibility = 'hidden'; await new Promise((r) => setTimeout(r, 50)); });
const loud = () => page.evaluate(() => { const h = __game.hud; for (const e of [h.sub, h.area, h.toastEl]) e.style.visibility = ''; });
// placement helpers (a stand-in player aims each piece, exactly like build mode does)
await page.evaluate(() => {
  const g = __game, B = g.build, inv = g.player.inventory, T = g.THREE;
  for (const k of ['wood', 'stone', 'flint', 'fiber', 'crystal_shard', 'mushroom', 'berry']) inv[k] = 40;
  for (const k of ['wooden_shelves', 'painting', 'window_shutters', 'table', 'stew', 'berry_tea', 'armchair', 'bookshelf', 'dog_bowl', 'stained_crystal_lamp', 'torch', 'wren_quilt', 'ember_garland', 'potted_glowcap', 'crafting_bench']) inv[k] = 3;
  const fake = (x, z, yaw, pitch = -0.3) => ({ pos: new T.Vector3(x, g.cave.floorAt(x, z), z), forward: new T.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)), pitch, yaw, inventory: inv });
  window.__put = (type, x, z, yaw, pitch, rot = 0) => { if (!B.active) B.toggle(); B.select(type); B.rot = rot; B.update(fake(x, z, yaw, pitch), 0.016); const t = B.target; const r = t?.ok ? B.place(inv) : { ok: false, why: t?.why }; B.toggle(); return r.ok; };
  window.__try = (type, c, rot = 0) => c.some(([x, z, yaw, pitch]) => __put(type, x, z, yaw, pitch, rot));
});
// 1. a little room in Lanternmouth: floor, log walls, window + shutters, roof, then the cozy things
const room = await page.evaluate(async () => {
  const g = __game, B = g.build, wait = (ms) => new Promise((r) => setTimeout(r, ms)), N = 0, E = -Math.PI / 2, W = Math.PI / 2;
  const cells = [[0, -2], [2, -2], [0, -4], [2, -4]];
  for (const [cx, cz] of cells) __put('floor', cx, cz + 2, N);
  __put('wall', 0, -4, N); __put('wall', 2, -4, N); __put('wall', 0, -4, W); __put('wall', 0, -2, W); __put('wall', 2, -4, E); __put('window', 2, -2, E);
  for (const [cx, cz] of cells) __put('roof', cx, cz + 2, N, -0.1);
  __put('wooden_shelves', 0, -4, N); __put('painting', 2, -4, N); __put('window_shutters', 2, -2, E);
  __try('bookshelf', [[2.4, -3, W], [2.6, -2.6, W]]);
  __try('table', [[2, -1.4, N], [2, -1.0, N]]);
  const tb = B.find('table');
  if (tb) { [-0.5, -0.7, -0.9].some((p) => __put('stew', tb.x, tb.z + 1.3, N, p)); [-0.5, -0.7, -0.9].some((p) => __put('berry_tea', tb.x - 0.3, tb.z + 1.3, N, p)); }
  [-0.5, -0.7, -0.9].some((p) => tb && __put('potted_glowcap', tb.x + 0.3, tb.z + 1.3, N, p));
  __try('stained_crystal_lamp', [[4, 2.2, N], [4.4, 2.2, N]]);
  __try('wren_quilt', [[1.1, 0.4, N], [1, 0, N]]);
  __try('dog_bowl', [[2, 0.2, N], [2.4, 0.2, N]]);
  __try('ember_garland', [[1, -2, N, 0.2]]);
  __try('torch', [[-1.5, 2.5, N], [-1.8, 2, N]]);
  const P = g.player; P.pos.set(1.7, g.cave.floorAt(1.7, 1.6), 1.6); P.yaw = 0.2; P.pitch = -0.14; g.lantern.on = true;
  g.wren.pos.set(0.6, g.cave.floorAt(0.6, -2.8), -2.8);
  await wait(3000);
  return { pieces: B.pieces.length, counts: B.counts(), at: B.pieces.filter((p) => !['floor', 'wall', 'roof', 'window'].includes(p.type)).map((p) => `${p.type}@${p.x.toFixed(1)},${p.z.toFixed(1)}`) };
});
await quiet(); stats.room = { ...(await info('cozy room')), ...room };
await page.screenshot({ path: OUT + 'm2b-cozy-room.png' }); await loud();
// 2. the bench's recipe panel (Tools tab: craftable stone axe, locked forge tools)
await page.evaluate(async () => {
  const g = __game, B = g.build, wait = (ms) => new Promise((r) => setTimeout(r, ms));
  __try('crafting_bench', [[4.5, 2, -Math.PI / 2], [4, 3, -Math.PI / 2], [-3, 3, Math.PI / 2]]);
  const p = B.find('crafting_bench'); const P = g.player;
  P.pos.set(p.x - 2, g.cave.floorAt(p.x - 2, p.z + 1), p.z + 1); P.yaw = Math.atan2(-(p.x - P.pos.x), -(p.z - P.pos.z)); P.pitch = -0.3;
  Object.assign(g.player.inventory, { wood: 6, stone: 4, flint: 1 }); g.invUI.setInventory(g.player.inventory);
  await wait(800); g.usePiece(g.pieceAction(p)); g.craftUI.setTab('tools'); await wait(900);
});
await quiet(); stats.panel = await info('bench panel');
await page.screenshot({ path: OUT + 'm2b-bench-panel.png' }); await loud();
await page.evaluate(() => __game.craftUI.close());
// 3. gathering in the clearing by day: holding on a glowberry bush, stone axe in the pack
const gather = await page.evaluate(async () => {
  const g = __game, T = g.THREE, wait = (ms) => new Promise((r) => setTimeout(r, ms)), H = g.harvest, P = g.player, cl = g.cave.clearing;
  g.dayNight.tod = 300; g.dayNight.forceRain = false; g.dayNight.weather = 'clear'; g.dayNight.rainK = 0;
  g.player.inventory.stone_axe = 1; g.player.inventory.berry = 4; g.player.inventory.fiber = 3;
  const n = H.nodes.filter((n) => n.type === 'bush' && n.alive).sort((a, b) => Math.hypot(a.pos.x - cl.x, a.pos.z - cl.z) - Math.hypot(b.pos.x - cl.x, b.pos.z - cl.z))[0];
  for (const it of g.items.list) if (it.alive && Math.hypot(it.pos.x - n.pos.x, it.pos.z - n.pos.z) < 4) g.items.pickUp(it);
  const d = new T.Vector3(n.pos.x - cl.x, 0, n.pos.z - cl.z).normalize();
  const px = n.pos.x + d.x * 1.9, pz = n.pos.z + d.z * 1.9; P.pos.set(px, g.cave.floorAt(px, pz), pz); P.yaw = Math.atan2(-(n.pos.x - px), -(n.pos.z - pz)) + 0.25; P.pitch = -0.22;
  const wx = n.pos.x - d.z * 1.6 - d.x * 0.6, wz = n.pos.z + d.x * 1.6 - d.z * 0.6; g.wren.pos.set(wx, g.cave.floorAt(wx, wz), wz);
  await wait(3000);
  g.input.held.add('interact'); await wait(350); g.hud.sub.classList.remove('show'); g.hud._subT = 0;
  return { bush: [n.pos.x, n.pos.z], label: document.getElementById('btn-interact').textContent };
});
await quiet();
stats.gather = { ...(await info('clearing, picking glowberries')), ...gather };
await page.screenshot({ path: OUT + 'm2b-gathering.png' });
await page.evaluate(() => __game.input.held.delete('interact'));
console.log(JSON.stringify({ stats, errors }, null, 1));
await browser.close();
