// Which sentence of a stop's text does a suggested object point at? Used to light
// up that sentence while the reader points at the object. Plain string matching on
// the hook Claude (or the keyword matcher) wrote, so it works for palace files that
// were built before this existed. No DOM, so it also runs in Node.

const STOP = new Set(`about after also another because before being between could every first from have having
  into just like made make many more most much must near never only other over same should some such than that their
  them then there these they this those through under until very were what when where which while will with would
  your version versions called`.split(/\s+/));

/** Content words of a text, cut to 4 letters so "canoes" matches "canoe" and "dancing" matches "dance". */
function stems(text) {
  const out = new Set();
  for (const raw of text.toLowerCase().split(/[^a-z0-9à-ÿ']+/)) {
    const w = raw.replace(/'s$|'/g, '');
    if (/^\d+$/.test(w)) { if (w.length >= 2) out.add(w); continue; }
    if (w.length < 4 || STOP.has(w)) continue;
    out.add(w.slice(0, 4));
  }
  return out;
}

/** Split a paragraph into sentences (good enough for highlighting; abbreviations may split early). */
export function sentences(paragraph) {
  return (paragraph.match(/[^.!?]+(?:[.!?]+["'”’)\]]*|$)/g) || []).map((s) => s.trim()).filter((s) => s.length > 12);
}

/**
 * For each hook, the sentence of the text that shares the most content words with it,
 * or null when nothing matches well enough.
 * @param {string[]} paragraphs the text as shown at the stop
 * @param {string[]} hooks one line per suggested object
 */
export function findAnchors(paragraphs, hooks) {
  const all = paragraphs.flatMap(sentences).map((s) => ({ s, w: stems(s) }));
  // words that appear in few sentences say more about which sentence is meant
  const seenIn = new Map();
  for (const cand of all) for (const w of cand.w) seenIn.set(w, (seenIn.get(w) || 0) + 1);
  return hooks.map((hook) => {
    if (!hook) return null;
    const fromKeywords = /^matches:/i.test(hook);
    const want = stems(hook.replace(/^matches:/i, ''));
    let best = null;
    let bestScore = 0;
    for (const cand of all) {
      let shared = 0;
      let score = 0;
      for (const w of want) if (cand.w.has(w)) { shared += 1; score += 1 / seenIn.get(w); }
      if (shared >= (fromKeywords ? 1 : 2) && score > bestScore) { best = cand.s; bestScore = score; }
    }
    return best;
  });
}
