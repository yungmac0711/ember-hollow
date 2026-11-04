# Models used by M0

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
| wood-floors-structures/floor.glb (+Textures) | build-mode floor tile | `floorPiece` |
