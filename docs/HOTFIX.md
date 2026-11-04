# Hotfix: iOS build-palette taps (Nov 4, 2026)

**Shipped:** commit `36d7f5e` on origin/main, on top of 0e6ed37. Only the hotfix went out; chunk B was stashed. SW version `ac49d6bc12` → `e42ccae4e9`, confirmed live at https://yungmac0711.github.io/ember-hollow/sw.js.

**Cause:** The palette buttons, panel ✕, chest slots and chat ✕ only listened for `click`. On iOS Safari the game's touchmove `preventDefault` and `touch-action: none` on the HUD make Safari drop the synthesized click, so tapping a piece did nothing. The hotbar, Use and build buttons were fine because they already use pointerdown. Old smoke tests used `el.click()`, which hid the problem.

**Fix:** A new `src/ui/tap.js` `onTap()` acts on pointerup when the finger moved less than 10 px and the container didn't scroll. It stops propagation, so a tap is never read as a look-drag or a placement. Pointercancel covers a browser scroll. Keyboard Enter/Space still works.
- It is applied to the build palette (one handler on the container, so sideways swipes still scroll), every panel ✕, chest pack/store slots and the chat ✕.
- The palette was already above the touch layer (#hud z-index 2 > #touch-layer 1, pointer-events auto).

**Faster updates on phones:**
- `register('./sw.js', {updateViaCache:'none'})`.
- `registration.update()` runs on visibilitychange → visible.
- On `controllerchange` the page reloads once. This is guarded by sessionStorage and skipped on the first install.
- The precache uses `cache:'reload'` so it never stores stale HTTP-cached files.

**Test:** A new smoke-test section, `m1.touchUI`, uses real CDP `Input.dispatchTouchEvent` while swallowing trusted clicks to mimic iOS.
- It checks that tapping wall/roof/chest/floor changes `build.selected`.
- It checks that a sideways swipe scrolls the palette (scrollLeft 0 → 125) without changing the selection.
- It checks the build button on/off and that the pack opens and closes via ✕.
- The test fails if this section fails.

| Run | Result |
|---|---|
| Against the old code (reproduces the bug) | FAIL: every tap left the selection on `chest` |
| Local, with the fix | PASS |
| Live (BASE = Pages URL) | PASS, 0 console errors, 0 failed requests; spawn perf 55 calls / 68.6k tris (normal tier) |

**On Cameron's phone:** the first open after this deploy may still show the old version once. The old SW serves its cache while it updates in the background. The new SW then takes over, and from now on new deploys reload automatically. If it still seems stuck, closing the tab or app and reopening it fixes it.
