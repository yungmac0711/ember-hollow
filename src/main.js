// Ember Hollow — bootstrap + game loop (M0 + M1 chunks A/B). Wires world, entities, fire, companion and UI together.
// Chunk B: save/load, title screen, Biscuit v2 (pet/bark/fetch/dig/zoomies), Wren's reply bank, ambient
// lines from story data, requests, lore notes + journal, decor and keepsakes.
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { Cave } from './world/cave.js';
import { buildDecor } from './world/decor.js';
import { InstanceCuller } from './render/instcull.js';
import { buildDressing } from './world/dressing.js';
import { LightBudget } from './render/lights.js';
import { AmbientController } from './render/ambient.js';
import { Input } from './input/input.js';
import { Player } from './entities/player.js';
import { Items, ITEM_INFO } from './entities/items.js';
import { Puppy, buildPuppyPrimitive } from './entities/puppy.js';
import { FireSystem } from './fire/campfire.js';
import { Wren, buildWrenPrimitive } from './companion/wren.js';
import { createAdapter } from './companion/llm/index.js';
import { CompanionMemory } from './companion/memory.js';
import { ChatUI } from './companion/chat-ui.js';
import { AmbientLines } from './companion/ambient.js';
import { fireLevelWord, fogWord } from './companion/context.js';
import { BuildSystem, loadPieceParts } from './build/shelter.js';
import { PIECES } from './build/pieces.js';
import { STORY } from './data/story.js';
import { weighted } from './companion/when.js';
import { Requests } from './companion/requests.js';
import { LoreNotes, ParchmentReader } from './world/lore.js';
import { readSave, writeSave, newGameReload, consumeNewGameFlag } from './save/save.js';
import { onTap } from './ui/tap.js';
import { Harvest } from './entities/harvest.js';
import { Colliders } from './world/colliders.js';
import { InventoryUI, HOTBAR } from './ui/inventory-ui.js';
import { HUD } from './ui/hud.js';
import { GameAudio } from './audio.js';
import { loadModel, loadParts, loadScene } from './assets.js';
import { DayNight, timeWord, canSleepAt, T as DN, CYCLE as DAY_CYCLE } from './render/daynight.js';
import { Cooking } from './fire/cooking.js';
import { Surface, loadSurfaceParts, treeVariants } from './world/surface.js';
import { bestTier, fill } from './companion/when.js';
import { Glowmere, Fireflies } from './world/glowmere.js';
import { SettingsPanel } from './ui/settings.js';

const FC = CONFIG.fire, R = CONFIG.render;
const startMsg = document.getElementById('start-msg');

// ---------------------------------------------------------------- renderer (WebGL2 only)
const canvas = document.getElementById('game');
const gl = canvas.getContext('webgl2', { antialias: false, powerPreference: 'high-performance', alpha: false });
if (!gl) {
  startMsg.textContent = 'This device/browser does not support WebGL2.';
  throw new Error('WebGL2 not available');
}
const renderer = new THREE.WebGLRenderer({ canvas, context: gl, antialias: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, R.maxPixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = R.exposure;
renderer.shadowMap.enabled = false;

const scene = new THREE.Scene();
scene.background = new THREE.Color(R.background);
scene.fog = new THREE.FogExp2(R.fogColor, R.fogCold);
const camera = new THREE.PerspectiveCamera(R.fov, window.innerWidth / window.innerHeight, 0.05, R.farPlane);
scene.add(camera);
// Hemisphere colours/intensity + fog colour are driven per frame by AmbientController (§8.1).
const hemi = new THREE.HemisphereLight(R.hemi.sky, R.hemi.ground, R.hemi.intensity);
scene.add(hemi);
// Fixed pool of real PointLights shared by campfires (priority 3), Wren's lantern (2) and torches (1)
const budget = new LightBudget(scene, R.maxPointLights);

let lastW = window.innerWidth;
function onResize() {
  // Soft keyboard guard: while typing in chat, iOS/Android shrink the viewport — don't resize the
  // canvas (that makes the scene jump). Only real width/orientation changes resize.
  const typing = document.activeElement?.tagName === 'INPUT';
  if (typing && window.innerWidth === lastW) return;
  lastW = window.innerWidth;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, R.maxPixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', () => setTimeout(onResize, 250));

// ---------------------------------------------------------------- world
const seed = CONFIG.debug.seed;
const cave = new Cave(seed);
const ambientLight = new AmbientController(hemi, scene.fog, cave);
scene.add(cave.buildMeshes());
const [lanternmouth] = cave.chambers;

const hud = new HUD();
const audio = new GameAudio();
const input = new Input({
  touchLayer: document.getElementById('touch-layer'), canvas,
  joystickEl: document.getElementById('joystick'),
  buttons: {
    jump: document.getElementById('btn-jump'), interact: document.getElementById('btn-interact'),
    build: document.getElementById('btn-build'), chat: document.getElementById('btn-chat'),
    rotate: document.getElementById('btn-rotate'), remove: document.getElementById('btn-remove'),
  },
});

const game = { ready: false, time: 0 };
window.__game = game; // debug/test handle

async function init() {
  startMsg.textContent = 'Gathering kindling…';
  // Load Kenney GLBs in parallel (each falls back to primitives on failure)
  const raw = { raw: true };
  const [decorBoulder, decorPillar, woodParts, stoneParts, flintParts, pitParts, pieceParts, wrenScene, puppyModel,
    wrenHood, crys1, crys2, crys3, crys4, moss1, moss2, moss3, cap1, cap2, torchWall, torchStanding,
    rockA, rockB, rockC, mushroomParts] = await Promise.all([
    loadParts('boulder', { size: 1.0, color: 0x3e4a57 }),
    loadParts('pillar', { size: 0.9, color: 0x2b3440 }),
    loadParts('stick', { size: 0.6 }),
    loadParts('stone', { size: 0.32 }),
    loadParts('stone', { size: 0.26, color: 0x3a3a46, emissive: 0x120804 }), // flint: dark, faint warm sheen
    loadParts('campfire', { size: 1.15 }),
    loadPieceParts(),
    loadScene('companion'), // art-director Wren: 1.7 m, metres, origin at feet, facing +Z
    loadModel('puppy', buildPuppyPrimitive),
    loadScene('companionHood'),
    loadParts('crystal1', raw), loadParts('crystal2', raw), loadParts('crystal3', raw), loadParts('crystal4', raw),
    loadParts('mossClump1', raw), loadParts('mossClump2', raw), loadParts('mossClump3', raw),
    loadParts('mossCap1', raw), loadParts('mossCap2', raw),
    loadParts('torchWall', raw), loadParts('torchStanding', raw),
    loadParts('rockB', { size: 1.1 }), null, null,
    loadParts('mushroomRed', { size: 0.26 }),
  ]);
  const crystalParts = [crys1, crys2, crys3, crys4].filter(Boolean);
  const [surfParts, stewPotP] = await Promise.all([loadSurfaceParts(), loadParts('stewPot', raw)]); // Chunk C
  const gmP = {}; // Chunk D: the Glowmere set
  await Promise.all(['water', 'rock1', 'rock2', 'cap1', 'cap2', 'cap3', 'reeds', 'lily1', 'lily2'].map(async (k) => {
    gmP[k] = await loadParts('gm' + k[0].toUpperCase() + k.slice(1), raw);
  }));
  const [loreNoteP, loreJournalP, loreSlateP, loreHookP, loreJarP] = await Promise.all([
    loadParts('loreNote', raw), loadParts('loreJournal', raw), loadParts('loreSlate', raw), loadParts('loreHook', raw), loadParts('loreJar', raw)]);

  const decor = buildDecor(scene, cave, seed, { boulder: decorBoulder, pillar: decorPillar, skipCrystals: crystalParts.length > 0 });
  const dressing = buildDressing(scene, cave, seed, {
    crystals: crystalParts, mossClumps: [moss1, moss2, moss3], mossCaps: [cap1, cap2], torchWall, torchStanding,
  }, budget, { boulders: decor.boulders });
  if (crystalParts.length) decor.crystals = dressing.crystals; // found_crystal trigger uses the real clusters
  const items = new Items(scene, cave, seed, { wood: woodParts, stone: stoneParts, flint: flintParts, mushroom: mushroomParts });
  const fires = new FireSystem(scene, cave, pitParts, budget);
  const colliders = new Colliders();
  const surface = new Surface(scene, cave, seed, surfParts, { low: CONFIG.debug.low });
  // Chunk C perf: per-instance frustum + fog-distance culling for static instanced decor
  const instCull = new InstanceCuller();
  instCull.addAll(decor.group, 28); instCull.addAll(dressing.group, 28); // chunk D: 32 → 28 m (fog ≥ 94% at 28 m cold; keeps a full 60-piece base under 80k tris)
  for (const m of surface.meshes) instCull.add(m, 26);
  const glowmere = new Glowmere(scene, cave, seed, gmP, colliders);
  const fireflies = new Fireflies(scene, seed);
  const harvest = new Harvest(scene, cave, seed, colliders, [rockA], { variants: treeVariants(surfParts), trees: surface.trees });
  const cooking = new Cooking(scene, stewPotP);
  const dayNight = new DayNight(scene, cave, budget, { low: CONFIG.debug.low });
  dayNight.setProjection(camera);
  const build = new BuildSystem(scene, cave, pieceParts, { fires, budget, colliders });
  build.onChange = (piece, added) => {
    if (piece.type === 'roof') dayNight.setRoofs(build.roofs());
    if (!added && piece.fire) cooking.drop(piece.fire);
  };

  const spawn = new THREE.Vector3(lanternmouth.x + 0.5, 0, lanternmouth.z + 2);
  spawn.y = cave.floorAt(spawn.x, spawn.z);
  const player = new Player(camera, cave, spawn);
  player.yaw = 0.35;
  player.extraFloor = (x, z) => build.heightAt(x, z);
  // footsteps by surface: wood on placed floors, grass out in the clearing, stone in the caves
  player.onStep = () => {
    const x = player.pos.x, z = player.pos.z;
    audio.step(build.heightAt(x, z) > -Infinity && player.pos.y >= build.heightAt(x, z) - 0.02 ? 'wood' : cave.surfaceAt(x, z) > 0.5 ? 'grass' : 'stone');
  };
  player.colliders = colliders;
  harvest.canRespawn = (n) => !build.pieces.some((p) => Math.hypot(p.x - n.pos.x, p.z - n.pos.z) < 1.4);
  build.blocked = (x, z, r) => cave.lakeAt(x, z, r * 0.6) || harvest.nodes.some((n) => n.alive && Math.hypot(n.pos.x - x, n.pos.z - z) < r + (n.type === 'tree' ? 0.5 : 0.45));

  const pModel = puppyModel.fromFile || puppyModel.parts.legs ? puppyModel : { ...buildPuppyPrimitive(), animations: [] };
  const puppy = new Puppy(scene, cave, pModel, spawn.clone().add(new THREE.Vector3(-1.2, 0, -1.5)));
  const hoodUp = wrenHood?.root.getObjectByName('hood_up') || null;
  const wrenModel = wrenScene ? { ...wrenScene, hoodUp } : { root: buildWrenPrimitive().root, animations: [] };
  const wren = new Wren(scene, cave, wrenModel, spawn.clone().add(new THREE.Vector3(1.8, 0, -1.2)), budget);
  // companions steer around placed pieces and stand on floors (Chunk B)
  puppy.colliders = colliders; wren.colliders = colliders;
  puppy.floorAt = wren.floorAt = (x, z) => build.heightAt(x, z);
  const lore = new LoreNotes(scene, cave, seed, { note: loreNoteP, journal: loreJournalP, slate: loreSlateP, hook: loreHookP, jar: loreJarP, clearingBirch: surface.clearingBirch, glowmereJar: glowmere.jarSpot });
  const reader = new ParchmentReader(document.getElementById('reader'));
  const requests = new Requests();
  const keepsakesFound = new Set();
  let dayCount = 1, shelterComplete = false;

  // ------------------------------------------------------------ companion brain
  const adapter = createAdapter(CONFIG.llm);
  const memory = new CompanionMemory(adapter);
  const ambient = new AmbientLines({ getState: () => gameState() });
  const recentFinds = [];
  let currentArea = lanternmouth;
  // Chunk C: one clock for the whole world — DayNight.tod (24-min cycle, STYLE_GUIDE §8.2). Words for
  // Wren's CONTEXT time_of_night field; `time` (day|dusk|night|deep_night) goes to the when filters.
  const timeOfNight = () => {
    const t = dayNight.tod;
    if (t < DN.dayEnd) return t < 300 ? 'morning' : 'afternoon';
    if (t < DN.duskEnd) return 'dusk';
    if (t < 840) return 'evening'; if (t < 1200) return 'deep night'; if (t < DN.nightEnd) return 'pre-dawn';
    return 'dawn';
  };
  // Warmth (CONFIG.warmth): never harmful. Cold only brings a frost vignette, Wren's line and Biscuit.
  const WC = CONFIG.warmth;
  let warmth = WC.start, warmWord = 'ok', stewHold = 0;
  let fogK = 0; // 0 = cold/thick … 1 = warm/thin

  function nearestFireLevel() {
    const f = fires.nearest(player.pos, Infinity, true);
    if (!f) return { fire: fires.nearest(player.pos), level: 0, lit: false };
    return { fire: f, level: Math.round(Math.min(1, f.fuel / (FC.secondsPerStick * 4)) * 100), lit: true };
  }
  const fogState = () => (fogK >= 0.4 ? 'thin' : fogK > 0.02 ? 'thickening' : 'thick');

  /** State keys for the writer's `when` filters (story/DATA_FORMATS.md). */
  function worldState() {
    const { level, lit } = nearestFireLevel();
    const inShelter = build.inShelter(player.pos);
    const sel = invUI?.selected;
    return {
      fire: !lit ? 'out' : level < 25 ? 'low' : level > 75 ? 'roaring' : 'lit',
      time: timeWord(dayNight.tod),
      area: inShelter ? 'shelter' : currentArea?.id ?? null,
      inShelter,
      weather: dayNight.weather,
      warmth: warmWord,
      inventory: { ...player.inventory },
      biscuit: puppy.mood,
      dayCount,
      fog: fogState(),
      holding: sel && player.inventory[sel] > 0 ? sel : null,
    };
  }
  function gameState() {
    const { level, lit } = nearestFireLevel();
    const counts = {};
    for (const k of recentFinds) counts[k] = (counts[k] || 0) + 1;
    return {
      location: currentArea ? currentArea.name : 'a winding tunnel',
      locationDesc: currentArea ? currentArea.desc : 'narrow, cold air moving through',
      fire: { anyLit: lit, level, levelWord: fireLevelWord(level, lit) },
      timeOfNight: timeOfNight(),
      shelter: build.summary(),
      recentFinds: Object.entries(counts).map(([k, n]) => `${k} x${n}`).join(', '),
      memorySummary: memory.data.memory_summary,
      puppy: puppy.status,
      fog: fogState(),
      playerName: CONFIG.playerName,
      inventory: { ...player.inventory },
      areaName: currentArea ? currentArea.name : 'the Hollow',
      dayCount,
      time: timeWord(dayNight.tod), weather: dayNight.weather, warmth: warmWord,
      world: worldState(),
    };
  }
  const foundTrigger = (kind) => (kind === 'crystal_shard' ? 'found_crystal' : kind === 'glowcap' ? 'found_mushroom' : `found_${kind}`);

  const chat = new ChatUI({
    adapter, memory, getState: gameState,
    onOpen: () => { input.enabled = false; input.reset(); if (document.pointerLockElement) document.exitPointerLock(); setTimeout(talkRequests, 250); },
    onClose: () => { input.enabled = true; },
  });
  ambient.onLine = (trigger, line) => { hud.say(line); chat.addAmbient(line); };

  // ------------------------------------------------------------ hotbar, pack, chest
  const invUI = new InventoryUI({
    onSelectPiece: (t) => { build.select(t); hud.setRemoveActive(false); invUI.setPalette(t, player.inventory); },
    onStick: () => throwStick(),
    onReadNote: (id) => openNote(id),
    isAvailable: (t, inv) => {
      const P = PIECES[t];
      if (P.decor || P.keepsake) return (inv[t] || 0) > 0;
      if (P.locked) return requests.unlocked.has(t);
      return true;
    },
    onStore: (k) => moveItems(player.inventory, invUI.chestData?.store, k),
    onTake: (k) => moveItems(invUI.chestData?.store, player.inventory, k),
    onPanel: (open, was, data) => {
      if (open) { input.enabled = false; input.reset(); if (document.pointerLockElement) document.exitPointerLock(); }
      else { input.enabled = true; if (was === 'chest' && data?.piece) build.setChestOpen(data.piece, false); if (!matchMedia('(pointer: coarse)').matches) input.requestPointerLock(); }
    },
  });
  invUI.bindInventory(player.inventory);
  function moveItems(from, to, k) {
    if (!from || !to || !(from[k] > 0)) return;
    to[k] = (to[k] || 0) + from[k]; from[k] = 0; audio.blip(560);
    invUI.renderChest(); invUI.setInventory(player.inventory);
  }
  function openChest(p) {
    build.setChestOpen(p, true); audio.blip(300);
    invUI.open('chest', { piece: p, store: p.store, inv: player.inventory });
  }

  // ------------------------------------------------------------ Biscuit: fetch, dig, barks
  const woofEl = document.getElementById('woof');
  let woofT = 0;
  puppy.onBark = () => { woofT = 1.3; woofEl.classList.add('show'); audio.bark?.(); };
  function throwStick() {
    if (!running || paused) return;
    const st = puppy.stick;
    if (st.state !== 'hand') { hud.toast(`${CONFIG.puppy.name} still has the stick`, 1.2); return; }
    const from = camera.getWorldPosition(new THREE.Vector3()).addScaledVector(player.forward, 0.5);
    from.y -= 0.25;
    if (st.throw(from, player.forward)) { audio.blip(500); hud.toast(`Fetch, ${CONFIG.puppy.name}!`, 1.2); }
  }
  const digLog = [];
  puppy.onDig = () => {
    const inv = player.inventory, area = currentArea?.id;
    const finds = (STORY.biscuitFinds.finds || []).filter((f) => !f.areas || f.areas.includes(area));
    if (!finds.length) return;
    const f = weighted(finds);
    digLog.push(f.id);
    if (f.givesItem) {
      inv[f.givesItem.item] = (inv[f.givesItem.item] || 0) + (f.givesItem.count || 1);
      hud.toast(`🐾 ${CONFIG.puppy.name} dug up ${f.name}! +${f.givesItem.count || 1} ${ITEM_INFO[f.givesItem.item]?.label || f.givesItem.item}`, 3);
    } else if (f.keepsake) {
      inv[f.id] = (inv[f.id] || 0) + 1; keepsakesFound.add(f.id);
      hud.toast(`🐾 Keepsake: ${f.name}. ${f.flavor}${f.placeNote ? ' ' + f.placeNote : ''}`, 4.5);
      memory.addFact('find', `Biscuit dug up a keepsake: ${f.name}`, f.rarity === 'rare' ? 3 : 1);
    } else hud.toast(`🐾 ${CONFIG.puppy.name} dug up ${f.name}. ${f.flavor}`, 3.5);
    audio.blip(760);
    if (f.rarity === 'rare' && f.wrenLine?.length) ambient.sayNow(f.wrenLine[Math.floor(Math.random() * f.wrenLine.length)], 'biscuit_dig_find');
    else ambient.trigger('biscuit_dig_find');
  };

  // ------------------------------------------------------------ requests
  const rqEl = document.getElementById('request'), rqTitle = rqEl.querySelector('.rq-title'), rqNeeds = rqEl.querySelector('.rq-needs'), rqGive = document.getElementById('rq-give');
  let rqHtml = '', offerCooldown = 0;
  function talkRequests() {
    const st = gameState(), inv = player.inventory;
    if (requests.active) {
      const pr = requests.progress(inv);
      if (pr.ready) completeRequest(); else ambient.sayNow(requests.progressLine(st), 'request');
    } else {
      const line = requests.offer(st.world, st);
      if (line) { ambient.sayNow(line, 'request'); audio.blip(640); }
    }
  }
  function completeRequest() {
    const res = requests.complete(player.inventory, gameState());
    if (!res) return false;
    ambient.sayNow(res.line, 'request');
    const rw = res.reward, nm = PIECES[rw.id]?.name || ITEM_INFO[rw.id]?.label || rw.id;
    hud.toast(rw.type === 'build_piece' ? `🔨 New build piece: ${nm}` : rw.type === 'decoration' ? `🎁 ${nm}: place it from 🔨` : `🎁 +${rw.count || 1} ${nm}`, 3.2);
    audio.blip(880); audio.blip(1100);
    memory.addFact('milestone', `Cam finished Wren's request: ${res.r.title}`, 2);
    return true;
  }
  onTap(rqGive, () => completeRequest());
  function updateRequests(dt) {
    const inv = player.inventory, dw = Math.hypot(wren.pos.x - player.pos.x, wren.pos.z - player.pos.z);
    // offer when Cam idles near Wren
    offerCooldown -= dt;
    if (!requests.active && offerCooldown <= 0 && dw < 4 && player.stillTime > 8 && !chat.open) {
      offerCooldown = 60; const st = gameState(); const line = requests.offer(st.world, st);
      if (line) ambient.sayNow(line, 'request');
    }
    const pr = requests.progress(inv);
    let html = '';
    if (pr) html = pr.rows.map((r) => `<span class="${r.have >= r.need ? 'ok' : ''}">${ITEM_INFO[r.item]?.label || r.item} ${r.have}/${r.need}</span>`).join(' · ');
    rqEl.classList.toggle('hidden', !pr);
    if (pr && html !== rqHtml) { rqTitle.textContent = `Wren: ${pr.r.title}`; rqNeeds.innerHTML = html; rqHtml = html; }
    rqGive.classList.toggle('hidden', !(pr?.ready && dw < 4));
  }

  // ------------------------------------------------------------ lore notes
  function openNote(id) {
    const n = lore.get(id); if (!n) return;
    invUI.close(true); invUI.onPanel?.(null);
    reader.show(n);
    input.enabled = false; input.reset(); if (document.pointerLockElement) document.exitPointerLock();
    if (lore.markRead(id)) {
      invUI.setJournal(lore.journal()); hud.toast('📜 Added to your journal (🎒)', 2);
      memory.addFact('find', `Cam read a note: ${n.title}`, 1);
    }
    audio.blip(420);
  }
  reader.onClose = () => { input.enabled = true; if (!matchMedia('(pointer: coarse)').matches && running) input.requestPointerLock(); };

  // ------------------------------------------------------------ save / load
  let titleFire = null;
  const savedFires = () => fires.fires.filter((f) => !f.hearth && f !== titleFire);
  function snapshot() {
    const P = player.pos;
    return {
      player: { x: +P.x.toFixed(3), y: +P.y.toFixed(3), z: +P.z.toFixed(3), yaw: +player.yaw.toFixed(4) },
      inventory: { ...player.inventory },
      pieces: build.serialize(),
      hearths: build.pieces.filter((p) => p.fire).map((p) => ({ id: p.id, fuel: +p.fire.fuel.toFixed(1) })),
      fires: savedFires().map((f) => ({ x: +f.pos.x.toFixed(3), y: +f.pos.y.toFixed(3), z: +f.pos.z.toFixed(3), fuel: +f.fuel.toFixed(1) })),
      requests: requests.serialize(),
      notes: [...lore.read],
      keepsakesFound: [...keepsakesFound],
      dayCount, shelterComplete,
      // Chunk C
      world: dayNight.serialize(),
      warmth: +warmth.toFixed(1), stewHold: Math.round(stewHold),
      harvest: harvest.serialize(), items: items.serialize(),
      pots: cooking.serialize((f) => { const h = build.pieces.find((q) => q.fire === f); if (h) return 'h' + h.id; const i = savedFires().indexOf(f); return i >= 0 ? 'f' + i : null; }),
    };
  }
  function applySave(d) {
    const inv = player.inventory;
    for (const k of Object.keys(inv)) inv[k] = 0;
    Object.assign(inv, d.inventory || {});
    build.clearAll();
    build.restore(d.pieces || []);
    for (const h of d.hearths || []) { const p = build.pieces.find((q) => q.id === h.id); if (p?.fire) p.fire.fuel = h.fuel || 0; }
    const restoredFires = (d.fires || []).map((f) => { const nf = fires.build(new THREE.Vector3(f.x, f.y, f.z), 0); nf.fuel = f.fuel || 0; return nf; });
    if (d.player) {
      player.pos.set(d.player.x, d.player.y, d.player.z); player.yaw = d.player.yaw || 0;
      wren.pos.copy(player.pos).add(new THREE.Vector3(1.4, 0, 1)); cave.resolve(wren.pos, 0.6); colliders.resolve(wren.pos, 0.35);
      puppy.pos.copy(player.pos).add(new THREE.Vector3(-1.1, 0, 0.9)); cave.resolve(puppy.pos, 0.55); colliders.resolve(puppy.pos, 0.3);
    }
    requests.restore(d.requests);
    lore.read = new Set(d.notes || []); invUI.setJournal(lore.journal());
    for (const k of d.keepsakesFound || []) keepsakesFound.add(k);
    dayCount = d.dayCount || 1; shelterComplete = !!d.shelterComplete;
    // Chunk C (older saves: no world → a fresh morning, full-ish warmth, everything standing)
    dayNight.restore(d.world || { tod: 60 });
    warmth = Number.isFinite(d.warmth) ? d.warmth : WC.start; stewHold = d.stewHold || 0;
    harvest.restore(d.harvest); items.restore(d.items);
    cooking.restore(d.pots, (k) => (typeof k !== 'string' ? null : k[0] === 'h' ? build.pieces.find((q) => 'h' + q.id === k)?.fire : restoredFires[+k.slice(1)]));
    dayNight.setRoofs(build.roofs());
    currentArea = cave.chamberAt(player.pos.x, player.pos.z) || currentArea;
  }
  let lastSaveAt = 0;
  function saveNow(why = 'auto') {
    if (!started) return false;
    const ok = writeSave(snapshot());
    if (ok) { lastSaveAt = performance.now(); game.lastSave = { why, at: Date.now() }; }
    return ok;
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow('hidden'); });
  window.addEventListener('pagehide', () => saveNow('pagehide'));

  // ------------------------------------------------------------ pause menu
  let paused = false;
  const pauseEl = document.getElementById('pause'), pauseNote = document.getElementById('pause-note');
  function setPaused(on) {
    if (!running) return;
    paused = on; pauseEl.classList.toggle('hidden', !on);
    if (!on && settings.isOpen) settings.el.classList.add('hidden');
    if (on) { input.enabled = false; input.reset(); if (document.pointerLockElement) document.exitPointerLock(); pauseNote.textContent = game.lastSave ? `Last saved ${new Date(game.lastSave.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''; }
    else { input.enabled = true; if (!matchMedia('(pointer: coarse)').matches) input.requestPointerLock(); }
  }
  onTap(document.getElementById('btn-pause'), () => setPaused(!paused));
  onTap(document.getElementById('pause-resume'), () => setPaused(false));
  onTap(document.getElementById('pause-close'), () => setPaused(false));
  // Chunk D: settings (title + pause), saved to localStorage; see src/ui/settings.js
  player.baseFov = R.fov;
  const settings = new SettingsPanel({
    apply: (st) => { audio.setVolumes({ master: st.master, music: st.music, effects: st.effects }); input.sens = st.sens; player.invertY = !!st.invertY; },
    beforeReload: () => { if (running) saveNow('settings'); },
    onClose: () => { if (paused) pauseEl.classList.remove('hidden'); },
  });
  onTap(document.getElementById('pause-settings'), () => { pauseEl.classList.add('hidden'); settings.open(); });
  onTap(document.getElementById('pause-save'), () => { pauseNote.textContent = saveNow('manual') ? 'Game saved ✓' : 'Could not save (storage full or private mode)'; audio.blip(700); });

  // ------------------------------------------------------------ session end → memory summary
  let lastActivity = performance.now(), sessionOpen = true;
  const touch = () => {
    lastActivity = performance.now();
    if (!sessionOpen) { sessionOpen = true; memory.newSession(); }
  };
  for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, touch, true);
  const endSession = (why) => { if (!sessionOpen) return; sessionOpen = false; memory.summarize(`session end (${why})`); };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) endSession('backgrounded'); else touch();
  });
  window.addEventListener('pagehide', () => endSession('closed'));

  // ------------------------------------------------------------ interaction
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let ctxAction = null;
  let lastFogWord = 'thick';
  const fireWatch = new Map(); // fire -> {wasLit, wasLow}
  let proxCheck = 0, poiCheck = 0, lastItemBark = -1e9;
  const visited = new Set(['lanternmouth']), barked = new Set(), barkedItems = new WeakSet();
  const seenMushroom = { at: -1e9 }, seenCrystal = { at: -1e9 };

  function canBuildFireHere() {
    const f = player.forward;
    const p = new THREE.Vector3(player.pos.x + f.x * 1.6, 0, player.pos.z + f.z * 1.6);
    if (cave.field(p.x, p.z) < 1.1) return null;
    if (fires.nearest(p, 3.5)) return null;
    p.y = Math.max(cave.floorAt(p.x, p.z), build.heightAt(p.x, p.z));
    return p;
  }

  function chooseAction() {
    const inv = player.inventory, fwd = player.forward;
    if (build.active) {
      if (build.removeMode) { const p = build.target?.remove; return p ? { label: `Remove ${PIECES[p.type].name.toLowerCase()}`, kind: 'remove' } : { label: 'Remove…', kind: 'remove' }; }
      return { label: `Place ${PIECES[build.selected].name.toLowerCase()}`, kind: 'build' };
    }
    if (player.seat) return { label: 'Stand up', kind: 'stand' };
    const it = items.findTarget(player.pos, fwd);
    if (it) return { label: `Pick up ${ITEM_INFO[it.kind].label}`, kind: 'pick', it };
    const note = lore.findTarget(player.pos, fwd);
    if (note) return { label: lore.read.has(note.id) ? 'Read again' : 'Read note', kind: 'read', note };
    let node = harvest.findTarget(player.pos, fwd);
    const bp = build.findInteractable(player.pos, fwd);
    if (node && bp && Math.hypot(bp.x - player.pos.x, bp.z - player.pos.z) < Math.hypot(node.pos.x - player.pos.x, node.pos.z - player.pos.z)) node = null; // nearer one wins
    if (node) return { label: node.type === 'tree' ? 'Hold: chop' : 'Hold: break', kind: 'harvest', node };
    const seat = findSeat();
    if (seat && !(bp && Math.hypot(bp.x - player.pos.x, bp.z - player.pos.z) < seat.d)) return { label: seat.label, kind: 'sit', seat };
    if (bp) return bp.type === 'door' ? { label: bp.openTarget ? 'Close door' : 'Open door', kind: 'door', piece: bp }
      : bp.type === 'bedroll' ? { label: 'Sleep', kind: 'sleep', piece: bp } : { label: 'Open chest', kind: 'chest', piece: bp };
    // Chunk C: cooking on a lit campfire / hearth (selecting a mushroom or glowcap puts cooking first)
    const cf = fires.nearest(player.pos, 2.2);
    if (cf) {
      const pot = cooking.potFor(cf), ing = pickIngredient(), sel = invUI.selected;
      const wantsCook = ing && (sel === 'mushroom' || sel === 'glowcap' || !(inv.wood > 0 && cf.canAddFuel()));
      if (pot?.state === 'done') return { label: 'Take stew', kind: 'stew-take', pot };
      if (pot?.state === 'idle' && wantsCook) return { label: `Add ${ITEM_INFO[ing].label}`, kind: 'stew-add', pot, ing };
      if (!pot && cf.lit && wantsCook) return { label: 'Hang stew pot', kind: 'stew-hang', fire: cf };
    }
    const nf = fires.nearest(player.pos, 2.4);
    if (nf && inv.wood > 0 && nf.canAddFuel()) return { label: nf.lit ? 'Add wood' : 'Relight', kind: 'fuel', fire: nf };
    const dw = Math.hypot(wren.pos.x - player.pos.x, wren.pos.z - player.pos.z);
    const db = Math.hypot(puppy.pos.x - player.pos.x, puppy.pos.z - player.pos.z);
    if (db < 1.8) return { label: `Pet ${CONFIG.puppy.name}`, kind: 'pet' };
    if (invUI.selected === 'stew' && inv.stew > 0) return { label: 'Eat stew', kind: 'eat' };
    if (inv.wood >= FC.woodToBuild && inv.flint >= FC.flintToBuild) {
      const spot = canBuildFireHere();
      if (spot) return { label: 'Light fire', kind: 'fire', spot };
    }
    if (dw < 2.4) return { label: 'Talk', kind: 'talk' };
    return null;
  }

  // Chunk D: places to sit — the Glowmere shore rock, and any placed lakeside bench (sit_point_A/B)
  function benchSeat(p) {
    const c = Math.cos(p.yaw), sn = Math.sin(p.yaw);
    const at = (lx) => new THREE.Vector3(p.x + lx * c, p.y + 0.47, p.z - lx * sn); // sit_point_A/B (±0.35, 0.47, 0)
    const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw); // the bench faces local +Z (toward the lake)
    const st = new THREE.Vector3(p.x - fx * 0.9, 0, p.z - fz * 0.9);
    return { id: `bench:${p.id}`, bench: true, pos: at(-0.35), yaw: Math.atan2(-fx, -fz), wren: { pos: at(0.35), heading: p.yaw }, stand: st };
  }
  function findSeat() {
    let best = null;
    const consider = (seat, cx, cz, label) => {
      const d = Math.hypot(cx - player.pos.x, cz - player.pos.z);
      if (d < 1.9 && (!best || d < best.d)) best = { ...seat, d, label };
    };
    const gs = glowmere.seat;
    consider(gs, (gs.pos.x + gs.wren.pos.x) / 2, (gs.pos.z + gs.wren.pos.z) / 2, 'Sit by the water');
    for (const p of build.pieces) if (p.type === 'lakeside_bench') consider(benchSeat(p), p.x, p.z, 'Sit on the bench');
    return best;
  }
  function sitDown(seat) {
    player.sit(seat); wren.seat = seat.wren; input.reset?.();
    const atLake = glowmere.weight(player.pos) > 0.3;
    if (atLake) { ambient.trigger('glowmere_sit', { force: !visited.has('glowmere_sit') }); visited.add('glowmere_sit'); memory.addFact('moment', 'Cam and Wren sat together by the Glowmere', 2); }
    hud.toast(atLake ? 'You sit by the water. Move to stand up' : 'You sit a while. Move to stand up', 2.4);
  }
  player.onStand = () => { wren.seat = null; };

  function pickIngredient() {
    const inv = player.inventory, sel = invUI.selected;
    if ((sel === 'mushroom' || sel === 'glowcap') && inv[sel] > 0) return sel;
    return inv.glowcap > 0 ? 'glowcap' : inv.mushroom > 0 ? 'mushroom' : null;
  }
  function eatStew() {
    const inv = player.inventory;
    if (!(inv.stew > 0)) return false;
    inv.stew--; warmth = Math.min(100, warmth + WC.stew); stewHold = WC.stewHold;
    hud.toast('Warm mushroom stew. Toes thawing 🍲', 2); audio.blip(520);
    ambient.trigger('stew_eaten', { force: true });
    return true;
  }

  function doAction(a) {
    const inv = player.inventory;
    if (!a) {
      if (inv.wood >= FC.woodToBuild && inv.flint >= FC.flintToBuild) hud.toast('Find a clear, flat spot for the fire');
      return;
    }
    switch (a.kind) {
      case 'pick': {
        items.pickUp(a.it); inv[a.it.kind]++; audio.blip(a.it.kind === 'flint' ? 880 : 620);
        recentFinds.push(a.it.kind === 'wood' ? 'wood' : a.it.kind); if (recentFinds.length > 5) recentFinds.shift();
        hud.toast(`+1 ${ITEM_INFO[a.it.kind].label}`, 1.2);
        ambient.trigger(foundTrigger(a.it.kind));
        if (a.it.kind === 'flint') memory.addFact('find', `Cam found flint for the first time`, 2);
        break;
      }
      case 'fuel': {
        const wasLit = a.fire.lit;
        a.fire.addWood(1); inv.wood--; audio.blip(440); audio.pop(0.8);
        hud.toast(wasLit ? 'The fire crackles brighter' : 'The embers catch again', 1.6);
        if (!wasLit) ambient.trigger('fire_lit');
        break;
      }
      case 'fire': {
        inv.wood -= FC.woodToBuild; inv.flint -= FC.flintToBuild;
        fires.build(a.spot, FC.woodToBuild);
        hud.toast('🔥 Campfire lit!', 2.5); audio.blip(330); audio.pop(1);
        ambient.trigger('fire_lit');
        memory.addFact('milestone', 'Cam lit their first campfire in the Hollow', 3);
        break;
      }
      case 'pet': puppy.pet(); hud.toast(`${CONFIG.puppy.name} wiggles happily`, 1.6); break;
      case 'read': openNote(a.note.id); break;
      case 'eat': eatStew(); break;
      case 'sleep': openSleep(); break;
      case 'stew-hang': {
        const pot = cooking.hang(a.fire); if (!pot) break;
        audio.blip(300); hud.toast(`Stew pot on. Add ${CONFIG.cooking.ingredients} mushrooms or glowcaps`, 2.2);
        const ing = pickIngredient(); if (ing) addIngredient(pot, ing);
        break;
      }
      case 'stew-add': addIngredient(a.pot, a.ing); break;
      case 'stew-take':
        if (cooking.take(a.pot)) { inv.stew = (inv.stew || 0) + 1; invUI.select('stew'); hud.toast('+1 stew 🍲 (tap it again to eat)', 2.2); audio.blip(700); }
        break;
      case 'talk': chat.show(); break;
      case 'sit': sitDown(a.seat); break;
      case 'stand': player.stand(); break;
      case 'harvest': break; // hold-driven, see updateHold()
      case 'door': { const open = build.toggleDoor(a.piece); audio.blip(open ? 240 : 200); break; }
      case 'chest': openChest(a.piece); break;
      case 'build': {
        const r = build.place(inv);
        if (r.ok) {
          const name = PIECES[r.piece.type].name;
          hud.toast(`${name} placed`, 1.2); audio.blip(360);
          if (!shelterComplete && build.enclosedCells().size) {
            shelterComplete = true; ambient.trigger('shelter_complete', { force: true });
            memory.addFact('milestone', 'Cam finished a real shelter: floor, walls, roof and a door', 3);
            hud.toast('🏠 Shelter complete!', 2.6);
          } else ambient.trigger('build_piece_placed');
          if (build.pieces.length === 1) memory.addFact('milestone', 'Cam started building a shelter', 3);
          if (r.piece.type === 'hearth') hud.toast('Hearth built. Add wood to light it', 2.4);
        } else hud.toast(r.why, 1.8);
        break;
      }
      case 'remove': {
        const r = build.remove(inv);
        if (r.ok) { hud.toast(`Removed ${PIECES[r.piece.type].name.toLowerCase()} (refunded ${Object.entries(r.refund).map(([k, n]) => `${n} ${k}`).join(' + ')})`, 1.8); audio.blip(260); }
        else hud.toast(r.why, 1.8);
        break;
      }
    }
  }

  function addIngredient(pot, kind) {
    const inv = player.inventory;
    if (!(inv[kind] > 0)) return;
    inv[kind]--;
    const started = cooking.add(pot, kind);
    audio.blip(480);
    if (started) { hud.toast('Bubbling away… 🍲', 2); ambient.trigger('stew_cooking', { force: true }); }
    else hud.toast(`${ITEM_INFO[kind].label} in. ${CONFIG.cooking.ingredients - pot.ingredients.length} more`, 1.6);
  }

  // ------------------------------------------------------------ sleep (bed roll)
  const sleepEl = document.getElementById('sleep'), sleepNote = document.getElementById('sleep-note'), fadeEl = document.getElementById('fade');
  let sleeping = false;
  function openSleep() {
    if (sleeping) return;
    if (!canSleepAt(dayNight.tod)) { hud.toast("It's still daytime. The bed roll can wait till dusk", 2.4); return; }
    sleepNote.textContent = `Sleep until morning? (Day ${dayCount})`;
    sleepEl.classList.remove('hidden');
    input.enabled = false; input.reset(); if (document.pointerLockElement) document.exitPointerLock();
  }
  function closeSleep() {
    sleepEl.classList.add('hidden');
    if (!sleeping) { input.enabled = true; if (!matchMedia('(pointer: coarse)').matches && running) input.requestPointerLock(); }
  }
  const sleepLine = (list) => {
    const st = gameState(); const tier = bestTier(list || [], st.world);
    return tier.length ? fill(weighted(tier).text, st) : null;
  };
  function doSleep() {
    if (sleeping) return;
    sleeping = true; sleepEl.classList.add('hidden');
    puppy.curlUp(player);                            // Biscuit curls up first (goodnight lines can see it)
    const gn = sleepLine(STORY.sleepLines?.goodnight);
    if (gn) ambient.sayNow(gn, 'goodnight');
    fadeEl.classList.add('on');
    setTimeout(() => {
      dayNight.tod = DN.morning; lastTod = DN.morning; lastTimeWord = 'day'; dayCount++; // skip to morning (fires aren't simulated overnight)
      if (warmth < 60) warmth = 60;
      dayNight.update(0, { advance: false, camPos: camera.getWorldPosition(_camPos), hemi, fog: scene.fog, scene, caveDensity: scene.fog.density });
      game.lastNight = { day: dayCount };
      saveNow('sleep');
      setTimeout(() => {
        fadeEl.classList.remove('on'); sleeping = false;
        input.enabled = true;
        const gm = sleepLine(STORY.sleepLines?.goodMorning);
        if (gm) ambient.sayNow(gm, 'goodMorning');
        hud.toast(`☀ Day ${dayCount}`, 2.4);
      }, 900);
    }, 1700);
  }
  onTap(document.getElementById('sleep-yes'), () => doSleep());
  onTap(document.getElementById('sleep-no'), () => closeSleep());
  onTap(document.getElementById('sleep-close'), () => closeSleep());
  invUI.onEat = () => { if (running && !paused) eatStew(); };

  // hold-to-gather: hold Use on the targeted tree/rock, or press and hold on it (touch)
  let hold = null;
  function updateHold(dt) {
    const inv = player.inventory;
    let node = null, src = null, lh = null;
    if (!build.active && !invUI.openPanel && input.enabled) {
      if (input.held.has('interact') && ctxAction?.kind === 'harvest') { node = ctxAction.node; src = 'use'; }
      else if (hold?.src === 'use' && input.held.has('interact') && hold.node.alive) { node = hold.node; src = 'use'; }
      else if ((lh = input.lookHold) && lh.ms > 180) {
        node = hold?.src === 'touch' && hold.node.alive ? hold.node : harvest.pickScreen(lh.x, lh.y, camera, player.pos);
        src = 'touch';
      }
    }
    if (node && Math.hypot(node.pos.x - player.pos.x, node.pos.z - player.pos.z) > harvest.cfg(node).reach + 0.6) node = null;
    if (!node) { hold = null; invUI.setRing(null); return; }
    if (!hold || hold.node !== node) hold = { node, src, t: 0, tick: 0 };
    const dur = harvest.cfg(node).seconds;
    hold.t += dt;
    harvest.shake(node, hold.t / dur);
    if ((hold.tick -= dt) <= 0) { hold.tick = 0.32; audio.blip(node.type === 'tree' ? 180 + Math.random() * 30 : 130 + Math.random() * 25); }
    const sp = src === 'touch' && lh ? lh : harvest.screenPos(node, camera);
    invUI.setRing(hold.t / dur, sp.x, sp.y, node.type === 'tree' ? '🪓' : '⛏️');
    if (hold.t >= dur) {
      const got = harvest.harvest(node);
      for (const [k, n] of Object.entries(got)) inv[k] = (inv[k] || 0) + n;
      hud.toast(Object.entries(got).map(([k, n]) => `+${n} ${ITEM_INFO[k].label}`).join('  '), 1.4);
      audio.blip(node.type === 'tree' ? 520 : 700);
      const kind = node.type === 'tree' ? 'wood' : 'stone';
      recentFinds.push(kind); if (recentFinds.length > 5) recentFinds.shift();
      ambient.trigger(foundTrigger(kind));
      if (got.flint) ambient.trigger('found_flint');
      hold = null;
      invUI.setRing(null);
    }
  }

  function handleTaps() {
    for (const t of input.taps) {
      const nt = !build.active && lore.pickScreen(t.x, t.y, camera, player.pos);
      if (nt) { openNote(nt.id); continue; }
      const bp = build.pickScreen(t.x, t.y, camera, player.pos);
      if (bp && !build.active) {
        if (bp.type === 'door') { const open = build.toggleDoor(bp); audio.blip(open ? 240 : 200); }
        else if (bp.type === 'bedroll') openSleep();
        else openChest(bp);
        continue;
      }
      ndc.set((t.x / window.innerWidth) * 2 - 1, -(t.y / window.innerHeight) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const hitW = raycaster.intersectObject(wren.hit, false)[0];
      const hitP = raycaster.intersectObject(puppy.root, true)[0];
      if (hitP && (!hitW || hitP.distance < hitW.distance) && hitP.distance < 5) { puppy.pet(); hud.toast(`${CONFIG.puppy.name} wiggles happily`, 1.6); }
      else if (hitW && hitW.distance < 12) chat.show();
    }
  }

  // ------------------------------------------------------------ per-frame systems
  function updateTriggers(dt) {
    // areas
    const area = cave.chamberAt(player.pos.x, player.pos.z);
    if (area && area !== currentArea) {
      hud.showArea(area.name);
      if (!memory.hasFact(`Cam explored ${area.name}`) && area !== lanternmouth) {
        memory.addFact('milestone', `Cam explored ${area.name}`, 2);
      }
      if (area.surface) ambient.trigger('enter_clearing', { force: !visited.has(area.id) });
      else if (area.id === 'glowmere') ambient.trigger('enter_glowmere', { force: !visited.has(area.id) });
      else if (area !== lanternmouth) ambient.trigger('new_area');
      if (!visited.has(area.id)) { visited.add(area.id); if (area !== lanternmouth) puppy.bark('area'); }
    }
    if (area) currentArea = area; else if (currentArea && cave.field(player.pos.x, player.pos.z) < 2.6) currentArea = null;

    // fires: lit / low / out
    for (const f of fires.fires) {
      const w = fireWatch.get(f) || { wasLit: false, wasLow: false };
      const low = f.lit && f.fuel < FC.secondsPerStick * 4 * FC.lowFrac;
      if (w.wasLit && !f.lit) ambient.trigger('fire_out');
      else if (low && !w.wasLow) ambient.trigger('fire_low');
      fireWatch.set(f, { wasLit: f.lit, wasLow: low });
    }
    // fog
    const fw = fogState();
    if (fw === 'thickening' && lastFogWord === 'thin') ambient.trigger('fog_thickening');
    lastFogWord = fw;

    // proximity finds (mushrooms / crystals), checked twice a second
    if ((proxCheck -= dt) <= 0) {
      proxCheck = 0.5;
      const near = (pts) => pts.some((p) => Math.hypot(p.x - player.pos.x, p.z - player.pos.z) < 2.2);
      if (near(decor.mushrooms)) ambient.trigger('found_mushroom');
      if (near(decor.crystals)) { ambient.trigger('found_crystal'); memory.addFact('find', 'Cam saw the humming purple crystals', 1); }
    }
    // Chunk C: day/night + weather (DayNight advances the clock in the frame loop)
    const tw = timeWord(dayNight.tod);
    if (tw === 'deep_night' && lastTimeWord !== 'deep_night') ambient.trigger('night_deepens');
    if (dayNight.tod < lastTod - DAY_CYCLE / 2) { dayCount++; ambient.trigger('morning'); } // stayed up all night
    lastTimeWord = tw; lastTod = dayNight.tod;
    const onSurface = dayNight.b > 0.5;
    if (dayNight.weather === 'rain' && lastWeather !== 'rain') { rainSpell++; if (dayNight.b > 0.02 || cave.depthIntoCave(player.pos.x, player.pos.z) < 14) ambient.trigger('rain_start', { force: true }); }
    lastWeather = dayNight.weather;
    if (dayNight.rainK > 0.5 && onSurface && build.underRoof(player.pos) && roofSpell !== rainSpell) { roofSpell = rainSpell; ambient.trigger('rain_on_roof', { force: true }); }
    const nightNo = dayCount * 2 + (dayNight.tod >= DN.dayEnd ? 1 : 0);
    if (currentArea?.surface && dayNight.starAlpha > 0.6 && starsNight !== nightNo) { starsNight = nightNo; ambient.trigger('stars_visible', { force: true }); }
    // warmth: cold brings only a cozy nudge (frost vignette, Wren's line, Biscuit pressing close)
    updateWarmth(dt, onSurface);
    // idle + Biscuit
    if (player.stillTime > 40) ambient.trigger('idle');
    while (puppy.events.length) {
      const ev = puppy.events.shift();
      ambient.trigger(ev === 'petted' ? 'pet_biscuit' : ev === 'fetch' ? 'biscuit_fetch' : 'biscuit');
    }
    // Biscuit barks at points of interest: unread notes, interesting pickups (new areas: above)
    if ((poiCheck -= dt) <= 0) {
      poiCheck = 1;
      const n = lore.nearestUnread(puppy.pos, 5);
      if (n && !barked.has(n.id) && puppy.bark('note', n.pos)) barked.add(n.id);
      const it = items.nearest(puppy.pos, 4);
      if (it && !barkedItems.has(it) && ['flint', 'glowcap', 'crystal_shard'].includes(it.kind) && game.time - lastItemBark > 25 && puppy.bark('pickup', it.pos)) { barkedItems.add(it); lastItemBark = game.time; }
      const bed = build.find('biscuit_bed');
      puppy.bed = bed?.sleepPoint || null;
    }
    // 10 minutes idle ends the session
    if (sessionOpen && performance.now() - lastActivity > 10 * 60 * 1000) endSession('idle');
  }

  let lastTimeWord = null, lastTod = 0, lastWeather = 'clear', rainSpell = 0, roofSpell = -1, starsNight = -1;
  const warmEl = document.getElementById('warmth'), warmFill = warmEl.querySelector('.fill'), frostEl = document.getElementById('frost'), todIco = document.getElementById('tod-ico');
  let warmUi = -1;
  function updateWarmth(dt, onSurface) {
    const lit = fires.nearest(player.pos, Infinity, true);
    const nearFire = lit && Math.hypot(lit.pos.x - player.pos.x, lit.pos.z - player.pos.z) < lit.lightRadius * 0.8;
    const sheltered = build.inShelter(player.pos);
    const night = dayNight.nightness > 0.5 || timeWord(dayNight.tod) !== 'day';
    const rain = dayNight.rainK > 0.4 && !build.underRoof(player.pos);
    let rate;
    if (nearFire) rate = WC.nearFire;
    else if (sheltered) rate = WC.shelter;
    else if (stewHold > 0) rate = 0;
    else if (onSurface && night && rain) rate = -WC.both;
    else if (onSurface && rain) rate = -WC.rainSurface;
    else if (onSurface && night) rate = -WC.nightSurface;
    else rate = -WC.drift;
    stewHold = Math.max(0, stewHold - dt);
    warmth = Math.min(100, Math.max(0, warmth + rate * dt));
    const prev = warmWord;
    if (warmth < WC.cold) warmWord = 'cold';
    else if (warmth > WC.warm) warmWord = 'warm';
    else if (warmWord === 'cold' && warmth > WC.cold + 8) warmWord = 'ok';
    else if (warmWord === 'warm' && warmth < WC.warm - 8) warmWord = 'ok';
    if (warmWord === 'cold' && prev !== 'cold') ambient.trigger('warmth_cold', { force: true });
    puppy.snuggle = warmWord === 'cold' && !nearFire;
    const pct = Math.round(warmth);
    if (pct !== warmUi) {
      warmUi = pct; warmFill.style.width = `${pct}%`;
      warmEl.classList.toggle('cold', warmWord === 'cold');
      warmEl.title = `Warmth: ${warmWord}`;
    }
    frostEl.style.opacity = warmWord === 'cold' ? String(Math.min(1, 0.55 + (WC.cold - warmth) / 40)) : '0';
    const ico = dayNight.weather === 'rain' && dayNight.rainK > 0.3 ? '🌧' : timeWord(dayNight.tod) === 'day' ? '☀' : timeWord(dayNight.tod) === 'dusk' ? '🌇' : '🌙';
    if (todIco.textContent !== ico) todIco.textContent = ico;
  }

  function updateFog(dt) {
    const { fire } = nearestFireLevel();
    let target = 0;
    if (fire && fire.lit) {
      const d = Math.hypot(fire.pos.x - player.pos.x, fire.pos.z - player.pos.z);
      const prox = 1 - THREE.MathUtils.smoothstep(d, fire.lightRadius * 0.8, fire.lightRadius * 2);
      target = Math.min(1, fire.fuel / (FC.secondsPerStick * 4)) * prox;
    }
    fogK += (target - fogK) * Math.min(1, dt * 0.35); // gentle
    scene.fog.density = THREE.MathUtils.lerp(R.fogCold, R.fogWarm, fogK);
    const zn = ambientLight.zone; // the Glowmere keeps its own 0.05 grotto fog
    if (zn) scene.fog.density = THREE.MathUtils.lerp(scene.fog.density, zn.density, zn.w);
    // audio follows the same fire
    const fd = fire ? Math.hypot(fire.pos.x - player.pos.x, fire.pos.z - player.pos.z) : 99;
    const ch = build.find('crystal_wind_chime');
    audio.update(dt, {
      fire: fire && fire.lit ? { level: fire.strength, pos: fire.pos, prox: Math.max(0, 1 - fd / 12) } : null,
      cam: camera, area: currentArea?.id || null, cave: 1 - cave.surfaceAt(player.pos.x, player.pos.z),
      rain: dayNight.rainK * dayNight.b, roof: build.underRoof(player.pos), talking: chat.open,
      chimeNear: !!ch && Math.hypot(ch.x - player.pos.x, ch.z - player.pos.z) < 5,
    });
  }

  function updateHint() {
    const inv = player.inventory;
    invUI.setInventory(inv);
    if (build.active && !invUI.isAvailable(build.selected, inv)) build.select('floor');
    invUI.setStickOut(puppy.stick.state !== 'hand');
    if (build.active) {
      hud.setHint(build.removeMode ? 'Remove mode: aim at a piece, then Use for a full refund. 🗑 to go back.'
        : `${PIECES[build.selected].name}: ${build.costText()}. ⟳ rotate · 🗑 remove · 🔨 done`);
      invUI.setPalette(build.selected, inv);
    }
    else if (!fires.fires.length) hud.setHint(`Light a campfire: wood ${Math.min(inv.wood, FC.woodToBuild)}/${FC.woodToBuild} · flint ${Math.min(inv.flint, FC.flintToBuild)}/${FC.flintToBuild}${inv.flint < 1 ? ' (look on Flintseam Ridge)' : ''}`);
    else if (!fires.nearest(player.pos, Infinity, true)) hud.setHint('The fire is out. Add wood to relight it.');
    else hud.setHint('Keep the fire fed. Hold Use on trees and rocks to gather, 🔨 to build.');
    const nf = fires.nearest(player.pos, 14);
    hud.setFuel(nf);
  }

  // ------------------------------------------------------------ loop
  let last = performance.now();
  let running = false;
  const _camPos = new THREE.Vector3();
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (document.hidden) return;
    game.time += dt;
    input.update();
    if (running && input.consume('pause')) setPaused(!paused);
    if (running && paused) {
      input.clearFrame(); hud.update(dt, renderer); renderer.render(scene, camera); return;
    }
    if (running) {
      if (input.consume('stick')) throwStick();
      if (input.consume('chat')) chat.toggle();
      if (input.consume('build')) {
        const on = build.toggle(); hud.setBuildActive(on); hud.setRemoveActive(false);
        invUI.setBuildMode(on, build.selected, player.inventory);
        hud.toast(on ? 'Build mode: pick a piece below' : 'Build mode off', 1.8);
      }
      if (input.consume('bag')) invUI.toggleBag();
      if (build.active) {
        if (input.consume('rotate')) build.rotate();
        if (input.consume('remove')) hud.setRemoveActive(build.setRemove());
      } else { input.consume('rotate'); input.consume('remove'); }
      for (let n = 1; n <= 10; n++) if (input.consume('slot' + n)) {
        const vis = invUI.visiblePieces(player.inventory);
        if (build.active) { if (vis[n - 1]) { build.select(vis[n - 1]); hud.setRemoveActive(false); } } else if (HOTBAR[n - 1]) invUI.select(HOTBAR[n - 1]);
      }
      handleTaps();
      player.update(dt, input);
      build.update(player, dt);
      ctxAction = chooseAction();
      hud.setInteract(ctxAction?.label);
      if (input.consume('interact')) doAction(ctxAction);
      updateHold(dt);
      items.update(dt, ctxAction?.kind === 'pick' ? ctxAction.it : null, player.pos);
      harvest.update(dt, player.pos);
      updateTriggers(dt);
      const cooked = cooking.update(dt, player.pos);
      for (const pot of cooked) { hud.toast('🍲 Stew is ready! Use to take it', 2.4); audio.blip(820); }
      updateRequests(dt);
      ambient.update(dt);
      if (performance.now() - lastSaveAt > 30000) saveNow('auto');
    } else {
      // title backdrop: slow orbit around the fire by the camp
      build.update(player, dt);
      const f = titleFire || fires.nearest(player.pos, 20) || { pos: player.pos };
      const a = game.time * 0.06 + 0.8, R0 = 5.2;
      camera.position.set(f.pos.x + Math.cos(a) * R0, f.pos.y + 2.1, f.pos.z + Math.sin(a) * R0);
      cave.resolve(camera.position, 0.8);
      camera.lookAt(f.pos.x, f.pos.y + 1.5, f.pos.z); // fire sits low in frame, under the menu
    }
    if (woofT > 0) {
      woofT -= dt;
      _camPos.set(puppy.pos.x, puppy.pos.y + 0.75, puppy.pos.z).project(camera);
      woofEl.style.left = `${((_camPos.x + 1) / 2 * window.innerWidth).toFixed(0)}px`;
      woofEl.style.top = `${((1 - _camPos.y) / 2 * window.innerHeight).toFixed(0)}px`;
      if (woofT <= 0 || _camPos.z > 1) woofEl.classList.remove('show');
    }
    fires.update(dt);
    const anyLit = fires.anyLit;
    ambientLight.update(dt, player.pos, fires); // §8.1 distance-driven ambient
    puppy.update(dt, player, fires);
    wren.update(dt, player, fires, chat.open, {
      fog: fogState(), items: running ? items : null,
      onGather: (it) => {
        items.pickUp(it); player.inventory[it.kind] = (player.inventory[it.kind] || 0) + 1;
        hud.toast(`Wren hands you ${ITEM_INFO[it.kind].label}`, 1.8); audio.blip(600);
      },
    });
    decor.update(dt);
    dressing.update(dt, { anyFireLit: anyLit });
    budget.update(dt, camera.getWorldPosition(_camPos));
    updateFog(dt);
    // Chunk C: surface day/night + weather over the §8.1 cave ambient (blend by depth into the cave)
    const cp = camera.getWorldPosition(_camPos);
    dayNight.update(dt, { advance: running && !sleeping, camPos: cp, hemi, fog: scene.fog, scene, fireK: ambientLight.k, caveDensity: scene.fog.density, renderer });
    surface.update(dt, cp, camera); instCull.update(dt, camera);
    glowmere.update(dt, player.pos, { lanternOn: wren.lightOn, sitting: !!player.seat && glowmere.weight(player.pos) > 0.3 });
    { // fireflies: the grotto (25, cyan) or the clearing at dusk (40, warm); none in the caves
      const gw = glowmere.weight(player.pos);
      const dusk = timeWord(dayNight.tod) === 'dusk' && dayNight.b > 0.3;
      fireflies.update(dt, player.pos, gw > 0.05 ? 'grotto' : dusk ? 'dusk' : null, gw > 0.05 ? gw : dayNight.b * (1 - 0.7 * dayNight.rainK));
    }
    if (surface.visible === false) dayNight.sky.visible = false;
    for (const v of ['pine', 'round', 'birch']) if (harvest.treeMeshes[v]) harvest.treeMeshes[v].visible = surface.visible !== false; // surface trees off deep in the cave
    if (!running) cooking.update(0, cp);
    updateHint();
    hud.update(dt, renderer);
    input.clearFrame();
    renderer.render(scene, camera);
  }

  Object.defineProperties(game, { warmth: { get: () => warmth, set: (v) => { warmth = v; } }, warmWord: { get: () => warmWord }, dayCount: { get: () => dayCount } });
  Object.assign(game, { settings, glowmere, fireflies, sitDown, findSeat, benchSeat, dayNight, cooking, surface, instCull, eatStew, openSleep, doSleep, THREE, hemi, ambientLight, budget, harvest, colliders, invUI, dressing, scene, camera, renderer, cave, player, items, fires, puppy, wren, chat, memory, ambient, build, hud, input, gameState, worldState,
    audio, lore, reader, requests, saveNow, snapshot, digLog, keepsakesFound, openNote, throwStick, completeRequest, talkRequests,
    get paused() { return paused; }, setPaused, ready: true,
    start: () => begin() });

  // ------------------------------------------------------------ title screen (ui_text.json)
  const startEl = document.getElementById('start');
  const UI = STORY.uiText;
  document.getElementById('title-name').textContent = UI.title;
  document.getElementById('title-tagline').textContent = UI.tagline;
  document.getElementById('title-sub').textContent = UI.subtitle;
  document.getElementById('title-tip').textContent = UI.loadingTips[Math.floor(Math.random() * UI.loadingTips.length)];
  const menuEl = document.getElementById('title-menu'), confirmEl = document.getElementById('title-confirm');
  const contBtn = document.getElementById('title-continue'), newBtn = document.getElementById('title-new'), setBtn = document.getElementById('title-settings');
  contBtn.textContent = UI.menu.continue; newBtn.textContent = UI.menu.newGame; setBtn.textContent = UI.menu.settings;
  onTap(setBtn, () => { audio.unlock(); settings.open(); });
  const fresh = consumeNewGameFlag();
  const save = fresh ? null : readSave();
  let started = false;
  if (save) { try { applySave(save); } catch (e) { console.warn('[save] restore failed', e); } }
  // a fire for the title backdrop if the camp has none nearby (removed when play starts)
  if (!fires.nearest(player.pos, 14, true)) {
    const p = new THREE.Vector3(lanternmouth.x - 0.6, 0, lanternmouth.z + 0.1);
    p.y = cave.floorAt(p.x, p.z);
    titleFire = fires.build(p, 6);
  }
  function begin(mode = save ? 'continue' : 'new') {
    if (running) return;
    running = true; started = true;
    startEl.classList.add('hidden'); document.body.classList.remove('on-title');
    audio.unlock(); // inside the tap: unlocks iOS audio
    if (titleFire) { fires.remove(titleFire); titleFire = null; }
    player.update(0, input);
    const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const standalone = matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || navigator.standalone;
    if (!isIOS && !standalone && matchMedia('(pointer: coarse)').matches && document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen({ navigationUI: 'hide' }).then(() => screen.orientation?.lock?.('landscape')).catch(() => {});
    }
    if (!matchMedia('(pointer: coarse)').matches) input.requestPointerLock();
    hud.toast(mode === 'continue' ? 'Welcome back to the Hollow' : 'Gather wood 🪵 and flint ✦ to light a fire', 3.5);
    lastActivity = performance.now(); lastSaveAt = performance.now();
    if (mode === 'new') saveNow('new');
  }
  startMsg.textContent = '';
  document.body.classList.add('on-title');
  menuEl.classList.remove('hidden');
  contBtn.hidden = !save;
  (save ? contBtn : newBtn).classList.add('primary');
  onTap(contBtn, () => begin('continue'));
  onTap(newBtn, () => { if (save) { menuEl.classList.add('hidden'); confirmEl.classList.remove('hidden'); } else begin('new'); });
  onTap(document.getElementById('confirm-no'), () => { confirmEl.classList.add('hidden'); menuEl.classList.remove('hidden'); });
  onTap(document.getElementById('confirm-yes'), () => newGameReload());
  requestAnimationFrame((t) => { last = t; frame(t); });
  if (CONFIG.debug.autostart) begin();
}

init().catch((e) => {
  console.error(e);
  startMsg.textContent = 'Something went wrong loading the cave. ' + e.message;
});

// ---------------------------------------------------------------- PWA service worker
// Phones keep a home-screen app alive for days, so pick up deploys promptly: check for a new SW
// whenever the app comes back to the foreground, and when a new SW takes control reload ONCE
// (guarded: only if a controller already existed, i.e. this isn't the very first install, and
// never twice in a row).
if ('serviceWorker' in navigator && !CONFIG.debug.noSW) {
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    try { if (sessionStorage.getItem('ember_hollow.swreload') === '1') return; sessionStorage.setItem('ember_hollow.swreload', '1'); } catch (_) { /* ignore */ }
    reloading = true;
    location.reload();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then((reg) => {
      document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
    }).catch((e) => console.warn('[sw]', e));
    // a clean load after the reload clears the guard for the next deploy
    setTimeout(() => { try { sessionStorage.removeItem('ember_hollow.swreload'); } catch (_) { /* ignore */ } }, 10000);
  });
}
