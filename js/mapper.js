// Theme + object mapping (proposal step 3).
// The proposal routes chunks through a proxy to an LLM that picks a room theme and
// 3–5 candidate objects per chunk. This demo uses a transparent keyword matcher as
// a stand-in with the same interface, and shows *why* each object was suggested.
import { OBJECTS, THEMES } from './catalog.js';
import { chunkPlainText } from './wiki.js';

export { THEMES };

const tokenize = (text) => text.toLowerCase().match(/[a-z]+/g) || [];

const matches = (w, keyword) => (keyword.length >= 4 ? w.startsWith(keyword) : w === keyword);

function countHits(words, keyword) {
  let n = 0;
  for (const w of words) if (matches(w, keyword)) n++;
  return n;
}

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967295;
}

export function pickTheme(chunks) {
  const words = tokenize(chunks.map(chunkPlainText).join(' '));
  let best = 'library';
  let bestScore = 0;
  for (const [id, t] of Object.entries(THEMES)) {
    const score = t.keywords.reduce((s, k) => s + Math.min(countHits(words, k), 40), 0);
    if (score > bestScore) { best = id; bestScore = score; }
  }
  return best;
}

/** Rank every object in the kit for a chunk. Heading matches count more than body matches. */
export function rankObjects(chunk) {
  const headWords = tokenize(chunk.heading);
  const bodyWords = tokenize(chunkPlainText(chunk));
  return OBJECTS.map((o) => {
    const matched = [];
    let score = 0;
    for (const k of o.keywords) {
      const h = countHits(headWords, k);
      const b = Math.min(countHits(bodyWords, k), 4);
      if (h || b) {
        score += h * 6 + b;
        // remember the actual word from the article, not the stem
        matched.push((h ? headWords : bodyWords).find((w) => matches(w, k)));
      }
    }
    return { id: o.id, score: score + hash(chunk.heading + o.id) * 0.5, matched };
  }).sort((a, b) => b.score - a.score);
}

/**
 * 3–5 suggestions for a chunk, skipping objects already placed elsewhere in the
 * room so every stop stays visually distinct.
 */
export function suggestObjects(chunk, usedIds = new Set()) {
  const ranked = rankObjects(chunk).filter((r) => !usedIds.has(r.id));
  const strong = ranked.filter((r) => r.matched.length > 0);
  const n = Math.min(5, Math.max(3, strong.length));
  return ranked.slice(0, n);
}

/** Human-readable reason for a suggestion, e.g. “species, evolution”. */
export function explain(match) {
  if (!match.matched.length) return 'wildcard pick';
  return [...new Set(match.matched)].slice(0, 3).join(', ');
}
