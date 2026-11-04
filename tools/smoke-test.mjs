#!/usr/bin/env node
// Headless smoke test: loads the game in an emulated iPhone (landscape, touch), checks for console
// errors, plays a scripted run (title → gather → light a fire → refuel → chat → build → Biscuit /
// requests / notes → save + reload), and saves screenshots.
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
await page.waitForTimeout(1200); // title backdrop orbit
await page.screenshot({ path: OUT + 'test-output/01-start.png' });
// Title screen (ui_text.json): fresh context → no save → no Continue; real touch on New Game
const title = await page.evaluate(async () => {
  const { STORY } = await import('./src/data/story.js');
  const $ = (id) => document.getElementById(id);
  return { name: $('title-name').textContent, nameOk: $('title-name').textContent === STORY.uiText.title, taglineOk: $('title-tagline').textContent === STORY.uiText.tagline,
    tip: $('title-tip').textContent, continueShown: !$('title-continue').hidden, newGame: $('title-new').textContent, backdropFire: __game.fires.fires.length, audioLocked: !__game.audio?.unlocked };
});
{
  const b = await page.$eval('#title-new', (e) => { const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
  await page.touchscreen.tap(b[0], b[1]);
}
await page.waitForTimeout(1500);
title.started = await page.evaluate(() => document.getElementById('start').classList.contains('hidden'));
title.backdropFireRemoved = await page.evaluate(() => __game.fires.fires.length === 0);
title.pass = title.nameOk && title.taglineOk && !title.continueShown && title.started && title.backdropFireRemoved;
await page.screenshot({ path: OUT + 'test-output/02-spawn.png' });
const spawnPerf = await page.evaluate(() => ({ calls: __game.renderer.info.render.calls, tris: __game.renderer.info.render.triangles, activePointLights: __game.budget.activeCount }));

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

// ---------------------------------------------------------------- M1 chunk A: gather + build
const m1 = {};
const face = (tx, tz) => page.evaluate(([tx, tz]) => { const p = __game.player; p.yaw = Math.atan2(-(tx - p.pos.x), -(tz - p.pos.z)); p.pitch = -0.25; }, [tx, tz]);
// 1. hold Use on a tree (keyboard/Use-button path)
m1.chop = await page.evaluate(async () => {
  const g = __game, wait = (ms) => new Promise((r) => setTimeout(r, ms));
  // the tree with the most room around it (a pickup in front of a tree takes priority over chopping)
  const room = (n) => Math.min(...g.items.list.filter((i) => i.alive).map((i) => i.pos.distanceTo(n.pos)));
  const t = g.harvest.nodes.filter((n) => n.type === 'tree' && n.alive).sort((a, b) => room(b) - room(a))[0];
  let dx = 0, dz = 0; // stand on the open side (away from the cave wall)
  for (let k = 0; k < 16; k++) { const a = k / 16 * 6.283, x = t.pos.x + Math.cos(a) * 1.5, z = t.pos.z + Math.sin(a) * 1.5; if (g.cave.field(x, z) > g.cave.field(t.pos.x + dx * 1.5, t.pos.z + dz * 1.5)) { dx = Math.cos(a); dz = Math.sin(a); } }
  const L = Math.hypot(dx, dz) || 1;
  const px = t.pos.x + dx / L * 1.5, pz = t.pos.z + dz / L * 1.5;
  g.player.pos.set(px, g.cave.floorAt(px, pz), pz);
  g.player.yaw = Math.atan2(-(t.pos.x - px), -(t.pos.z - pz)); g.player.pitch = -0.1;
  await wait(150);
  const label = g.hud.interactBtn?.textContent || document.getElementById('btn-interact')?.textContent;
  const w0 = g.player.inventory.wood;
  g.input.held.add('interact'); await wait(900);
  const ring = document.getElementById('ring').classList.contains('hidden') ? 'none' : 'shown';
  await wait(1300); g.input.held.delete('interact');
  return { label, ringShown: ring !== 'none', woodGained: g.player.inventory.wood - w0, treeAlive: t.alive };
});
// 2. press-and-hold a rock on the touch look side (real CDP touch)
{
  const pt = await page.evaluate(async () => {
    const g = __game, wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const r = g.harvest.nodes.filter((n) => n.type === 'rock' && n.alive).sort((a, b) => a.pos.distanceTo(g.player.pos) - b.pos.distanceTo(g.player.pos))[0];
    let best = null;
    for (let k = 0; k < 16 && !best; k++) { // find a standing spot with a clear line
      const a = k / 16 * Math.PI * 2, px = r.pos.x + Math.cos(a) * 1.7, pz = r.pos.z + Math.sin(a) * 1.7;
      if (g.cave.field(px, pz) > 0.6) best = [px, pz];
    }
    const [px, pz] = best || [r.pos.x + 1.6, r.pos.z];
    g.player.pos.set(px, g.cave.floorAt(px, pz), pz);
    g.player.yaw = Math.atan2(-(r.pos.x - px), -(r.pos.z - pz)); g.player.pitch = -0.35;
    await wait(200);
    const sp = g.harvest.screenPos(r, g.camera);
    window.__rock = r; return { x: sp.x, y: sp.y, s0: g.player.inventory.stone };
  });
  const tx = Math.max(440, Math.min(820, pt.x)), ty = Math.max(60, Math.min(330, pt.y));
  await touch('touchStart', [{ x: tx, y: ty, id: 3 }]);
  await page.waitForTimeout(2000);
  await touch('touchEnd', []);
  m1.breakRock = await page.evaluate((s0) => ({ stoneGained: __game.player.inventory.stone - s0, rockAlive: __rock.alive, flint: __game.player.inventory.flint }), pt.s0);
  m1.breakRock.tap = [Math.round(tx), Math.round(ty)];
}
// 3. new pickups
m1.pickups = await page.evaluate(async () => {
  const g = __game, wait = (ms) => new Promise((r) => setTimeout(r, ms)), out = {};
  for (const kind of ['mushroom', 'glowcap', 'crystal_shard']) {
    const it = g.items.list.filter((i) => i.alive && i.kind === kind).sort((a, b) => a.pos.distanceTo(g.player.pos) - b.pos.distanceTo(g.player.pos))[0];
    if (!it) { out[kind] = 'none'; continue; }
    g.player.pos.set(it.pos.x + 0.6, it.pos.y, it.pos.z + 0.6); g.player.yaw = Math.atan2(0.6, 0.6);
    await wait(100); g.input.pressed.add('interact'); await wait(100);
    out[kind] = g.player.inventory[kind];
  }
  out.hotbar = [...document.querySelectorAll('#hotbar .slot')].map((e) => e.textContent.trim().replace(/\s+/g, ' '));
  return out;
});
// 4. build: place / rotate / door / chest / remove (through the real Use path)
m1.build = await page.evaluate(async () => {
  const g = __game, wait = (ms) => new Promise((r) => setTimeout(r, ms)), B = g.build, inv = g.player.inventory, out = {};
  inv.wood += 60; inv.stone += 30;
  const c = g.cave.chambers[0];
  // find a buildable spot: floor valid at aim and a free prop cell next to it
  const fake = (x, z, yaw) => ({ pos: new g.THREE.Vector3(x, g.cave.floorAt(x, z), z), forward: new g.THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)), pitch: -0.3, yaw, inventory: inv });
  let spot = null;
  B.toggle(); B.select('floor');
  for (let r = 0; r < 9 && !spot; r++) for (let a = 0; a < 12 && !spot; a++) {
    const x = c.x + Math.cos(a / 12 * 6.283) * r, z = c.z + Math.sin(a / 12 * 6.283) * r, yaw = a / 12 * 6.283;
    if (g.fires.nearest(new g.THREE.Vector3(x, 0, z), 4.5)) continue; // keep clear of the M0 campfire
    const t = B._plan(fake(x, z, yaw)); if (t.ok) spot = { x, z, yaw };
  }
  B.toggle();
  if (!spot) return { error: 'no buildable spot' };
  const go = async (yaw = spot.yaw) => { g.player.pos.set(spot.x, g.cave.floorAt(spot.x, spot.z), spot.z); g.player.yaw = yaw; g.player.pitch = -0.3; await wait(120); };
  const use = async () => { g.input.pressed.add('interact'); await wait(150); };
  g.input.pressed.add('build'); await wait(100);
  out.buildOn = B.active && !document.getElementById('palette').classList.contains('hidden');
  const w0 = inv.wood, s0 = inv.stone;
  await go(); B.select('floor'); await wait(100); await use();
  out.floor = B.pieces.filter((p) => p.type === 'floor').length;
  out.floorCost = [w0 - inv.wood, s0 - inv.stone];
  // wall on an edge, then rotate (flip) and check yaw changed on the ghost
  B.select('wall'); await wait(100);
  const y0 = B.target?.yaw; g.input.pressed.add('rotate'); await wait(100); const y1 = B.target?.yaw;
  out.rotateFlips = y0 !== undefined && Math.abs(Math.abs(y1 - y0) - Math.PI) < 1e-3;
  let wallYaw = null;
  for (let k = 0; k < 8 && wallYaw === null; k++) { await go(spot.yaw + k * Math.PI / 4); if (B.target?.ok) { await use(); wallYaw = spot.yaw + k * Math.PI / 4; } }
  out.wall = B.pieces.filter((p) => p.type === 'wall').length;
  // roof on that wall
  B.select('roof'); if (wallYaw !== null) await go(wallYaw); await wait(100); out.roofPlan = B.target?.ok ? 'ok' : B.target?.why;
  if (B.target?.ok) { await use(); out.roof = B.pieces.filter((p) => p.type === 'roof').length; }
  // door: try the four edges around Cam
  B.select('door'); let door = null;
  for (let k = 0; k < 8 && !door; k++) { await go(spot.yaw + k * Math.PI / 4); if (B.target?.ok) { await use(); door = B.pieces.find((p) => p.type === 'door'); } }
  out.door = !!door;
  if (door) { // open the door with Use (build mode off)
    g.input.pressed.add('build'); await wait(120);
    const leaf = door.leaf; // stand 1.3 m in front of the door
    const sx = door.x + Math.cos(door.yaw) * 1.3, sz = door.z - Math.sin(door.yaw) * 1.3;
    g.player.pos.set(sx, g.cave.floorAt(sx, sz), sz);
    g.player.yaw = Math.atan2(-(door.x - sx), -(door.z - sz)); await wait(150);
    out.doorLabel = document.getElementById('btn-interact')?.textContent;
    await use(); await wait(900);
    out.doorOpen = +door.open.toFixed(2); out.leafColliderOff = leaf ? !leaf.on : 'n/a';
    out.doorHingeDeg = +(g.THREE.MathUtils.radToDeg(-door.open * 1.745)).toFixed(0);
    await use(); await wait(900); out.doorClosedAgain = +door.open.toFixed(2);
    g.input.pressed.add('build'); await wait(120);
  }
  // chest: a prop cell
  B.select('chest'); let chest = null;
  for (let k = 0; k < 8 && !chest; k++) { await go(spot.yaw + k * Math.PI / 4); if (B.target?.ok) { await use(); chest = B.pieces.find((p) => p.type === 'chest'); } }
  out.chest = !!chest;
  g.input.pressed.add('build'); await wait(120);
  const nearChest = async () => { // stand 1.3 m from the chest on the side facing the build spot
    const dx = spot.x - chest.x, dz = spot.z - chest.z, L = Math.hypot(dx, dz) || 1, sx = chest.x + dx / L * 1.3, sz = chest.z + dz / L * 1.3;
    g.player.pos.set(sx, g.cave.floorAt(sx, sz), sz); g.player.yaw = Math.atan2(-(chest.x - sx), -(chest.z - sz)); g.player.pitch = -0.3; await wait(150);
  };
  if (chest) {
    await nearChest();
    out.chestLabel = document.getElementById('btn-interact')?.textContent;
    await use(); await wait(500);
    out.chestPanel = !document.getElementById('chestui').classList.contains('hidden');
    out.lidOpen = +chest.open.toFixed(2);
    const wBefore = inv.wood;
    document.querySelector('#chest-pack [data-kind="wood"]')?.click(); await wait(80);
    out.stored = { chest: chest.store.wood || 0, pack: inv.wood, moved: wBefore };
    document.querySelector('#chest-store [data-kind="wood"]')?.click(); await wait(80);
    out.tookBack = inv.wood === wBefore && !(chest.store.wood > 0);
    document.querySelector('#chestui .panel-close')?.click(); await wait(600);
    out.chestClosed = document.getElementById('chestui').classList.contains('hidden') && chest.openTarget === 0;
  }
  // remove the chest with full refund
  g.input.pressed.add('build'); await wait(100); g.input.pressed.add('remove'); await wait(120);
  if (chest) {
    await nearChest();
    const tgt = B.target?.remove?.type, wb = inv.wood, sb = inv.stone;
    if (tgt === 'chest') { await use(); out.removeRefund = [inv.wood - wb, inv.stone - sb]; } else out.removeTarget = tgt;
  }
  g.input.pressed.add('remove'); await wait(80); g.input.pressed.add('build'); await wait(100);
  out.summary = B.summary(); out.spot = spot;
  return out;
});
await page.evaluate(async () => { // frame the little build for an orientation check
  const g = __game, B = g.build; if (!B.pieces.length) return;
  const cx = B.pieces.reduce((a, p) => a + p.x, 0) / B.pieces.length, cz = B.pieces.reduce((a, p) => a + p.z, 0) / B.pieces.length;
  let best = null; for (let k = 0; k < 24; k++) { const a = k / 24 * 6.283, x = cx + Math.cos(a) * 4.2, z = cz + Math.sin(a) * 4.2, f = g.cave.field(x, z); if (!best || f > best.f) best = { x, z, f }; }
  g.player.pos.set(best.x, g.cave.floorAt(best.x, best.z), best.z); g.player.yaw = Math.atan2(-(cx - best.x), -(cz - best.z)); g.player.pitch = -0.2;
  await new Promise((r) => setTimeout(r, 600));
});
await page.screenshot({ path: OUT + 'test-output/05-build.png' });

// 4b. REAL touch on the build palette / buttons / panel close (hotfix): CDP touch events, with
// trusted 'click' events swallowed to mimic iOS Safari dropping synthesized clicks on
// touch-action:none UI. A tap must change the selected piece; a sideways swipe must scroll the
// palette without selecting.
m1.touchUI = await (async () => {
  const out = {};
  await page.evaluate(() => { window.__dropClicks = (e) => { if (e.isTrusted && e.detail > 0) { e.stopImmediatePropagation(); e.preventDefault(); } }; window.addEventListener('click', window.__dropClicks, true); });
  const center = (sel) => page.evaluate((sel) => { const el = document.querySelector(sel); if (!el) return null; el.scrollIntoView({ inline: 'center', block: 'nearest' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width }; }, sel);
  const tap = async (pt) => { await touch('touchStart', [{ x: pt.x, y: pt.y, id: 7 }]); await page.waitForTimeout(60); await touch('touchEnd', []); await page.waitForTimeout(200); };
  const bb = await center('#btn-build'); await tap(bb);
  out.buildOn = await page.evaluate(() => __game.build.active);
  out.taps = [];
  for (const t of ['wall', 'roof', 'chest', 'floor']) {
    const pt = await center(`#palette [data-piece="${t}"]`);
    if (!pt) { out.taps.push({ t, missing: true }); continue; }
    await tap(pt);
    out.taps.push({ t, selected: await page.evaluate(() => __game.build.selected) });
  }
  out.tapSelects = out.taps.every((x) => x.selected === x.t);
  // swipe: scroll the palette sideways, selection must not change
  const sel0 = await page.evaluate(() => __game.build.selected);
  await page.evaluate(() => { document.getElementById('palette').scrollLeft = 0; });
  const pr = await page.evaluate(() => { const r = document.getElementById('palette').getBoundingClientRect(); return { x: r.left + r.width * 0.7, y: r.top + r.height / 2, sw: document.getElementById('palette').scrollWidth, cw: document.getElementById('palette').clientWidth }; });
  await touch('touchStart', [{ x: pr.x, y: pr.y, id: 8 }]);
  for (let i = 1; i <= 10; i++) { await touch('touchMove', [{ x: pr.x - i * 14, y: pr.y, id: 8 }]); await page.waitForTimeout(16); }
  await touch('touchEnd', []); await page.waitForTimeout(400);
  out.swipe = await page.evaluate((sel0) => ({ scrollLeft: Math.round(document.getElementById('palette').scrollLeft), selectionKept: __game.build.selected === sel0 }), sel0);
  out.swipe.scrollable = pr.sw > pr.cw;
  out.swipeOk = out.swipe.selectionKept && (!out.swipe.scrollable || out.swipe.scrollLeft > 0);
  await tap(await center('#btn-build'));
  out.buildOff = await page.evaluate(() => !__game.build.active);
  // pack button + panel close (✕) by touch
  await tap(await center('#btn-bag'));
  out.bagOpened = await page.evaluate(() => !document.getElementById('bag').classList.contains('hidden'));
  await tap(await center('#bag .panel-close'));
  out.bagClosed = await page.evaluate(() => document.getElementById('bag').classList.contains('hidden'));
  await page.evaluate(() => window.removeEventListener('click', window.__dropClicks, true));
  out.pass = out.buildOn && out.tapSelects && out.swipeOk && out.buildOff && out.bagOpened && out.bagClosed;
  return out;
})();

// ---------------------------------------------------------------- M1 chunk B: Biscuit, Wren, requests, notes
const m2 = {};
m2.bankAdapter = await page.evaluate(() => __game.chat.adapter.constructor.name);
m2.bankReply = chatLog[chatLog.length - 1] || '';
// pet → hearts + play-bow; fetch → stick thrown, retrieved, dropped at Cam's feet
m2.pet = await page.evaluate(async () => {
  const g = __game, wait = (ms) => new Promise((r) => setTimeout(r, ms));
  g.puppy.pos.set(g.player.pos.x + 1, g.player.pos.y, g.player.pos.z + 0.6); await wait(100);
  g.puppy.pet(); await wait(200);
  return { state: g.puppy.state, mood: g.puppy.mood };
});
await page.waitForTimeout(2500);
m2.fetch = await page.evaluate(async () => {
  const g = __game, wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const c = g.cave.chambers[0], p = g.player;
  p.pos.set(c.x + 2, g.cave.floorAt(c.x + 2, c.z + 3), c.z + 3); p.yaw = Math.atan2(-(c.x - 1 - p.pos.x), -(c.z - 2 - p.pos.z)); p.pitch = 0;
  g.puppy.pos.set(p.pos.x + 0.9, p.pos.y, p.pos.z + 0.4); g.puppy._setState?.('follow');
  await wait(300);
  const f0 = g.puppy.fetches;
  g.input.pressed.add('stick'); await wait(150);
  const thrown = g.puppy.stick.state;
  for (let t = 0; t < 120 && g.puppy.fetches === f0; t++) await wait(100);
  return { thrown, fetched: g.puppy.fetches - f0, stick: g.puppy.stick.state };
});
m2.dig = await page.evaluate(async () => {
  const g = __game, wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const n0 = g.digLog.length, inv0 = JSON.stringify(g.player.inventory);
  g.puppy.startDig();
  for (let t = 0; t < 50 && g.digLog.length === n0; t++) await wait(100);
  return { found: g.digLog.slice(n0), invChanged: JSON.stringify(g.player.inventory) !== inv0, mood: g.puppy.mood };
});
await page.screenshot({ path: OUT + 'test-output/07-biscuit.png' });
// a request: Wren offers one, Cam brings the needs, "Give to Wren" (real touch) completes it
m2.request = await page.evaluate(async () => {
  const g = __game, wait = (ms) => new Promise((r) => setTimeout(r, ms));
  g.wren.pos.set(g.player.pos.x + 1.5, g.player.pos.y, g.player.pos.z);
  g.talkRequests(); await wait(200);
  const r = g.requests.current; if (!r) return { offered: false };
  for (const n of r.needs) g.player.inventory[n.item] = Math.max(g.player.inventory[n.item] || 0, n.count);
  await wait(300);
  return { offered: true, id: r.id, title: r.title, trackerShown: !document.getElementById('request').classList.contains('hidden'), giveShown: !document.getElementById('rq-give').classList.contains('hidden') };
});
if (m2.request.giveShown) {
  const b = await page.$eval('#rq-give', (e) => { const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
  await page.touchscreen.tap(b[0], b[1]); await page.waitForTimeout(300);
}
Object.assign(m2.request, await page.evaluate((id) => ({ completed: __game.requests.done.has(id), active: __game.requests.active, unlocked: [...__game.requests.unlocked], line: __game.ambient.log?.slice(-1)[0]?.line }), m2.request.id));
// a lore note: open in the parchment reader, close with a real tap on ✕, lands in the journal
m2.note = await page.evaluate(async () => {
  const g = __game, wait = (ms) => new Promise((r) => setTimeout(r, ms)), n = g.lore.notes[0];
  g.openNote(n.id); await wait(250);
  return { id: n.id, title: n.title, readerOpen: !document.getElementById('reader').classList.contains('hidden'), text: document.querySelector('#reader .pr-text').textContent.slice(0, 60) };
});
await page.screenshot({ path: OUT + 'test-output/08-note.png' });
{
  const b = await page.$eval('#reader .pr-close', (e) => { const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
  await page.touchscreen.tap(b[0], b[1]); await page.waitForTimeout(250);
}
Object.assign(m2.note, await page.evaluate((id) => ({ readerClosed: document.getElementById('reader').classList.contains('hidden'), inJournal: __game.lore.journal().some((j) => j.id === id) }), m2.note.id));
m2.pass = m2.bankAdapter === 'BankAdapter' && !!m2.bankReply && m2.pet.state === 'petted' && m2.fetch.fetched === 1 && m2.dig.found.length === 1
  && !!m2.request.completed && m2.note.readerOpen && m2.note.readerClosed && m2.note.inJournal;

const perf = await page.evaluate(() => { const i = __game.renderer.info; let pl = 0; __game.scene.traverse((o) => { if (o.isPointLight) pl++; }); return { calls: i.render.calls, tris: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures, webgl2: __game.renderer.capabilities.isWebGL2, pointLights: pl, activePointLights: __game.budget.activeCount, hemi: +__game.hemi.intensity.toFixed(2), wrenHoodUp: __game.wren.hoodUp, torches: __game.dressing.torches.length }; });
// 5. 60-piece perf test: fill Lanternmouth + Mossdrip with a mix of pieces, then measure from the base
m1.perf60 = await page.evaluate(async () => {
  const g = __game, wait = (ms) => new Promise((r) => setTimeout(r, ms)), B = g.build, inv = g.player.inventory;
  inv.wood += 999; inv.stone += 999;
  const fake = (x, z, yaw) => ({ pos: new g.THREE.Vector3(x, g.cave.floorAt(x, z), z), forward: new g.THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)), pitch: -0.3, yaw, inventory: inv });
  const types = ['floor', 'wall', 'floor', 'window', 'roof', 'wall', 'lantern', 'floor', 'bedroll', 'table', 'chest', 'door', 'roof', 'wall', 'hearth'];
  B.toggle(); let k = 0, tries = 0;
  for (const ci of [0, 3, 1]) {
    const c = g.cave.chambers[ci];
    for (let r = 0; r < 12 && B.pieces.length < 60; r += 0.7) for (let a = 0; a < 16 && B.pieces.length < 60; a++) {
      const yaw = a / 16 * 6.283, x = c.x + Math.cos(yaw * 1.7) * r, z = c.z + Math.sin(yaw * 1.7) * r;
      for (let t = 0; t < types.length && B.pieces.length < 60; t++) {
        const type = types[(k + t) % types.length]; B.select(type); B.update(fake(x, z, yaw), 0.016); tries++;
        if (B.target?.ok && B.place(inv).ok) { k++; break; }
      }
    }
  }
  B.toggle();
  const c = g.cave.chambers[0];
  g.player.pos.set(c.x + 4, g.cave.floorAt(c.x + 4, c.z + 4), c.z + 4); g.player.yaw = Math.atan2(-(c.x - g.player.pos.x), -(c.z - g.player.pos.z)); g.player.pitch = -0.25;
  await wait(1500);
  const i = g.renderer.info;
  return { pieces: B.pieces.length, counts: B.counts(), tries, calls: i.render.calls, tris: i.render.triangles, activePointLights: g.budget.activeCount };
});
await page.screenshot({ path: OUT + 'test-output/06-sixty.png' });
// ---------------------------------------------------------------- save → reload → Continue
const saved = await page.evaluate(() => {
  const g = __game; g.player.inventory.mushroom = 7; g.saveNow('test');
  const d = JSON.parse(localStorage.getItem('ember_hollow.save'));
  return { v: d.v, pieces: d.pieces.length, inv: d.inventory, notes: d.notes, done: d.requests.done, pos: d.player, chest: d.pieces.filter((p) => p.store).length };
});
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.ready, null, { timeout: 60000 });
const reload = await page.evaluate(() => ({ continueShown: !document.getElementById('title-continue').hidden }));
if (reload.continueShown) {
  const b = await page.$eval('#title-continue', (e) => { const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
  await page.touchscreen.tap(b[0], b[1]); await page.waitForTimeout(1500);
}
Object.assign(reload, await page.evaluate((s) => {
  const g = __game;
  return { started: document.getElementById('start').classList.contains('hidden'), pieces: g.build.pieces.length, mushroom: g.player.inventory.mushroom,
    notesRead: g.lore.read.size, requestsDone: g.requests.done.size, dPos: +Math.hypot(g.player.pos.x - s.pos.x, g.player.pos.z - s.pos.z).toFixed(2) };
}, saved));
reload.pass = reload.continueShown && reload.started && reload.pieces === saved.pieces && reload.mushroom === 7 && reload.notesRead === saved.notes.length && reload.requestsDone === saved.done.length && reload.dPos < 0.5;
await page.screenshot({ path: OUT + 'test-output/09-continue.png' });

const sw = await page.evaluate(async () => { const r = await navigator.serviceWorker?.getRegistration(); return r ? (r.active || r.installing || r.waiting)?.state : 'none'; });

console.log(JSON.stringify({ title, m2, saved, reload, moved: moved.toFixed(2), turned: turned.toFixed(2), result: { ...result, ctx: undefined }, settle, spawnPerf, perf, sw, chatLog, memoryKeys: Object.keys(mem || {}), memorySummary: mem?.memory_summary, ctxBlock, m1, errors, warnings, failed }, null, 2));
await browser.close();
process.exit(errors.length || failed.length || !m1.touchUI?.pass || !title.pass || !m2.pass || !reload.pass ? 1 : 0);
