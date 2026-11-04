# Ember Hollow — Roadmap

## ✅ M0: first playable (this build)

- Cave with five chambers, fog, collision, mushrooms and crystals
- MCPE-style touch controls, plus WASD and mouse on desktop
- Gather wood, stone and flint; light a campfire; fuel burns down; refuel; fog thickens as the fire
  dies
- Biscuit: follows, wanders, sits by the fire, can be petted
- Wren: follows, has a lantern, 32 ambient lines, tap-to-chat through the stub LLM adapter, memory in
  localStorage
- Stub build mode: 2 m snap-grid floor tiles
- PWA install, offline cache, iOS fixes

## M0.5: get it on Cameron's phone (needs a go-ahead)

1. Publish `game/` to **GitHub Pages**. It's a public repo, and `gh` is already signed in on the box.
   Alternatives are Netlify Drop or Cloudflare Pages (see README → Hosting).
2. Cameron installs it via Safari → Share → **Add to Home Screen**.
3. Playtest on the real iPhone to check:
   - joystick and look sensitivity (`CONFIG.player.lookTouch`)
   - button sizes and safe areas on a notch or Dynamic Island in landscape
   - FPS with `?fps=1` (target 60, floor 30)
   - brightness of the pre-fire dark (`CONFIG.render.hemi`, the Wren lantern)
   - the soft keyboard with the chat panel
4. Optional: a "new version available" toast from the service worker.

## M1: cozy build (shelter building)

- Snap pieces from DESIGN_BRIEF: floor, wall, wall with window, door, roof, hearth, bed roll,
  lantern, small table. `src/build/shelter.js` already has the `PIECES` catalogue and ghost preview;
  add rotation (90° steps), wall edge-snapping and a piece picker strip.
- Remove a piece with tap-and-hold, refunding its materials (brief: "tap-and-hold to break/gather").
- Shelter state goes into the context block (`shelter: floor x4, walls 3/4, roof yes`).
- Inside the shelter: warmth bonus, less fog, a rest/sleep action (ends the night and triggers
  `morning`).
- A real day/night pass: the night clock already exists, so tie it to cave mouth light and audio.
- Ambient audio beds: drips, wind in the tunnels, Biscuit's barks and snores.
- Save/load the world (fires, tiles, inventory, gathered items) to localStorage.

## M1/M2: live LLM companion chat

1. Cameron sets up an LLM account, and the key goes in via a **secure prompt, never in chat**.
2. Deploy a tiny proxy (a Cloudflare Worker or similar) that holds the key as a secret, rate-limits,
   and only accepts this site's origin.
3. Set `CONFIG.llm.provider = 'http'` and `CONFIG.llm.http.endpoint = <proxy URL>`. The
   OpenAI-compatible adapter is already written.
4. Replace the stub summarizer with a real summary call (the same adapter's `summarize`). Keep the
   memory caps: 50 facts, 10 session summaries, a 600-character summary.
5. Keep the replies short and in Wren's voice (prompt from `story/`). Keep the 35-word cap. Add a
   fallback to the stub when offline.
6. Optional: Wren comments on surroundings in her own words using rare LLM "barks", alongside the 32
   fixed lines.

## M2: Biscuit AI polish

- A real boxer model (art/) with idle, walk, run, sit, lie, sniff, wag and bark clips. Swap it in
  through `CONFIG.assets.models.puppy`.
- Smarter pathing through tunnels: a navigation graph from the cave chambers instead of steering
  straight at the target.
- Barks at points of interest (flint veins, crystals) and leads Cam to them. Zoomies when the fire
  roars. Curls up on the bed roll inside the shelter.
- Petting with a hold gesture; a fetch-a-stick mini interaction.

## M2: art and world polish

- Swap more Kenney or art-director assets: wall rock kits, mushrooms, crystals, logs.
- More chambers and a deeper level; let Wren's facts record discoveries.
- Settings: look sensitivity, invert Y, quality tier (low tier is at most 60 draw calls and 80k
  triangles).
