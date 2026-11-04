# Models used by M0

These Kenney assets are CC0 (see LICENSE-kenney-CC0.txt). They were copied from `../../art/assets`,
and only the ones in use are here. Each pack keeps its `Textures/` folder beside the GLBs, because
the GLBs reference `Textures/colormap.png` relatively.

| File | Used for | Config key |
|---|---|---|
| characters/character-female-a.glb (+Textures) | Wren (animated) | `companion` |
| campfire/campfire-pit.glb (+Textures) | campfire stone ring + logs | `campfire` |
| props/resource-wood.glb (+Textures) | wood pickups | `stick` |
| props/resource-stone.glb (+Textures) | stone + flint pickups (flint tinted dark) | `stone` |
| nature/stone_largeA.glb | boulders scattered in chambers | `boulder` |
| nature/stone_tallA.glb | rock pillars | `pillar` |
| wood-floors-structures/floor.glb (+Textures) | build-mode floor tile | `floorPiece` |

Biscuit is a procedural primitive boxer (fawn, white chest, black mask) because the Kenney dog isn't
a boxer and has no sit clip. Set `CONFIG.assets.models.puppy` to a GLB to replace it.
