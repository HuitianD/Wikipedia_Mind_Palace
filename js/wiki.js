// Article extraction + chunking (proposal steps 1 & 2).
// The proposal's browser extension reads the article from the page; in this demo
// the website fetches the same plain-text sections from the Wikipedia API.

const API = 'https://en.wikipedia.org/w/api.php';

// Sections that are not article content.
const DROP = new Set([
  'see also', 'references', 'notes', 'external links', 'further reading',
  'bibliography', 'sources', 'citations', 'footnotes', 'gallery', 'works cited',
  'explanatory notes', 'notes and references', 'references and notes',
  'general references', 'cited sources', 'primary sources', 'secondary sources',
  'external link', 'reference', 'citation', 'filmography', 'discography',
]);

export function parseTitle(input) {
  const s = input.trim();
  const m = s.match(/wikipedia\.org\/wiki\/([^?#]+)/i);
  if (m) return decodeURIComponent(m[1]).replace(/_/g, ' ');
  return s;
}

export function articleUrl(title) {
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
}

export async function searchTitles(query, signal) {
  const url = `${API}?action=opensearch&format=json&origin=*&namespace=0&limit=6&search=${encodeURIComponent(query)}`;
  const res = await fetch(url, { signal });
  if (!res.ok) return [];
  const data = await res.json();
  return data[1] || [];
}

export async function fetchArticle(title) {
  const url = `${API}?action=query&format=json&origin=*&prop=extracts&explaintext=1&exsectionformat=wiki&redirects=1&titles=${encodeURIComponent(title)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Wikipedia returned ${res.status}`);
  const data = await res.json();
  const page = Object.values(data?.query?.pages || {})[0];
  if (!page || page.missing !== undefined || !page.extract) {
    throw new Error(`No Wikipedia article called “${title}”.`);
  }
  return { title: page.title, url: articleUrl(page.title), extract: page.extract };
}

// ---- Chunking -------------------------------------------------------------

const clean = (t) => t.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+\n/g, '\n').trim();

/** Split a plain-text extract into top-level sections. Subsections fold into their parent. */
function splitSections(extract) {
  const sections = [{ heading: 'Overview', lines: [] }];
  let dropping = false;
  for (const line of extract.split('\n')) {
    const h = line.match(/^(={2,})\s*(.+?)\s*\1\s*$/);
    if (h) {
      const level = h[1].length;
      const name = h[2];
      if (level === 2) {
        dropping = DROP.has(name.toLowerCase());
        if (!dropping) sections.push({ heading: name, lines: [] });
      } else if (!dropping && DROP.has(name.toLowerCase())) {
        // drop "=== Gallery ===" etc. inside a kept section until the next heading
        sections.at(-1).skipSub = true;
      } else {
        sections.at(-1).skipSub = false;
      }
      continue;
    }
    if (dropping || sections.at(-1).skipSub) continue;
    sections.at(-1).lines.push(line);
  }
  return sections
    .map((s) => ({ heading: s.heading, full: clean(s.lines.join('\n')) }))
    .filter((s) => s.full.length > 40);
}

/** Keep the first sentences of a section, up to roughly `budget` characters. */
// Abbreviations whose dots must not end a sentence ("i.e.", "c. 1500", "J. Smith").
const ABBR = /\b(i\.e|e\.g|etc|vs|ca|c|approx|St|Dr|Mr|Mrs|Ms|Jr|Sr|No|U\.S|U\.K|[A-Z])\./g;
const DOT = '․';

export function trimText(text, budget) {
  if (text.length <= budget * 1.15) return { text, trimmed: false };
  const safe = text.replace(ABBR, (m) => m.replace(/\./g, DOT));
  const out = trimSentences(safe, budget);
  return { text: out.replaceAll(DOT, '.'), trimmed: true };
}

function trimSentences(text, budget) {
  const paras = text.split(/\n+/).filter(Boolean);
  const out = [];
  let used = 0;
  outer: for (const p of paras) {
    const sentences = p.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) || [p];
    let para = '';
    for (const s of sentences) {
      if (used + s.length > budget && used > 0) {
        if (para) out.push(para.trim());
        break outer;
      }
      para += s;
      used += s.length;
    }
    out.push(para.trim());
  }
  return out.join('\n\n');
}

/** Split one long section into paragraph groups of roughly `target` characters. */
function splitLong(section, target) {
  const paras = section.full.split(/\n+/).filter(Boolean);
  const pieces = [];
  let cur = [];
  let len = 0;
  for (const p of paras) {
    if (cur.length && len + p.length > target * 1.2) {
      pieces.push(cur.join('\n'));
      cur = [];
      len = 0;
    }
    cur.push(p);
    len += p.length;
  }
  if (cur.length) pieces.push(cur.join('\n'));
  return pieces.map((full, k) => ({ heading: section.heading, section: section.heading, piece: k, pieces: pieces.length, full }));
}

/**
 * Turn an extract into palace chunks, one per room slot.
 * - drop non-content sections (references, see also, ...)
 * - default mode: merge short sections, then trim long ones to their first
 *   sentences (the full text stays one click away)
 * - `complete: true` (used for the user study): never trim. Long sections are
 *   split by paragraph instead, so every sentence of the article is in the palace
 *   and both study conditions read exactly the same text.
 * - finally merge the smallest neighbours until at most `maxChunks` remain
 */
export function chunkArticle(extract, { maxChunks = 8, minChars = 400, budget = 700, complete = false } = {}) {
  const sections = splitSections(extract).map((s) => ({ ...s, section: s.heading, piece: 0, pieces: 1 }));
  let groups;
  if (complete) {
    const total = sections.reduce((n, s) => n + s.full.length, 0);
    const target = Math.ceil(total / maxChunks);
    groups = sections.flatMap((s) => (s.full.length > target * 1.3 ? splitLong(s, target) : [s])).map((s) => [s]);
  } else {
    groups = sections.map((s) => [s]);
  }
  const size = (g) => g.reduce((n, s) => n + s.full.length, 0);

  // merge short groups into the previous one (or the next one for the first)
  for (let i = 0; i < groups.length; i++) {
    if (groups.length <= 1) break;
    if (size(groups[i]) < minChars) {
      if (i > 0) { groups[i - 1].push(...groups[i]); groups.splice(i, 1); i--; }
      else { groups[1].unshift(...groups[0]); groups.splice(0, 1); i--; }
    }
  }

  // limit to the number of slots in the room
  while (groups.length > maxChunks) {
    let best = 1;
    let bestSize = Infinity;
    for (let i = 1; i < groups.length; i++) {
      const s = size(groups[i - 1]) + size(groups[i]);
      if (s < bestSize) { bestSize = s; best = i; }
    }
    groups[best - 1].push(...groups[best]);
    groups.splice(best, 1);
  }

  return groups.map((g, i) => {
    const per = Math.max(260, Math.round(budget / g.length));
    // consecutive pieces of the same section become one part
    const merged = [];
    for (const s of g) {
      const last = merged.at(-1);
      if (last && last.section === s.section) { last.full += `\n${s.full}`; last.lastPiece = s.piece; }
      else merged.push({ ...s, firstPiece: s.piece, lastPiece: s.piece });
    }
    const parts = merged.map((s) => {
      const t = complete ? { text: s.full, trimmed: false } : trimText(s.full, per);
      const continued = s.firstPiece > 0;
      return { heading: continued ? `${s.section} (continued)` : s.section, section: s.section, text: t.text, full: s.full, trimmed: t.trimmed };
    });
    return { id: `c${i}`, heading: parts.map((p) => p.heading).join(' · '), parts };
  });
}

export const chunkPlainText = (chunk) =>
  chunk.parts.map((p) => `${p.heading} ${p.full}`).join(' ');
