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
  for (const kind of ['mushroom', 'glowcap', 'shard']) {
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
const sw = await page.evaluate(async () => { const r = await navigator.serviceWorker?.getRegistration(); return r ? (r.active || r.installing || r.waiting)?.state : 'none'; });

console.log(JSON.stringify({ moved: moved.toFixed(2), turned: turned.toFixed(2), result: { ...result, ctx: undefined }, settle, spawnPerf, perf, sw, chatLog, memoryKeys: Object.keys(mem || {}), memorySummary: mem?.memory_summary, ctxBlock, m1, errors, warnings, failed }, null, 2));
await browser.close();
process.exit(errors.length || failed.length ? 1 : 0);
