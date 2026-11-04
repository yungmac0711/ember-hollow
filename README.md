# Ember Hollow — M0 prototype

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
- `?autostart=1`: skip the "Tap to begin" screen
- `?llm=http`: use the HTTP LLM adapter (see *Companion chat*)

## Controls

| Action | Phone (landscape) | Desktop |
|---|---|---|
| Move | Left thumb: the floating joystick appears where you touch | WASD / arrows |
| Look | Drag anywhere on the right side | Mouse (click to lock the pointer) |
| Jump | ⤒ button | Space |
| Use / gather / add wood / light fire / pet / talk | The big context button (its label shows the action) | E / F / left click |
| Talk to Wren | Tap Wren, or the 💬 button | T / Enter |
| Pet Biscuit | Tap Biscuit when he's close | E when close |
| Build mode (floor tiles) | 🔨 to toggle, then Use to place | B, then E |

**Goal:** collect **4 wood + 1 flint** and light a campfire in a clear spot. Flint shows up mostly on
*Flintseam Ridge*, and one piece is in the starting chamber. The fire burns down (75 s per piece of
wood, up to 8 stacked), so keep feeding it. When it dies the fog slowly thickens (the Long Dark). This
is never dangerous, just colder and moodier. Once the fire is lit, Biscuit trots over and sits by it,
and Wren crouches beside it to warm her hands.

A floor tile costs 2 wood + 1 stone and snaps to a 2 m grid. Walls, roof and removal are planned for
M1.

## What's in M0

- **Cave:** five named chambers from `story/LORE.md` (Lanternmouth, Flintseam Ridge, the Glowcap
  Galleries, Mossdrip Grotto, the Hushing Pools) joined by winding tunnels. There are glowcap
  mushrooms, amethyst crystals, stalactites, a still pool, drifting motes, fog and robust collision
  (a signed-distance field with gradient push-out).
- **Fire:**
  - Kenney campfire-pit model with flickering flame cones, particle flames and embers (capped at 30
    sparks), and a ground glow disc that shows the light radius.
  - One shared PointLight per the style guide (#FF9A3C, 6–8, distance 10, decay 2).
  - Procedural crackle audio.
  - Fuel bar in the HUD.
  - FogExp2 lerps between 0.04 (warm) and 0.075 (cold) based on fire level and distance.
- **Biscuit:**
  - Primitive boxer: fawn coat, white chest and socks, dark muzzle, floppy ears, collar tag.
  - States: follow, idle, wander, sniff, lie down, go to the fire and sit, whine when the fire dies,
    and petted (with hearts).
- **Wren:**
  - Kenney character (animated: idle, walk, crouch) with a waylamp lantern light.
  - Follows you, warms herself at the fire, and can be tapped to chat.
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
  - The service worker precaches every file, including the GLBs and their `Textures/`.
- **iOS hardening:**
  - Safe-area insets.
  - No bounce, pinch zoom, double-tap zoom or pull-to-refresh: `touch-action:none`, gesturestart
    cancelled, `user-scalable=no`.
  - Audio unlocks on the first tap.
  - A "rotate to landscape" screen in portrait.

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

`src/config.js → CONFIG.llm.provider` picks the adapter: `'stub'` (default) or `'http'`.
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
├── assets/models/        # Kenney CC0 GLBs actually used, each beside its Textures/
├── src/
│   ├── main.js           # bootstrap, game loop, interactions, triggers, session handling
│   ├── config.js         # every tunable: render/fog/lights, player, fire, costs, names, LLM, asset paths
│   ├── assets.js         # GLB loader with primitive fallback (drop-in art)
│   ├── audio.js          # WebAudio crackle + blips, unlocked on first tap
│   ├── world/            # cave.js (SDF cave, meshes, collision), decor.js, noise.js
│   ├── input/input.js    # multitouch joystick/look/buttons/taps + keyboard/pointer-lock
│   ├── entities/         # player.js, items.js, puppy.js (Biscuit)
│   ├── fire/campfire.js  # campfires, fuel, flames/embers, shared flickering light
│   ├── build/shelter.js  # snap-grid build mode (floor tiles)
│   ├── companion/        # wren.js, chat-ui.js, ambient.js, memory.js, context.js,
│   │   │                 # story-data.js (GENERATED from ../story), llm/ adapters
│   └── ui/hud.js         # inventory, hints, fuel bar, subtitles, toasts, FPS counter
├── tools/                # sync-story.mjs, build-sw.mjs, make-icons.py, smoke-test.mjs
└── docs/                 # ROADMAP.md, screenshot.png
```

### Dropping in more art

1. Copy the GLB **and its `Textures/` folder** into `assets/models/<pack>/`. Kenney GLBs reference
   `Textures/colormap.png` relatively.
2. Point the matching entry in `CONFIG.assets.models` at it. For example, set `puppy` to a boxer GLB
   (with `sit`, `idle` and `walk` clips) to replace the primitive Biscuit.
3. Run `node tools/build-sw.mjs`.

If a file is missing or fails to load, the game falls back to the built-in primitive, so it never
breaks.

### Updating Wren's words

The writer's files in `../story/` are the source of truth. After they change, run
`node tools/sync-story.mjs`. It regenerates `src/companion/story-data.js` (system prompt, context
template, the 32 ambient lines), and then you run `node tools/build-sw.mjs`.

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
- confirms the service worker activates

Screenshots go to `docs/screenshot.png` and `docs/test-output/`.
