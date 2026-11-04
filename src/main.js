// Ember Hollow — M0 bootstrap + game loop. Wires world, entities, fire, companion and UI together.
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { Cave } from './world/cave.js';
import { buildDecor } from './world/decor.js';
import { buildDressing } from './world/dressing.js';
import { LightBudget } from './render/lights.js';
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
import { BuildSystem } from './build/shelter.js';
import { HUD } from './ui/hud.js';
import { GameAudio } from './audio.js';
import { loadModel, loadParts, loadScene } from './assets.js';

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
// §8 approved lighting: hemisphere 0.9 before the first fire, eases to 0.45 over ~3 s once any
// fire is lit (the fire becomes the key light), back to 0.9 only when every fire is out.
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
  },
});

const game = { ready: false, time: 0 };
window.__game = game; // debug/test handle

async function init() {
  startMsg.textContent = 'Gathering kindling…';
  // Load Kenney GLBs in parallel (each falls back to primitives on failure)
  const raw = { raw: true };
  const [decorBoulder, decorPillar, woodParts, stoneParts, flintParts, pitParts, floorParts, wrenScene, puppyModel,
    wrenHood, crys1, crys2, crys3, crys4, moss1, moss2, moss3, cap1, cap2, torchWall, torchStanding] = await Promise.all([
    loadParts('boulder', { size: 1.0, color: 0x3e4a57 }),
    loadParts('pillar', { size: 0.9, color: 0x2b3440 }),
    loadParts('stick', { size: 0.6 }),
    loadParts('stone', { size: 0.32 }),
    loadParts('stone', { size: 0.26, color: 0x3a3a46, emissive: 0x120804 }), // flint: dark, faint warm sheen
    loadParts('campfire', { size: 1.15 }),
    loadParts('floorPiece', { size: CONFIG.build.grid }),
    loadScene('companion'), // art-director Wren: 1.7 m, metres, origin at feet, facing +Z
    loadModel('puppy', buildPuppyPrimitive),
    loadScene('companionHood'),
    loadParts('crystal1', raw), loadParts('crystal2', raw), loadParts('crystal3', raw), loadParts('crystal4', raw),
    loadParts('mossClump1', raw), loadParts('mossClump2', raw), loadParts('mossClump3', raw),
    loadParts('mossCap1', raw), loadParts('mossCap2', raw),
    loadParts('torchWall', raw), loadParts('torchStanding', raw),
  ]);
  const crystalParts = [crys1, crys2, crys3, crys4].filter(Boolean);

  const decor = buildDecor(scene, cave, seed, { boulder: decorBoulder, pillar: decorPillar, skipCrystals: crystalParts.length > 0 });
  const dressing = buildDressing(scene, cave, seed, {
    crystals: crystalParts, mossClumps: [moss1, moss2, moss3], mossCaps: [cap1, cap2], torchWall, torchStanding,
  }, budget, { boulders: decor.boulders });
  if (crystalParts.length) decor.crystals = dressing.crystals; // found_crystal trigger uses the real clusters
  const items = new Items(scene, cave, seed, { wood: woodParts, stone: stoneParts, flint: flintParts });
  const fires = new FireSystem(scene, cave, pitParts, budget);
  const build = new BuildSystem(scene, cave, floorParts);

  const spawn = new THREE.Vector3(lanternmouth.x + 0.5, 0, lanternmouth.z + 2);
  spawn.y = cave.floorAt(spawn.x, spawn.z);
  const player = new Player(camera, cave, spawn);
  player.yaw = 0.35;
  player.extraFloor = (x, z) => build.heightAt(x, z);

  const pModel = puppyModel.fromFile || puppyModel.parts.legs ? puppyModel : { ...buildPuppyPrimitive(), animations: [] };
  const puppy = new Puppy(scene, cave, pModel, spawn.clone().add(new THREE.Vector3(-1.2, 0, -1.5)));
  const hoodUp = wrenHood?.root.getObjectByName('hood_up') || null;
  const wrenModel = wrenScene ? { ...wrenScene, hoodUp } : { root: buildWrenPrimitive().root, animations: [] };
  const wren = new Wren(scene, cave, wrenModel, spawn.clone().add(new THREE.Vector3(1.8, 0, -1.2)), budget);

  // ------------------------------------------------------------ companion brain
  const adapter = createAdapter(CONFIG.llm);
  const memory = new CompanionMemory(adapter);
  const ambient = new AmbientLines({ globalGap: 45, perTrigger: 180 });
  const recentFinds = [];
  let currentArea = lanternmouth;
  let clock = 0; // night cycle seconds
  const NIGHT = [[0, 'dusk'], [180, 'evening'], [600, 'deep night'], [1080, 'quiet hour'], [1500, 'pre-dawn']];
  const CYCLE = 1800;
  const timeOfNight = () => { let n = 'dusk'; for (const [t, name] of NIGHT) if (clock % CYCLE >= t) n = name; return n; };
  let fogK = 0; // 0 = cold/thick … 1 = warm/thin

  function nearestFireLevel() {
    const f = fires.nearest(player.pos, Infinity, true);
    if (!f) return { fire: fires.nearest(player.pos), level: 0, lit: false };
    return { fire: f, level: Math.round(Math.min(1, f.fuel / (FC.secondsPerStick * 4)) * 100), lit: true };
  }
  const fogState = () => (fogK >= 0.4 ? 'thin' : fogK > 0.02 ? 'thickening' : 'thick');

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
    };
  }

  const chat = new ChatUI({
    adapter, memory, getState: gameState,
    onOpen: () => { input.enabled = false; input.reset(); if (document.pointerLockElement) document.exitPointerLock(); },
    onClose: () => { input.enabled = true; },
  });
  ambient.onLine = (trigger, line) => { hud.say(line); chat.addAmbient(line); };

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
  let proxCheck = 0;
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
    if (build.active) return { label: 'Place floor', kind: 'build' };
    const it = items.findTarget(player.pos, fwd);
    if (it) return { label: `Pick up ${ITEM_INFO[it.kind].label}`, kind: 'pick', it };
    const nf = fires.nearest(player.pos, 2.4);
    if (nf && inv.wood > 0 && nf.canAddFuel()) return { label: nf.lit ? 'Add wood' : 'Relight', kind: 'fuel', fire: nf };
    const dw = Math.hypot(wren.pos.x - player.pos.x, wren.pos.z - player.pos.z);
    const db = Math.hypot(puppy.pos.x - player.pos.x, puppy.pos.z - player.pos.z);
    if (db < 1.8) return { label: `Pet ${CONFIG.puppy.name}`, kind: 'pet' };
    if (inv.wood >= FC.woodToBuild && inv.flint >= FC.flintToBuild) {
      const spot = canBuildFireHere();
      if (spot) return { label: 'Light fire', kind: 'fire', spot };
    }
    if (dw < 2.4) return { label: 'Talk', kind: 'talk' };
    return null;
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
        ambient.trigger(`found_${a.it.kind}`);
        if (a.it.kind === 'flint') memory.addFact('find', `Cam found flint for the first time`, 2);
        break;
      }
      case 'fuel': {
        const wasLit = a.fire.lit;
        a.fire.addWood(1); inv.wood--; audio.blip(440);
        hud.toast(wasLit ? 'The fire crackles brighter' : 'The embers catch again', 1.6);
        if (!wasLit) ambient.trigger('fire_lit');
        break;
      }
      case 'fire': {
        inv.wood -= FC.woodToBuild; inv.flint -= FC.flintToBuild;
        fires.build(a.spot, FC.woodToBuild);
        hud.toast('🔥 Campfire lit!', 2.5); audio.blip(330);
        ambient.trigger('fire_lit');
        memory.addFact('milestone', 'Cam lit their first campfire in the Hollow', 3);
        break;
      }
      case 'pet': puppy.pet(); hud.toast(`${CONFIG.puppy.name} wiggles happily`, 1.6); break;
      case 'talk': chat.show(); break;
      case 'build': {
        const r = build.place(inv);
        if (r === 'placed') { hud.toast('Floor tile placed', 1.4); ambient.trigger('shelter_built'); if (build.tiles.size === 1) memory.addFact('milestone', 'Cam laid the first shelter floor', 3); }
        else if (r === 'cost') hud.toast('A floor tile needs 2 wood + 1 stone');
        else hud.toast('Can’t build there');
        break;
      }
    }
  }

  function handleTaps() {
    for (const t of input.taps) {
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
      if (area !== lanternmouth) ambient.trigger('new_area');
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
    // night cycle
    const before = timeOfNight();
    clock += dt;
    const after = timeOfNight();
    if (before !== after && (after === 'deep night' || after === 'quiet hour')) ambient.trigger('night_deepens');
    if (Math.floor((clock - dt) / CYCLE) !== Math.floor(clock / CYCLE)) ambient.trigger('morning');
    // idle + Biscuit
    if (player.stillTime > 40) ambient.trigger('idle');
    while (puppy.events.length) { puppy.events.shift(); ambient.trigger('biscuit'); }
    // 10 minutes idle ends the session
    if (sessionOpen && performance.now() - lastActivity > 10 * 60 * 1000) endSession('idle');
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
    // audio follows the same fire
    const al = fire && fire.lit ? fire.strength * Math.max(0, 1 - Math.hypot(fire.pos.x - player.pos.x, fire.pos.z - player.pos.z) / 12) : 0;
    audio.update(dt, al);
  }

  function updateHint() {
    const inv = player.inventory;
    hud.setInventory(inv);
    if (build.active) hud.setHint(`Build mode — floor tile: 2 wood + 1 stone. Tap 🔨 to exit.`);
    else if (!fires.fires.length) hud.setHint(`Light a campfire: wood ${Math.min(inv.wood, FC.woodToBuild)}/${FC.woodToBuild} · flint ${Math.min(inv.flint, FC.flintToBuild)}/${FC.flintToBuild}${inv.flint < 1 ? ' (look on Flintseam Ridge)' : ''}`);
    else if (!fires.nearest(player.pos, Infinity, true)) hud.setHint('The fire is out. Add wood to relight it.');
    else hud.setHint('Keep the fire fed with wood — the fog creeps in as it dies.');
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
    if (running) {
      if (input.consume('chat')) chat.toggle();
      if (input.consume('build')) {
        const on = build.toggle(); hud.setBuildActive(on);
        hud.toast(on ? 'Build mode: snap a wooden floor (walls & roof in M1)' : 'Build mode off', 2.2);
      }
      handleTaps();
      player.update(dt, input);
      build.update(player);
      ctxAction = chooseAction();
      hud.setInteract(ctxAction?.label);
      if (input.consume('interact')) doAction(ctxAction);
      items.update(dt, ctxAction?.kind === 'pick' ? ctxAction.it : null);
      updateTriggers(dt);
      ambient.update(dt);
    } else {
      player.update(0, input);
    }
    fires.update(dt);
    const anyLit = fires.anyLit;
    // hemisphere ease (§8): 0.9 → 0.45 over ~3 s when any fire is lit; back only when all are out
    const hTarget = anyLit ? R.hemi.litIntensity : R.hemi.intensity;
    const hStep = (R.hemi.intensity - R.hemi.litIntensity) / R.hemi.easeSeconds * dt;
    hemi.intensity += Math.max(-hStep, Math.min(hStep, hTarget - hemi.intensity));
    puppy.update(dt, player, fires);
    wren.update(dt, player, fires, chat.open, { fog: fogState() });
    decor.update(dt);
    dressing.update(dt, { anyFireLit: anyLit });
    budget.update(dt, camera.getWorldPosition(_camPos));
    updateFog(dt);
    updateHint();
    hud.update(dt, renderer);
    input.clearFrame();
    renderer.render(scene, camera);
  }

  Object.assign(game, { hemi, budget, dressing, scene, camera, renderer, cave, player, items, fires, puppy, wren, chat, memory, ambient, build, hud, input, gameState, ready: true,
    start: () => begin() });

  // ------------------------------------------------------------ start screen
  const startEl = document.getElementById('start');
  function begin() {
    if (running) return;
    running = true;
    startEl.classList.add('hidden');
    audio.unlock();
    const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const standalone = matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || navigator.standalone;
    if (!isIOS && !standalone && matchMedia('(pointer: coarse)').matches && document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen({ navigationUI: 'hide' }).then(() => screen.orientation?.lock?.('landscape')).catch(() => {});
    }
    if (!matchMedia('(pointer: coarse)').matches) input.requestPointerLock();
    hud.toast('Gather wood 🪵 and flint ✦ to light a fire', 3.5);
    lastActivity = performance.now();
  }
  startMsg.textContent = 'Tap to begin';
  startEl.addEventListener('pointerup', begin, { once: true });
  requestAnimationFrame((t) => { last = t; frame(t); });
  if (CONFIG.debug.autostart) begin();
}

init().catch((e) => {
  console.error(e);
  startMsg.textContent = 'Something went wrong loading the cave. ' + e.message;
});

// ---------------------------------------------------------------- PWA service worker
if ('serviceWorker' in navigator && !CONFIG.debug.noSW) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('[sw]', e)));
}
