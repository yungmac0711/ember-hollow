// M2 chunk A: item / UI icons from Art's atlas (game/icons/atlas.png + atlas.json, 105 keys at
// 1024×1792, 128 px cells). One sprite sheet = one request; the per-key PNGs (icons/<key>.png) are
// copied alongside for anything that wants a single file. Aliases (axe → stone_axe, …) resolve first,
// and x/y always come from atlas.json (positions change between art drops). Keys the atlas doesn't
// have (flint, mushroom, …) fall back to their emoji.
let ATLAS = null;

export async function loadIconAtlas(url = 'icons/atlas.json') {
  try { const r = await fetch(url); if (r.ok) ATLAS = await r.json(); } catch (e) { console.warn('[icons] atlas.json', e); }
  return ATLAS;
}
export const atlasReady = () => !!ATLAS;

/** Resolve an alias (axe → stone_axe); unknown keys come back unchanged. */
export function iconKey(k) { return ATLAS?.aliases?.[k] || k; }
export function hasIcon(k) { return !!ATLAS?.icons?.[iconKey(k)]; }

/**
 * Sprite markup for an atlas key. Size comes from the CSS custom property --is on the element or an
 * ancestor (default 32px), so the same markup works in the hotbar (32), the pack (30), the ring…
 * background-size = atlas size × (is / 128); position = −x·(is/128), −y·(is/128).
 */
export function spriteHtml(k, cls = '') {
  const e = ATLAS?.icons?.[iconKey(k)];
  if (!e) return null;
  const [W, H] = ATLAS.size || [1024, 1792], c = ATLAS.cell || 128;
  return `<span class="ico-sp ${cls}" style="--ax:${e.x / c};--ay:${e.y / c};--aw:${W / c};--ah:${H / c}" aria-hidden="true"></span>`;
}
