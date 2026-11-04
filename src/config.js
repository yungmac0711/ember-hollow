// Central tuning + feature config. Everything gameplay-tweakable lives here.
const params = new URLSearchParams(location.search);

export const CONFIG = {
  debug: {
    fps: params.get('fps') === '1',          // ?fps=1 shows the FPS / draw-call counter
    seed: Number(params.get('seed') || 1337), // ?seed=42 for a different cave layout wobble
    noSW: params.get('nosw') === '1',        // ?nosw=1 skips the service worker (dev)
    autostart: params.get('autostart') === '1',
  },
  // Lighting/fog values follow art/STYLE_GUIDE.md §3.
  render: {
    maxPixelRatio: 1.5,
    fov: 70,
    background: 0x0e1117,
    fogColor: 0x3a4656,
    fogWarm: 0.04,   // fog density when standing in a well-fed fire's light
    fogCold: 0.075,  // fog density far from fire / when the fire has died (the Long Dark)
    farPlane: 42,
    exposure: 1.1,
    hemi: { sky: 0x3e4a57, ground: 0x0e1117, intensity: 1.15 },
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
    intensity: 7,
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
    lantern: { color: 0xe08a2e, intensity: 3.5, distance: 6 }, // style guide: 2 / 5 — raised so the pre-fire dark stays readable on a phone
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
  // Drop-in art: set a URL (relative to game/index.html) to a .glb to replace a primitive placeholder.
  // e.g. puppy: 'assets/models/puppy.glb'. Missing/failed loads fall back to primitives.
  // Kenney CC0 GLBs copied from /art/assets (see game/assets/models/README.md). Each pack folder keeps
  // its Textures/colormap.png next to the GLBs. Set an entry to null to force the primitive placeholder.
  assets: {
    models: {
      companion: 'assets/models/characters/character-female-a.glb',
      campfire: 'assets/models/campfire/campfire-pit.glb',
      stick: 'assets/models/props/resource-wood.glb',
      stone: 'assets/models/props/resource-stone.glb',
      boulder: 'assets/models/nature/stone_largeA.glb',
      pillar: 'assets/models/nature/stone_tallA.glb',
      floorPiece: 'assets/models/wood-floors-structures/floor.glb',
      // Kenney's cube-pet dog (art/assets/dog) has no sit pose and doesn't read as a boxer, so
      // Biscuit stays a primitive boxer for M0. Set to 'assets/models/dog/animal-dog.glb' to try it.
      puppy: null,
    },
  },
};
