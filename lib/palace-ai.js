// Theme + object suggestions from Claude (proposal step 3). Runs on the server only:
// the API key must never reach the browser. Used by api/suggest.js (Vercel),
// server.mjs (local dev) and scripts/build-palace.mjs (pre-built study palaces).
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { OBJECTS, THEMES } from '../js/catalog.js';
import { suggestObjects, explain } from '../js/mapper.js';

export const MODEL = process.env.MIND_PALACE_MODEL || 'claude-opus-5-5';

const OBJECT_IDS = OBJECTS.map((o) => o.id);
const THEME_IDS = Object.keys(THEMES);
const MAX_CHUNKS = 12;
// Chunks are already reading-sized; this cap only guards the endpoint against
// huge requests. The first 6,000 characters of a stop are plenty to pick objects.
const MAX_CHARS_PER_CHUNK = 6000;

const Suggestions = z.object({
  theme: z.enum(THEME_IDS),
  theme_reason: z.string(),
  chunks: z.array(z.object({
    index: z.number().int(),
    suggestions: z.array(z.object({
      object_id: z.enum(OBJECT_IDS),
      hook: z.string(),
    })),
  })),
});

const SYSTEM = `You help readers build a memory palace for a Wikipedia article.

The article has been split into chunks. Each chunk will sit at one stop along a path in a small 3D room, and the reader will choose ONE object from a fixed catalog to stand at that stop. Looking at the object later should bring back what that chunk said. You shortlist the objects the reader chooses from, and you pick the room's theme.

For every chunk, suggest exactly 5 objects from the catalog, best first:
- Tie each object to a concrete, memorable detail in that chunk (a name, event, image, number), not only to the general topic.
- Make the 5 options differ from each other so the reader has a real choice.
- Across the room, give each chunk a different first choice so every stop has a distinct landmark.
- Use only object ids from the catalog.

For each suggestion write a "hook": one sentence of at most 15 words that links the object to that detail, for example "The lumberjacks paddle their canoe through the night sky." Do not start the hook with the object's name; the interface already shows it. Hooks must be accurate to the chunk's text; never add facts that are not in it.

Then choose one theme for the whole room from the theme list and give a one-sentence reason.

Catalog (id — name: what it can stand for):
${OBJECTS.map((o) => `${o.id} — ${o.name}: ${o.desc}`).join('\n')}

Themes (id: description):
${Object.entries(THEMES).map(([id, t]) => `${id}: ${t.desc}`).join('\n')}`;

export class InputError extends Error {
  constructor(message) { super(message); this.status = 400; }
}

/** Check and normalise the request body: { title, chunks: [{ heading, text }] }. */
export function readInput(body) {
  const title = String(body?.title ?? '').trim().slice(0, 300);
  const chunks = Array.isArray(body?.chunks) ? body.chunks : null;
  if (!title || !chunks?.length) throw new InputError('Expected { title, chunks: [{ heading, text }] }.');
  if (chunks.length > MAX_CHUNKS) throw new InputError(`At most ${MAX_CHUNKS} chunks.`);
  return {
    title,
    chunks: chunks.map((c) => ({
      heading: String(c?.heading ?? '').slice(0, 300),
      text: String(c?.text ?? '').slice(0, MAX_CHARS_PER_CHUNK),
    })),
  };
}

/**
 * Ask Claude for a theme and 5 object suggestions per chunk.
 * Returns { theme, themeReason, chunks: [{ suggestions: [{ id, why }] }], source, model }.
 */
export async function suggestWithClaude({ title, chunks }, client = new Anthropic()) {
  const content = `Article: ${title}\n\n${chunks.map((c, i) =>
    `<chunk index="${i}" heading="${c.heading.replace(/"/g, "'")}">\n${c.text}\n</chunk>`).join('\n\n')}`;

  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { format: betaZodOutputFormat(Suggestions), effort: 'medium' },
    system: SYSTEM,
    messages: [{ role: 'user', content }],
  });

  if (response.stop_reason === 'refusal') throw new Error('Claude declined this article.');
  if (response.stop_reason === 'max_tokens') throw new Error('Claude ran out of output tokens.');
  const out = response.parsed_output;
  if (!out) throw new Error('Claude returned no structured output.');

  // Keep only valid, distinct objects; top up from the keyword matcher if Claude
  // returned fewer than 3 for a chunk.
  const result = chunks.map((chunk, i) => {
    const fromClaude = out.chunks.find((c) => c.index === i)?.suggestions ?? [];
    const seen = new Set();
    const list = [];
    for (const s of fromClaude) {
      if (!OBJECT_IDS.includes(s.object_id) || seen.has(s.object_id)) continue;
      seen.add(s.object_id);
      list.push({ id: s.object_id, why: s.hook.trim() });
    }
    if (list.length < 3) {
      const local = { heading: chunk.heading, parts: [{ heading: chunk.heading, full: chunk.text }] };
      for (const m of suggestObjects(local, seen)) {
        if (list.length >= 5) break;
        list.push({ id: m.id, why: `matches: ${explain(m)}` });
      }
    }
    return { suggestions: list.slice(0, 5) };
  });

  return {
    theme: out.theme,
    themeReason: out.theme_reason,
    chunks: result,
    source: 'claude',
    model: response.model,
    usage: { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens },
  };
}

/** Map SDK errors to an HTTP status and a message that is safe to show. */
export function describeError(err) {
  if (err instanceof InputError) return { status: 400, error: err.message };
  if (err instanceof Anthropic.AuthenticationError) return { status: 503, error: 'Claude API key is missing or invalid on the server.' };
  if (err instanceof Anthropic.RateLimitError) return { status: 429, error: 'Claude is rate-limited; try again shortly.' };
  if (err instanceof Anthropic.APIError) return { status: 502, error: `Claude API error (${err.status ?? 'network'}).` };
  if (/api key|apiKey|authToken|credentials/i.test(err?.message || '')) return { status: 503, error: 'No Claude API key configured on the server.' };
  return { status: 500, error: err?.message || 'Unknown error' };
}
