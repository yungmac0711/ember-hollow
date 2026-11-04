#!/usr/bin/env node
// M2 chunk C screenshots → screenshots/: the first tutorial hint, the Hearth Journal (Ch1 with checkmarks),
// and a coziness tier-up (Snug Nook) by the fire. Needs the game served at BASE (default http://localhost:8931/)
// and `npm i` (playwright). QUERY=low=1 for the low tier.
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
await page.touchscreen.tap(b[0], b[1]);
const stats = {};
const info = (k) => page.evaluate((k) => { const g = __game, i = g.renderer.info.render; return { view: k, calls: i.calls, tris: i.triangles, lights: g.budget.activeCount }; }, k);
// 1. first session: the "move / look" hint (fresh browser profile, so no hints seen yet)
await page.waitForFunction(() => __game.coach.current === 'move', null, { timeout: 20000 });
await page.waitForTimeout(900);
stats.hint = { ...(await info('hint')), text: await page.$eval('#coach .coach-text', (e) => e.textContent) };
await page.screenshot({ path: OUT + 'm2c-hint.png' });
// placement helper (a stand-in player aims each piece, exactly like build mode does)
await page.evaluate(() => {
  const g = __game, B = g.build, inv = g.player.inventory, T = g.THREE;
  g.coach.hide(); g.settings.s.hints = false;
  for (const k of ['wood', 'stone', 'flint', 'fiber', 'mushroom', 'berry']) inv[k] = 30;
  for (const k of ['crafting_bench', 'table']) inv[k] = 1;
  const fake = (x, z, yaw, pitch = -0.3) => ({ pos: new T.Vector3(x, g.cave.floorAt(x, z), z), forward: new T.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)), pitch, yaw, inventory: inv });
  window.__put = (type, x, z, yaw, pitch) => { if (!B.active) B.toggle(); B.select(type); B.update(fake(x, z, yaw, pitch), 0.016); const t = B.target; const r = t?.ok ? B.place(inv) : { ok: false, why: t?.why }; B.toggle(); return r.ok; };
});
// 2. light the Lanternmouth campfire, bench beside it (Ch1 goals tick off), then the journal panel
const j = await page.evaluate(async () => {
  const g = __game, wait = (ms) => new Promise((r) => setTimeout(r, ms)), P = g.player, T = g.THREE;
  const fp = new T.Vector3(P.pos.x - Math.sin(P.yaw) * 2.5, 0, P.pos.z - Math.cos(P.yaw) * 2.5); fp.y = g.cave.floorAt(fp.x, fp.z);
  const f = window.__fire = g.fires.build(fp, 3); g.journal.emit('craft', 'campfire');
  let ok = false; for (let a = 0; a < 24 && !ok; a++) ok = __put('crafting_bench', f.pos.x + Math.cos(a) * 3, f.pos.z + Math.sin(a) * 3, a * 0.6);
  g.journal.emit('pet', 'biscuit'); for (let i = 0; i < 12; i++) g.journal.emit('gather', 'wood');
  g.progressTick(); await wait(300);
  g.hud._q.length = 0; g.hud._prioT = 0.01; await wait(200);
  g.openJournal(); await wait(800);
  return { bench: ok, done: [...g.journal.done], score: g.cozy.score };
});
stats.journal = { ...(await info('journal')), ...j };
await page.screenshot({ path: OUT + 'm2c-journal.png' });
// 3. the table by the fire tips it over 15 → Snug Nook toast, Wren's line, Biscuit's cue
const t = await page.evaluate(async () => {
  const g = __game, wait = (ms) => new Promise((r) => setTimeout(r, ms)), f = window.__fire, P = g.player;
  g.journalUI.close(); g.hud._q.length = 0; g.hud._prioT = 0.01; await wait(3500);
  let ok = false; for (let a = 0; a < 24 && !ok; a++) ok = __put('table', f.pos.x + Math.cos(a + 0.3) * 3.5, f.pos.z + Math.sin(a + 0.3) * 3.5, a * 0.6);
  const tb = g.build.find('table');
  const a = Math.atan2(f.pos.x - tb.x, f.pos.z - tb.z), d = 2.6; P.pos.set(f.pos.x + Math.sin(a) * d, g.cave.floorAt(f.pos.x + Math.sin(a) * d, f.pos.z + Math.cos(a) * d), f.pos.z + Math.cos(a) * d);
  P.yaw = Math.atan2(P.pos.x - (f.pos.x + tb.x) / 2, P.pos.z - (f.pos.z + tb.z) / 2); P.pitch = -0.28;
  const wx = P.pos.x + Math.sin(P.yaw) * 2.5, wz = P.pos.z + Math.cos(P.yaw) * 2.5; // behind Cam, so she doesn't block the view g.wren.pos.set(wx, g.cave.floorAt(wx, wz), wz);
  g.requests && (g.requests.cool = 999); g.progressTick(); await wait(700);
  return { wren: g.hud.sub.textContent, table: ok, tier: g.lastTierUp, toast: g.hud.lastToast, score: g.cozy.score };
});
stats.tierup = { ...(await info('tier-up')), ...t };
await page.screenshot({ path: OUT + 'm2c-cozy-tierup.png' });
console.log(JSON.stringify({ stats, errors }, null, 2));
await browser.close();
process.exit(errors.length ? 1 : 0);
