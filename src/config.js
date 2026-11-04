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
    fogCold: 0.075,  // fog density far from fire / when the fire has died (the Long Dark)
    farPlane: 42,
    exposure: 1.1,
    // Hemisphere: 0.9 before the first fire; eases to 0.45 over ~3 s once any fire is lit; back to
    // 0.9 only when every fire is out (§8).
    hemi: { sky: 0x3a5a80, ground: 0x0b0e14, intensity: 0.9, litIntensity: 0.45, easeSeconds: 3 },
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
  items: { wood: 30, stone: 16, flint: 10 },
  build: { floorCost: { wood: 2, stone: 1 }, grid: 2 }, // M0 placeholder: wooden floor tiles only
  playerName: 'Cam',
  companion: {
    name: 'Wren', // persona + lines come from /story via src/companion/story-data.js (npm run sync-story)
    lantern: { color: 0xe08a2e, intensity: 3.0, distance: 6 }, // §8: #E08A2E, 3.0, 6, decay 2; fades out inside the fire radius
    hood: { upWhenFog: 'thick', downNearFireSeconds: 4, minToggleSeconds: 10 }, // see wren.js _updateHood
    barkCooldown: 25, // seconds between unprompted remarks
    summarizeEvery: 30, // messages between memory summary passes
    historyTurns: 8,
  },
  puppy: { name: 'Biscuit' },
  // LLM provider for companion chat. 'stub' = canned offline replies (default, no network).
  // 'http' = OpenAI-compatible chat endpoint (see src/companion/llm/http-adapter.js).
  // NEVER put an API key in this file — point `endpoint` at your own small proxy that holds the key.
  llm: {
    provider: params.get('llm') || 'stub',
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
      floorPiece: 'assets/models/wood-floors-structures/floor.glb',
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
