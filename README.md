# Ember Hollow — M0 prototype + M1 chunks A/B (gathering, building, save, Biscuit v2, Wren's requests & lore)

A cozy, dark-fantasy cave-survival game for the phone. You are **Cam**. You explore a cave, gather
wood, stone and flint, and light a campfire to push the fog back. **Wren** keeps you company and
**Biscuit**, a boxer puppy, follows you around and sits by the fire.

It is a plain static site with no build step: Three.js r170 (vendored and loaded over WebGL2) plus ES
modules. It installs as a PWA and works offline once installed.

---

## Run it locally

```bash
cd game
python3 -m http.server 8080
# open http://localhost:8080/            (desktop: WASD + mouse)
# open http://localhost:8080/?fps=1      (FPS / draw-call / triangle counter)
```

To try it on a phone on the same Wi-Fi, open `http://<your-computer-LAN-IP>:8080/`. The game runs, but
**installing to the home screen and the service worker need HTTPS**, so use one of the hosting options
below for the real install.

URL flags:
- `?fps=1`: performance overlay
- `?seed=N`: different cave decoration and item layout
- `?nosw=1`: skip the service worker, for development
- `?autostart=1`: skip the title screen
- `?noskin=1`: draw Wren/Biscuit part-by-part (debug; default folds them into one skinned mesh)
- `?llm=http`: use the HTTP LLM adapter (see *Companion chat*)
- `?low=1`: low-end tier (1 real point light instead of 2)

## Controls

| Action | Phone (landscape) | Desktop |
|---|---|---|
| Move | Left thumb: the floating joystick appears where you touch | WASD / arrows |
| Look | Drag anywhere on the right side | Mouse (click to lock the pointer) |
| Jump | ⤒ button | Space |
| Use / pick up / add wood / light fire / pet / talk | The big context button (its label shows the action) | E / F / left click |
| Chop a tree / break a rock | **Hold** Use while aiming at it, or press and hold on it (progress ring) | hold E / F / left mouse |
| Open a door / chest | Use, or tap it | E |
| Hotbar / pack | Bottom bar; 🎒 opens the pack | 1–6, I / Tab |
| Talk to Wren | Tap Wren, or the 💬 button | T / Enter |
| Pet Biscuit | Tap Biscuit when he's close | E when close |
| Throw Biscuit's stick | the dashed *fetch* slot in the hotbar | G |
| Pause / save | ⏸ (top right): Resume, Save game | Esc / P |
| Read a note | Tap it, or Use when facing it; re-read from the 🎒 Journal | E |
| Hand Wren a request | Talk to her, or *Give to Wren* in the tracker | T |
| Build mode | 🔨 toggles; pick a piece in the bar, Use to place, ⟳ rotate, 🗑 remove (full refund) | B, 1–0, E, R, X |

**Goal:** collect **4 wood + 1 flint** and light a campfire in a clear spot. Flint shows up mostly on
*Flintseam Ridge*, and one piece is in the starting chamber. The fire burns down (75 s per piece of
wood, up to 8 stacked), so keep feeding it. When it dies the fog slowly thickens (the Long Dark). This
is never dangerous, just colder and moodier. Once the fire is lit, Biscuit trots over and sits by it,
and Wren sits down beside it to warm her hands.

**Gathering (M1):** hold to chop root trees (3 wood) and break rocks (2 stone, sometimes flint on
Flintseam Ridge). Mushrooms, glowcaps and crystal shards are pickups. Everything respawns slowly, and
only while you are more than 7 m away.

**Building (M1):** pieces are 2 m wide on a grid with cell centres on even metres. Floors fill cells,
walls / window walls / doors sit on cell edges (front faces away from you, ⟳ flips), roofs need a wall
under one edge, and hearth / bed roll / lantern / table / chest take one per cell. The ghost is green
when it fits and red (with a reason) when it doesn't. Costs: floor 2 wood + 1 stone, wall 3 wood,
window 3 wood + 1 stone, door 4 wood, roof 3 wood + 1 stone, hearth 2 wood + 6 stone, bed roll 2 wood,
lantern 1 wood + 2 stone, table 4 wood, chest 5 wood + 1 stone. The hearth is a real campfire (feed it
wood to light it). The chest has its own storage panel; tap a stack to move it.

**Chunk B (M1):**
- **Save/load.** One versioned JSON save in `localStorage['ember_hollow.save']` (v1): pack, every
  piece (door open state, chest contents), fire fuel (hearths by piece id, campfires by position), Cam's
  position, requests, read notes, keepsakes found, day count. Autosaves every 30 s and when the app is
  hidden (`visibilitychange` / `pagehide`), plus *Save game* in the pause menu. Wren's memory stays in
  its own key (`ember_hollow.companion_memory`) and survives New Game. Pickups and trees/rocks are not
  saved (they respawn).
- **Title screen** (text from `story/data/ui_text.json`): slow camera orbit around the camp fire behind
  a translucent menu; *Continue* only when a save exists; *New Game* asks first if it would replace one;
  the tap that starts also unlocks iOS audio. A random loading tip each time.
- **Biscuit v2:** pet him (hearts, then a play-bow), he barks ("woof!" bubble + `audio.bark()` hook) at
  unread notes, new areas and nearby flint/glowcaps/shards; gallops when fast; zoomies when you come back
  after a while; fetch from the hotbar stick; digs now and then (finds from `biscuit_finds.json`:
  60/30/10 common/uncommon/rare, some give items, 7 are placeable keepsakes, rare ones get a Wren line);
  sleeps on his bed if you built one. He and Wren steer around placed pieces.
- **Wren:** offline reply bank (`wren_replies.json`, DATA_FORMATS matching), ambient lines from
  `ambient_lines.json` (with `when` filters, a line on every placement and one for a finished shelter),
  gathers stray pickups for you, and gives **requests** (one at a time, chains, HUD tracker, needs are
  consumed; rewards are items, decorations to place, or new build pieces).
- **Lore notes:** 6 notes placed around the cave (2 more belong to areas that don't exist yet), read on
  a parchment reader, kept in the 🎒 Journal. Item tooltips use `item_flavor.json`.

## What's in M0

- **Cave:** five named chambers from `story/LORE.md` (Lanternmouth, Flintseam Ridge, the Glowcap
  Galleries, Mossdrip Grotto, the Hushing Pools) joined by winding tunnels. There are glowcap
  mushrooms, stalactites, a still pool, drifting motes, fog and robust collision (a signed-distance
  field with gradient push-out).
- **Dressing** (art-director GLBs, `src/world/dressing.js`, placed per `story/LORE.md`):
  - *Crystal clusters* (4 variants): densest on Flintseam Ridge's walls (14), a few in the Glowcap
    Galleries (4), Mossdrip Grotto (3), around the Hushing Pools (5) and one at Lanternmouth. They
    lean out from the rock and *hum* (emissive brightens and pulses) while a fire burns. The big
    clusters carry the art's optional #B98CFF light as the lowest-priority emitter.
  - *Moss* (3 clumps, 2 caps) where the air is damp: Mossdrip Grotto, the Glowcap Galleries, the
    Hushing Pools and the damp tunnels, plus caps on the boulders there. Only a little at the dry
    entrance.
  - *Torches*: Wren's family were Lanternmouth's lamplighters and still keep the first stretch lit,
    so 2 standing torches flank the path out toward Flintseam, and 6 lit wall torches line the first
    part of the tunnels out of Lanternmouth. Deeper in, 3 of the Keepers' old sconces hang cold and
    dark ("the waylamps went out, one after another").
  - Static pieces are merged per material (one draw call per material for the whole cave). Torch
    flames are instanced with a per-torch flicker, and all torch halos are one additive Points draw.
- **Lighting** (STYLE_GUIDE §8, approved values):
  - Hemisphere #3A5A80 / #0B0E14 at 0.9 before the first fire. It eases to 0.45 over about 3 s once
    any fire is lit, and returns to 0.9 only when every fire is out.
  - ACES tone mapping, exposure 1.1, sRGB output, max pixel ratio 1.5.
  - **Light budget** (`src/render/lights.js`): a fixed pool of 2 real PointLights (1 with `?low=1`),
    so the light count never changes and shaders never recompile. Campfires (priority 3), Wren's
    lantern (2), torches (1) and big crystals (0.5) are *emitters*. Each frame the best-scoring ones
    near the camera borrow a slot, with cross-fades on hand-over; priority only counts while the
    camera is inside a light's range. Everything else is emissive-only (flames, halos, crystals).
  - **Backlight fix:** Wren's and Biscuit's materials get a cool emissive lift (#16202C at 1.0) plus
    a fresnel rim (#7FA3C8, power 2.5, strength 0.35) patched into Lambert with `onBeforeCompile`.
    All rim materials share one shader program. There is no character-only light. Glowing parts
    (lantern crystal, collar tag) keep their own emissive.
- **Fire:**
  - Kenney campfire-pit model with flickering flame cones, particle flames and embers (capped at 30
    sparks), and a ground glow disc that shows the light radius.
  - Each fire is a priority-3 light emitter (#FF9A3C, intensity 12, distance 10, decay 2) with a
    ±10–15% flicker and 5 cm jitter. The fire is always the key light.
  - Procedural crackle audio.
  - Fuel bar in the HUD.
  - FogExp2 lerps between 0.04 (warm) and 0.075 (cold) based on fire level and distance.
- **Biscuit** (art director's `biscuit.glb`, 656 tris, node pivots, no skinning):
  - `src/entities/biscuit-rig.js` blends the baked poses (stand, sit, play bow, curled) and adds
    procedural layers on top: a diagonal-gait walk cycle on the four leg nodes, body bounce and
    breathing, ear flop (Z), panting jaw (X, 12°), head sniff and tilt, and the tail.
  - Tail: carried at -35° when happy, -70° (high) when petted or play-bowing, +40° tucked when the
    fire is out, and wagging ±25° on Y at 6–8 Hz.
  - Poses: sits by the fire; curls up after about 25 s by a lit fire once Cam has been idle for 12 s
    (any movement wakes him); play-bows when Cam comes back after wandering more than 9 m away, and
    when petted.
  - Other states: follow, idle, wander, sniff, lie down, whine when the fire dies, petted (hearts).
  - The poses are baked from `biscuit-sit/-playbow/-curled.glb` into `src/entities/biscuit-poses.js`
    by `tools/extract-biscuit-poses.mjs`, so only `biscuit.glb` ships. The old primitive boxer is
    kept as the fallback.
- **Wren** (art director's `wren.glb`, 1.7 m, node pivots, no skinning):
  - `src/companion/wren-anim.js` animates her procedurally:
    - walk cycle: legs, opposite arms, hip bob and sway, torso counter-twist
    - idle: breathing and weight-shift sway; her head turns toward Cam
    - warming at the fire: she sits down with her legs toward the flames and both hands out. Her
      legs are single rigid pieces with no knee pivot, so a true crouch would look broken.
    - lantern: re-parented to her right hand and swung from its handle by a damped spring driven by
      her acceleration, turns and steps
    - cloak sway; a hand-to-hood gesture whenever the hood changes
  - **Hood rule:** the hood goes up when the fog is *thick* and she isn't in a lit fire's radius.
    That's the case at the start, before the first fire, and whenever she's out in the Long Dark.
    It comes down once she's been in a lit fire's warmth for 4 s, or when the fog is thin. There are
    at least 10 s between changes, so it never flickers at the edge of the light. The `hood_up` node
    is grafted from `wren-hood-up.glb` onto her head and toggled against `hood_down`.
  - Her grandmother's waylamp is a priority-2 emitter (#E08A2E, 3.0, distance 6, decay 2) at the
    lantern's glTF light offset. It fades out inside a lit campfire's radius.
  - Follows you, warms herself at the fire, and can be tapped to chat.
  - glTF materials (MeshStandard) are converted to flat Lambert. Each animated pivot's colour
    primitives are merged into one vertex-coloured mesh, so Wren and Biscuit cost about 25 draw
    calls together instead of 44.
- **Wren's ambient lines:**
  - The 32 fixed lines across 15 triggers from `story/COMPANION.md`. They are not LLM calls.
  - At least 45 s between any two lines, at least 3 min per trigger, and the last line never repeats.
  - Lines show as subtitles and in the chat log.
- **Chat:**
  - Mobile chat panel that stays pinned above the soft keyboard (visualViewport); the canvas doesn't
    resize while you type.
  - Every message goes through a pluggable **LLM adapter**. The default is a **stub with canned,
    state-aware replies** (no network, no key).
  - The system prompt and `[CONTEXT]` block come from `story/` (location, fire level, time of night,
    shelter, recent finds, memory summary, puppy, **fog: thin | thickening | thick**, player name).
- **Memory:**
  - `localStorage["ember_hollow.companion_memory"]` holds player_name, facts, session_summaries and
    memory_summary.
  - It summarises every 30 messages and at session end (app backgrounded or closed, or 10 minutes
    idle). The summarizer is a stub for now.
- **PWA:**
  - Manifest with fullscreen, landscape, icons and a maskable icon.
  - Apple meta tags with a black-translucent status bar and an apple-touch-icon.
  - The service worker precaches every file, including the GLBs and their `Textures/`. The version
    is a content hash, so any change ships a new cache.
- **iOS hardening:**
  - Safe-area insets.
  - No bounce, pinch zoom, double-tap zoom or pull-to-refresh: `touch-action:none`, gesturestart
    cancelled, `user-scalable=no`.
  - Audio unlocks on the first tap.
  - A "rotate to landscape" screen in portrait.

## What's in M1 chunk C

- **Day/night** (STYLE_GUIDE §8.2, `src/render/daynight.js`): a 24-min cycle (day 10, dusk 2, night 10,
  dawn 2). The sun/moon is one no-shadow DirectionalLight that borrows a LightBudget slot; the moon
  gives its slot back when a priority-3 emitter (a fire) needs it. The surface look blends over the
  §8.1 cave ambient by `smoothstep(0, 6, depthIntoCave)`, so the cave keeps §8.1. Sky dome with
  twinkling stars, occasional rain (600 drops low tier / 1200 high, a camera-following box, surface
  only, masked under roofs) and procedural rain audio (muffled under a roof).
- **Surface clearing** outside Lanternmouth: instanced pine/round/birch trees (choppable in the bowl,
  deco on the cliff rim), bushes, glowberry bushes, three grass tufts, clearing pickups, and the
  clearing lore note on a birch. Static instanced decor (cave and clearing) is culled per instance
  against the frustum and fog distance (`src/render/instcull.js`).
- **Warmth** (HUD bar top-right): warms by a lit fire or in an enclosed shelter, drifts down
  elsewhere, faster on the surface at night or in rain. No damage: cold only brings a frost vignette,
  Wren's `warmth_cold` line and Biscuit pressing close. Fed to Wren's context as `warmth:`, with
  `time:` and `weather:`.
- **Cooking:** at a lit fire or hearth, select a mushroom or glowcap and Use → *Hang stew pot*, add 2
  ingredients, wait 15 s (steam), *Take stew*. Tap the selected stew slot again to eat: +45 warmth and
  no drift for 2 min.
- **Sleep:** Use the bed roll after the day ends → *Sleep till morning* fades out, skips to morning,
  Day +1, autosaves, with goodnight / good-morning lines. Biscuit curls up on his bed or by Cam.
- **Save** adds the time of day, weather, warmth, chopped/collected state with respawn timers, and
  stew pots.

## Install on iPhone (Safari)

1. Open the game's **HTTPS** URL in **Safari**. Other iOS browsers can't install PWAs reliably.
2. Tap the **Share** button (the square with an up arrow).
3. Scroll down and tap **Add to Home Screen**, then **Add**.
4. Launch **Ember Hollow** from the home screen. It runs full screen with no Safari bars. Turn the phone
   to landscape.
5. Sound: the first tap unlocks audio. If the side switch is on silent, iOS mutes web audio, so flip it
   to ring.
6. Updates: close and reopen the app. New files download in the background and apply on the next
   launch.

## Install on Android (Chrome)

1. Open the HTTPS URL in **Chrome**.
2. Tap **⋮ → Add to Home screen** (or **Install app** if Chrome offers it). Confirm.
3. Launch it from the home screen. It opens fullscreen and locks to landscape.

## Hosting (getting it onto the phone)

The game is static files, so any HTTPS static host works. **Serve the `game/` folder as the site
root.** It uses relative paths, so a sub-path like `/ember-hollow/` is fine too.

| Option | What's needed | Steps |
|---|---|---|
| **GitHub Pages** (recommended: free, permanent URL, updates with `git push`) | A GitHub account; the repo must be **public** on a free plan | `gh repo create ember-hollow --public --source=. --push`, then `gh api -X POST repos/<user>/ember-hollow/pages -f "source[branch]=main" -f "source[path]=/"`. The URL is `https://<user>.github.io/ember-hollow/` (live after about 1 minute). Or in the browser: Settings → Pages → Deploy from branch → `main` / root. |
| **Netlify Drop** (fastest, no CLI) | Netlify account (free); a dropped site expires after 1 h unless you claim it by signing in | Go to https://app.netlify.com/drop and drag the `game/` folder in. You get `https://<random>.netlify.app`. |
| **Cloudflare Pages** | Cloudflare account (free) + API token for the CLI | `npx wrangler pages deploy . --project-name ember-hollow`. The URL is `https://ember-hollow.pages.dev`. |
| Quick LAN test (no install) | Phone and computer on the same Wi-Fi | `python3 -m http.server 8080` and open `http://<LAN-IP>:8080/`. No service worker or home-screen install over plain HTTP. |

Before each deploy, run `node tools/build-sw.mjs`. It refreshes the service worker's file list and
version, so installed copies pick up the update.

> No API keys or credentials live in this repo, and none are needed for any of the above apart from
> the hosting account itself.

## Companion chat: swapping in a real LLM (later)

`src/config.js → CONFIG.llm.provider` picks the adapter: `'bank'` (default, Wren's offline reply bank), `'stub'` (old M0 canned replies) or `'http'`.
`src/companion/llm/http-adapter.js` posts an OpenAI-style `{model, messages}` body to
`CONFIG.llm.http.endpoint`.

**Never put an API key in client code.** Point `endpoint` at a small server-side proxy (for example a
Cloudflare Worker) that holds the key as a secret and forwards the request. To add another provider,
implement `reply({system, context, history, message, state})` and `summarize({...})` (see
`src/companion/llm/adapter.js`) and register it in `llm/index.js`.

## Project structure

```
game/
├── index.html            # HUD/chat/start markup, PWA + iOS meta, importmap for three
├── manifest.json         # PWA manifest (fullscreen, landscape, icons)
├── sw.js                 # service worker (GENERATED by tools/build-sw.mjs)
├── css/style.css         # HUD, MCPE-style buttons, chat panel, safe areas, no-zoom/bounce
├── icons/                # 192/512/maskable/apple-touch/favicon (tools/make-icons.py)
├── vendor/               # three.module.min.js r170 + GLTFLoader + BufferGeometryUtils (MIT)
├── assets/models/        # GLBs actually used (see assets/models/README.md)
├── assets/icons/         # 128 px item/piece icons (hotbar, pack, palette)
├── src/
│   ├── main.js           # bootstrap, game loop, interactions, triggers, session handling
│   ├── config.js         # every tunable: render/fog/lights, player, fire, costs, names, LLM, asset paths
│   ├── assets.js         # GLB loader with primitive fallback (drop-in art)
│   ├── audio.js          # WebAudio crackle + blips, unlocked on first tap
│   ├── render/           # lights.js (LightBudget + emitters), character-materials.js (lift + rim)
│   ├── render/ambient.js # firelight-aware hemisphere/fog colours + zone tints
│   ├── world/            # cave.js (SDF cave, meshes, collision), colliders.js (piece colliders + steering), lore.js (notes + parchment reader), decor.js, dressing.js, noise.js
│   ├── save/save.js      # versioned save in localStorage, New Game flag
│   ├── data/story.js     # GENERATED from ../story/data by tools/sync-story.mjs (bank, ambient, requests, lore, finds, flavor, ui text)
│   ├── input/input.js    # multitouch joystick/look/buttons/taps + keyboard/pointer-lock
│   ├── entities/         # player.js, items.js, harvest.js (trees/rocks), puppy.js + biscuit-rig.js + biscuit-poses.js (Biscuit)
│   ├── fire/campfire.js  # campfires, fuel, flames/embers, flickering light emitters
│   ├── build/            # pieces.js (catalogue + costs), shelter.js (snap, ghost, instancing, doors, chests)
│   ├── companion/        # wren.js, wren-anim.js, chat-ui.js, ambient.js, memory.js, context.js,
│   │   │                 # requests.js, when.js (state `when` filters), story-data.js (GENERATED), llm/ adapters (bank-adapter.js)
│   └── ui/               # hud.js, inventory-ui.js (hotbar, pack + journal, chest, palette, ring), tap.js (iOS-safe taps)
├── tools/                # sync-story.mjs, build-sw.mjs, make-icons.py, smoke-test.mjs, screenshots.mjs,
│                         # extract-biscuit-poses.mjs, pose-preview.html (dev pose viewer)
├── screenshots/          # art-review phone screenshots (1688×780), not precached
└── docs/                 # ROADMAP.md, screenshot.png
```

### Dropping in more art

1. Copy the GLB into `assets/models/<pack>/`. Kenney GLBs also need their `Textures/` folder
   beside them, because they reference `Textures/colormap.png` relatively.
2. Point the matching entry in `CONFIG.assets.models` at it. Art-director props load with
   `loadParts(name, { raw: true })`, which keeps their metres, base origin and +Z facing.
3. Run `node tools/build-sw.mjs`.

If a file is missing or fails to load, the game falls back to the built-in primitive, so it never
breaks.

### Updating Wren's words

The writer's files in `../story/` are the source of truth. After they change, run
`node tools/sync-story.mjs`. It regenerates `src/companion/story-data.js` (system prompt, context
template) and `src/data/story.js` (reply bank, ambient lines, requests, lore, Biscuit's finds, item
flavor, UI text), and then you run `node tools/build-sw.mjs`.

## Testing

```bash
npm i                                  # installs playwright (dev only)
python3 -m http.server 8931 &          # serve game/
BASE=http://localhost:8931/ node tools/smoke-test.mjs
```

The test emulates an iPhone in landscape (844×390, touch). It:
- checks that it loads with no console errors and no failed requests
- moves with the joystick and looks by dragging, using real touch events
- gathers items, lights and refuels a fire
- checks that Biscuit sits and Wren warms up by the fire and that the fog thins
- chats with Wren and checks the memory key and the context block
- M1: hold-to-chop with Use, press-and-hold a rock by touch, the new pickups, placing a floor / wall /
  roof / door / chest, rotate, door open (−100°, leaf collider off) and close, chest store and take,
  remove with full refund, and a 60-piece perf test (`m1.perf60`)
- hotfix: real CDP taps on the build palette / 🔨 / pack ✕ with trusted clicks swallowed (iOS), plus a
  swipe that must scroll, not select (`m1.touchUI`)
- chunk B: the title (ui_text, no Continue on a fresh profile, touch on New Game), pet, fetch, a dig,
  a bank chat reply, a request offered → needs carried → *Give to Wren* by touch → completed, a note
  opened and closed by touch → in the journal, then save → reload → *Continue* restores pieces, pack,
  notes, requests and position (`title`, `m2`, `reload`)
- chunk C (`m3`), with real CDP taps and trusted clicks swallowed: mushroom/glowcap hotbar slots,
  Use → hang pot / add / take stew, stew slot tap-again to eat (+ `stew_cooking`/`stew_eaten`), cold at
  night on the surface (frost, `warmth_cold`, Biscuit snuggles, context lines), the sleep panel's
  *Not yet* / ✕ / *Sleep till morning* (Day +1, saved, goodnight/goodMorning, no sleep_start), and
  perf in the clearing by day, the clearing at night in rain, and the cave mouth (≤60 calls, ≤80k
  tris, ≤2 lights); `reload` also checks time of day and warmth
- confirms the service worker activates

Screenshots go to `docs/screenshot.png` and `docs/test-output/`. The perf block reports draw calls,
triangles, real point lights and how many are active, the hemisphere intensity, and Wren's hood.
Add `QUERY=low=1` to test the low tier. It exits non-zero on any error, failed request, or failed
`touchUI` / `title` / `m2` / `m3` / `reload` check.

`node tools/screenshots.mjs` saves the art-review shots (1688×780) to `screenshots/`: the lit
campfire with Wren and Biscuit, a crystal chamber, and a torchlit tunnel.
