// Offline canned-reply adapter (default). No network, no key. Reacts to simple keywords and the
// raw game state so the chat already feels alive in M0.
import { LLMAdapter } from './adapter.js';

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export class StubAdapter extends LLMAdapter {
  get id() { return 'stub'; }

  async reply({ message, state }) {
    await new Promise((r) => setTimeout(r, 500 + Math.random() * 700)); // "thinking"
    const m = message.toLowerCase();
    const name = state.playerName || 'Cam';
    const fire = state.fire;
    if (/\b(hi|hello|hey|evening|morning)\b/.test(m)) return pick([`Evening, ${name}. Stay where I can see you.`, `There you are, ${name}. Biscuit's been looking for you.`]);
    if (/fire|warm|cold|light|ember/.test(m)) {
      if (!fire.anyLit) return `No fire yet. Four bits of wood and one flint, ${name}, and we'll have the dark backing off.`;
      if (fire.levelWord === 'low') return `It's going hungry, ${name}. Toss on some wood before the fog gets ideas.`;
      return pick([`Hear it crackle? That's the best sound in the Hollow.`, `Warm enough for once. Sit a while, ${name}.`]);
    }
    if (/biscuit|dog|pup|puppy/.test(m)) return pick([`Biscuit? He's ${state.puppy}. Nose of a hero, brain of a biscuit.`, `Scratch his ears and he's yours forever, ${name}. He already is, really.`]);
    if (/flint/.test(m)) return `Flint turns up in the dry seams, out past the crystals on Flintseam Ridge. Fire's a promise, flint keeps it.`;
    if (/wood|stick/.test(m)) return `Driftwood washes down from the forest above. Look along the floors, ${name}.`;
    if (/where|lost|map|area|place/.test(m)) return `We're in ${state.location}. Mind your step, the floor wanders.`;
    if (/fog|dark|scared|afraid/.test(m)) return `The Long Dark's just fog, ${name}. It misses the light, that's all. Keep the fire fed and it backs off.`;
    if (/shelter|build|wall|roof|home/.test(m)) return `Floors first, ${name}. Wood and a bit of stone. Walls and a roof once we've the knack.`;
    if (/who are you|your name|wren/.test(m)) return `Wren Ashby, lamplighter's daughter from Lanternmouth. I came down to relight the waylamps and found you instead.`;
    if (/\?$/.test(m)) return pick([`Good question. Ask me again by the fire.`, `Hm. I'd say yes, but I'm biased toward warm things.`]);
    return pick([
      `Mm. Tell me more by the fire, ${name}.`,
      `I like the way you think, ${name}. Mostly.`,
      `Stay close. The deep's quieter with two.`,
      `Biscuit agrees, judging by the tail.`,
    ]);
  }

  // Stub summarizer: no model, so it just records a neutral line from the last few messages.
  async summarize({ transcript }) {
    const mine = transcript.filter((t) => t.role === 'user').slice(-3).map((t) => t.content.slice(0, 40));
    const summary = mine.length ? `Talked about: ${mine.join('; ')}`.slice(0, 200) : 'A quiet stretch by the fire.';
    return { summary, facts: [] };
  }
}
