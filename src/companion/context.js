// Fills the writer's [CONTEXT] block (story/companion_system_prompt.md) from live game state.
import { CONTEXT_TEMPLATE } from './story-data.js';

export function fireLevelWord(level, lit) {
  if (!lit) return 'out';
  return level < 25 ? 'low' : level < 70 ? 'steady' : 'roaring';
}

/** fog follows the fire: thin while it's well fed, thickening as it dies, thick when out. */
export function fogWord(level, lit) {
  if (!lit) return 'thick';
  return level >= 40 ? 'thin' : 'thickening';
}

/**
 * @param state {location, locationDesc, fire:{anyLit, level, levelWord}, timeOfNight, shelter,
 *               recentFinds, memorySummary, puppy, fog, playerName}
 */
export function buildContextBlock(state) {
  const fields = {
    location: state.locationDesc ? `${state.location}, ${state.locationDesc}` : state.location,
    fire: state.fire.anyLit ? `lit, level: ${state.fire.levelWord} (${state.fire.level})` : 'unlit, level: out',
    time_of_night: state.timeOfNight,
    shelter: state.shelter || 'none',
    recent_finds: state.recentFinds || 'nothing yet',
    memory_summary: state.memorySummary || '(none yet)',
    puppy: state.puppy,
    fog: state.fog,
    player_name: state.playerName || 'Cam',
  };
  // Keep the writer's field order from the template.
  const order = [...CONTEXT_TEMPLATE.matchAll(/^([a-z_]+):/gm)].map((m) => m[1]);
  const lines = order.map((k) => `${k}: ${fields[k] ?? ''}`);
  return `[CONTEXT]\n${lines.join('\n')}\n[/CONTEXT]`;
}
