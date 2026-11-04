# Models used by the game (M0 + M1 chunk A)

Only the files in use are here. Everything was copied from `../../art/assets`.

## Art director (Style A, original for Ember Hollow)

Units are metres, Y-up, origin at the base, facing +Z. Materials are glTF MeshStandard; the game
converts them to flat Lambert. `KHR_materials_emissive_strength` lands in `emissiveIntensity`.

| File | Used for | Config key |
|---|---|---|
| characters/wren/wren.glb | Wren (pivots animated in `src/companion/wren-anim.js`) | `companion` |
| characters/wren/wren-hood-up.glb | only its `hood_up` node is used, grafted onto Wren's head | `companionHood` |
| dog/biscuit/biscuit.glb | Biscuit (pivots animated in `src/entities/biscuit-rig.js`) | `puppy` |
| crystals/crystal-cluster-1..4.glb | crystal clusters | `crystal1`–`crystal4` |
| moss/moss-clump-1..3.glb | moss clumps by damp walls | `mossClump1`–`mossClump3` |
| moss/moss-cap-1..2.glb | moss caps on boulders | `mossCap1`, `mossCap2` |
| torches/torch-wall.glb | lit wall torches and cold sconces | `torchWall` |
| torches/torch-standing.glb | standing torches at Lanternmouth | `torchStanding` |
| build/floor-plank.glb | build piece: floor (2 m) | `floorPiece` |
| build/wall-log.glb | build piece: wall (2 m wide, turned 90° in code to run along an edge) | `wallPiece` |
| build/wall-log-window.glb | build piece: window wall | `windowPiece` |
| build/wall-log-door.glb | build piece: door; `door_hinge` swings to −100° Y | `doorPiece` |
| build/roof-log.glb | build piece: 30° lean-to roof | `roofPiece` |
| build/lantern_double.glb (art/decor) | build piece: lantern (emissive glass; light comes from the shared LightBudget) | `lanternPiece` |
| props/chest.glb | build piece: storage chest; `lid_hinge` opens to −75° X | `chestPiece` |
| props/bedroll.glb | build piece: bed roll | `bedrollPiece` |

Hearth and table have no art yet and use primitives (`src/build/shelter.js` → `fallback()`).

Biscuit's sit, play-bow and curled poses (`biscuit-sit/-playbow/-curled.glb` in art/) are baked into
`src/entities/biscuit-poses.js` by `tools/extract-biscuit-poses.mjs`, so those files aren't shipped.
Not used: `moss/mossy-rock-demo.glb`. The game composes moss caps onto its own boulders.

## Kenney (CC0, see LICENSE-kenney-CC0.txt)

Each pack keeps its `Textures/` folder beside the GLBs, because the GLBs reference
`Textures/colormap.png` relatively.

| File | Used for | Config key |
|---|---|---|
| campfire/campfire-pit.glb (+Textures) | campfire stone ring + logs | `campfire` |
| props/resource-wood.glb (+Textures) | wood pickups | `stick` |
| props/resource-stone.glb (+Textures) | stone + flint pickups (flint tinted dark) | `stone` |
| nature/stone_largeA.glb | boulders scattered in chambers | `boulder` |
| nature/stone_tallA.glb | rock pillars | `pillar` |
| cave-rock/rock-b.glb (+Textures) | hold-to-break rocks (one variant, random yaw/scale) | `rockB` |
| nature/mushroom_red.glb | mushroom pickups | `mushroomRed` |

Root trees, glowcap and crystal-shard pickups are procedural (`src/entities/harvest.js`, `src/entities/items.js`).

## Icons (`../icons/`, 128 px, from art/assets/icons)

wood, stone, glowcap, crystal (shard), chest, bedroll, wall-log, wall-log-door, wall-log-window,
floor-plank, roof-log, lantern_double. Items/pieces without an icon (flint, mushroom, hearth, table)
use an emoji.
