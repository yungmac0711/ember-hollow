// Central tuning + feature config. Everything gameplay-tweakable lives here.
const params = new URLSearchParams(location.search);

export const CONFIG = {
  debug: {
    fps: params.get('fps') === '1',          // ?fps=1 shows the FPS / draw-call counter
    seed: Number(params.get('seed') || 1337), // ?seed=42 for a different cave layout wobble
    noSW: params.get('nosw') === '1',        // ?nosw=1 skips the service worker (dev)
    autostart: params.get('autostart') === '1',
    low: params.get('low') === '1',          // ?low=1 forces the low-tier budget (1 dynamic point light)
  },
  // Lighting follows art/STYLE_GUIDE.md §8 "Approved M0 lighting" (signed off Nov 3, 2026), which
  // overrides §3 where they differ. Fog values follow §3.
  render: {
    maxPixelRatio: 1.5,
    fov: 70,
    background: 0x0e1117,
    fogColor: 0x3a4656,
    fogWarm: 0.04,   // fog density when standing in a well-fed fire's light
    fogCold: 0.06,   // §8.1: was 0.075 (swallowed the exploration ambient)
    farPlane: 42,
    exposure: 1.1,
    // §8.1 darkness fix (Art-approved Nov 3): distance-driven ambient. k = smoothstep(rIn, rIn+6, d)
    // from the nearest LIT fire (k = 1 when none is lit): 0 = at the fire, 1 = exploring.
    hemi: {
      sky: 0x3a5a80, skyFar: 0x4a6a94, ground: 0x0b0e14, groundFar: 0x1a2230,
      intensity: 0.45, intensityFar: 0.85, outerPad: 6, smoothing: 4,
      fogNear: 0x3a4656, fogFar: 0x34405a,
      // zone tints by chamber index (cave.js CHAMBERS): z = 1 - smoothstep(r, r+3, distToCentre)
      tints: [
        { chamber: 1, sky: 0x5a4a8a, fog: 0x3a3450 }, // Flintseam Ridge (crystals)
        { chamber: 4, sky: 0x3a6a7a, fog: 0x30454f }, // the Hushing Pools
      ],
      tintSky: 0.4, tintFog: 0.3,
    },
    // Dynamic point-light budget (§6: 1 campfire + 1 lantern + hemisphere). Campfire, Wren's lantern
    // and torches are *emitters* competing for this many real PointLights; the rest stay emissive.
    maxPointLights: params.get('low') === '1' ? 1 : 2,
    // §8 backlight fix for Wren + Biscuit: emissive lift + optional fresnel rim. No extra lights.
    characterLift: { emissive: 0x16202c, emissiveIntensity: 1.0, rim: { color: 0x7fa3c8, power: 2.5, strength: 0.35 } },
  },
  player: {
    radius: 0.35,
    eyeHeight: 1.55,
    walkSpeed: 4.0,
    jumpVelocity: 5.4,
    gravity: 16,
    lookTouch: 0.0058,   // radians per CSS px of drag
    lookMouse: 0.0022,
    pitchLimit: 1.35,
  },
  fire: {
    woodToBuild: 4,
    flintToBuild: 1,  // brief: fire needs wood + flint
    color: 0xff9a3c,
    intensity: 12, // §8: #FF9A3C, 12, distance 10, decay 2
    secondsPerStick: 75, // each piece of wood burns this long
    maxSticks: 8,        // fuel cap (in wood)
    lowFrac: 0.2,        // below this fraction of a 4-wood fire Wren says "fire_low"
    maxSparks: 30,       // ember sparks per fire (style guide: ≤60)
    lightRadius: 10,
  },
  items: {
    wood: 30, stone: 16, flint: 10,          // M0 loose pickups
    mushroom: 12, glowcap: 14, crystal_shard: 10,    // M1 cave forage
    // seconds until a picked item regrows (only while the player is > 7 m away, so nothing pops in)
    respawn: { wood: 300, stone: 300, flint: 360, mushroom: 180, glowcap: 240, crystal_shard: 420 },
  },
  // Hold-to-gather nodes (tap-hold the target or hold Use). Root trees → wood, cave rocks → stone.
  harvest: {
    tree: { count: 10, seconds: 1.6, yield: { wood: 3 }, respawn: 240, reach: 2.6 },
    rock: { count: 14, seconds: 1.3, yield: { stone: 2 }, flintChance: 0.4, respawn: 200, reach: 2.4 },
  },
  build: { grid: 2, wallHeight: 2.1, reach: 2.2 }, // piece costs live in src/build/pieces.js
  playerName: 'Cam',
  companion: {
    name: 'Wren', // persona + lines come from /story via src/companion/story-data.js (npm run sync-story)
    lantern: { color: 0xe08a2e, intensity: 3.5, distance: 7 }, // §8.1: #E08A2E, 3.5, 7, decay 2; off inside the fire radius (key light while exploring)
    hood: { upWhenFog: 'thick', downNearFireSeconds: 4, minToggleSeconds: 10 }, // see wren.js _updateHood
    barkCooldown: 25, // seconds between unprompted remarks
    summarizeEvery: 30, // messages between memory summary passes
    historyTurns: 8,
  },
  puppy: { name: 'Biscuit' },
  // LLM provider for companion chat. 'bank' = Wren's offline reply bank from story/wren_replies.json (default, no network);
  // 'stub' = the old M0 canned replies (fallback).
  // 'http' = OpenAI-compatible chat endpoint (see src/companion/llm/http-adapter.js).
  // NEVER put an API key in this file — point `endpoint` at your own small proxy that holds the key.
  llm: {
    provider: params.get('llm') || 'bank',
    http: {
      endpoint: '',  // e.g. 'https://your-proxy.example.com/v1/chat/completions'
      model: '',
      temperature: 0.8,
      maxTokens: 160,
    },
  },
  // Torches: emissive flames everywhere; only the nearest few get a real light via the budget.
  torches: { lightScale: 1.0, lightRange: 16 },
  // Drop-in art: set a URL (relative to game/index.html) to a .glb to replace a primitive placeholder.
  // e.g. puppy: 'assets/models/puppy.glb'. Missing/failed loads fall back to primitives.
  // Kenney CC0 GLBs copied from /art/assets (see game/assets/models/README.md). Each pack folder keeps
  // its Textures/colormap.png next to the GLBs. Set an entry to null to force the primitive placeholder.
  assets: {
    models: {
      // Custom Style-A Wren (art director, procedural, Cameron's own licence): node-pivot hierarchy
      // animated in code (src/companion/wren-anim.js). The hood-up variant supplies the hood_up node.
      companion: 'assets/models/characters/wren/wren.glb',
      companionHood: 'assets/models/characters/wren/wren-hood-up.glb',
      campfire: 'assets/models/campfire/campfire-pit.glb',
      stick: 'assets/models/props/resource-wood.glb',
      stone: 'assets/models/props/resource-stone.glb',
      boulder: 'assets/models/nature/stone_largeA.glb',
      pillar: 'assets/models/nature/stone_tallA.glb',
      // M1 building pieces (Ember Hollow originals, art/assets/build + props; 2 m wide, origin at base)
      floorPiece: 'assets/models/build/floor-plank.glb',
      wallPiece: 'assets/models/build/wall-log.glb',
      windowPiece: 'assets/models/build/wall-log-window.glb',
      doorPiece: 'assets/models/build/wall-log-door.glb',
      roofPiece: 'assets/models/build/roof-log.glb',
      lanternPiece: 'assets/models/build/lantern_double.glb',
      chestPiece: 'assets/models/props/chest.glb',
      bedrollPiece: 'assets/models/props/bedroll.glb',
      // Chunk B: request rewards, decorations, keepsakes (art/assets/build, decor, keepsakes) and lore props
      benchPiece: 'assets/models/build/lakeside_bench.glb',
      herbBundle: 'assets/models/decor/herb_bundle.glb',
      wovenRug: 'assets/models/decor/woven_rug.glb',
      biscuitBed: 'assets/models/decor/biscuit_bed.glb',
      windChime: 'assets/models/decor/crystal_wind_chime.glb',
      ks_brass_button: 'assets/models/keepsakes/brass_button.glb',
      ks_blue_marble: 'assets/models/keepsakes/blue_marble.glb',
      ks_tin_whistle: 'assets/models/keepsakes/tin_whistle.glb',
      ks_feather_owl: 'assets/models/keepsakes/feather_owl.glb',
      ks_waylamp_key: 'assets/models/keepsakes/waylamp_key.glb',
      ks_keeper_charm: 'assets/models/keepsakes/keeper_charm.glb',
      ks_tiny_lantern: 'assets/models/keepsakes/tiny_lantern.glb',
      loreNote: 'assets/models/lore/note_paper.glb',
      loreJournal: 'assets/models/lore/journal_page.glb',
      loreSlate: 'assets/models/lore/note_slate.glb',
      loreHook: 'assets/models/lore/waylamp_hook.glb',
      // M1 gathering
      rockB: 'assets/models/cave-rock/rock-b.glb',
      mushroomRed: 'assets/models/nature/mushroom_red.glb',
      // Custom Style-A props (art director): crystals, moss, torches — see src/world/dressing.js
      crystal1: 'assets/models/crystals/crystal-cluster-1.glb',
      crystal2: 'assets/models/crystals/crystal-cluster-2.glb',
      crystal3: 'assets/models/crystals/crystal-cluster-3.glb',
      crystal4: 'assets/models/crystals/crystal-cluster-4.glb',
      mossClump1: 'assets/models/moss/moss-clump-1.glb',
      mossClump2: 'assets/models/moss/moss-clump-2.glb',
      mossClump3: 'assets/models/moss/moss-clump-3.glb',
      mossCap1: 'assets/models/moss/moss-cap-1.glb',
      mossCap2: 'assets/models/moss/moss-cap-2.glb',
      torchWall: 'assets/models/torches/torch-wall.glb',
      torchStanding: 'assets/models/torches/torch-standing.glb',
      // Custom Style-A Biscuit (art director, matches concepts/04-boxer-biscuit.jpg). Node pivots,
      // animated by src/entities/biscuit-rig.js; poses baked from biscuit-*.glb into biscuit-poses.js.
      puppy: 'assets/models/dog/biscuit/biscuit.glb',
    },
  },
};
