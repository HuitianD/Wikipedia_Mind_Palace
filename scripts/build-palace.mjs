// Offline build script (proposal: "a build script we run offline to turn a
// Wikipedia article into a palace file"). Fetches the article, chunks it, asks
// Claude for the theme and object suggestions once, and writes
// data/palaces/<slug>.json. Everyone who opens that article then gets exactly the
// same chunks, setting and suggestions, with no waiting for Claude.
//
// Every file in data/palaces/ is listed in data/palaces/index.json, which the app
// reads: an article listed there opens ready-made (see js/main.js).
//
//   npm run build-palace -- "Chasse-galerie"               study article: complete text, nothing trimmed
//   npm run build-palace -- "Solar System" --explore       ready-made article for Explore mode: long
//                                                          sections trimmed, as when built live
//   npm run build-palace -- "Honey bee" --explore --from data/sample-honey-bee.json
//                                                          use a saved extract instead of fetching
//   npm run build-palace -- "Chasse-galerie" --keywords    no API call; keyword suggestions
//   npm run build-palace -- --index                        only rewrite index.json
// An existing file is never overwritten without --force (the study file must not change
// once the study has started).
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchArticle, chunkArticle } from '../js/wiki.js';
import { pickTheme, suggestObjects, explain } from '../js/mapper.js';
import { suggestWithClaude, describeError } from '../lib/palace-ai.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const fromAt = args.indexOf('--from');
const from = fromAt >= 0 ? args[fromAt + 1] : null;
const title = args.find((a, i) => !a.startsWith('--') && (fromAt < 0 || i !== fromAt + 1));
const keywordsOnly = args.includes('--keywords');
const explore = args.includes('--explore');
const dir = path.join(root, 'data', 'palaces');

/** List every palace file so the app knows which articles are ready-made. */
async function writeIndex() {
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.json') && f !== 'index.json').sort();
  // The study's article (data/study.json) is not offered as a ready-made palace:
  // participants must not be able to read it in the Demo before or between their sessions.
  const study = JSON.parse(await fs.readFile(path.join(root, 'data/study.json'), 'utf8').catch(() => '{}'));
  const studyFiles = new Set((study.articles || []).map((a) => a.palace));
  const list = [];
  for (const f of files) {
    if (studyFiles.has(`data/palaces/${f}`)) continue;
    const p = JSON.parse(await fs.readFile(path.join(dir, f), 'utf8'));
    list.push({ title: p.title, file: `data/palaces/${f}`, theme: p.theme, stops: p.chunks.length });
  }
  list.sort((a, b) => a.title.localeCompare(b.title));
  await fs.writeFile(path.join(dir, 'index.json'), `${JSON.stringify(list, null, 2)}\n`);
  console.log(`index.json lists ${list.length} ready-made article${list.length === 1 ? '' : 's'}`);
}

if (args.includes('--index')) {
  await writeIndex();
  process.exit(0);
}
if (!title) {
  console.error('Usage: npm run build-palace -- "<Wikipedia title>" [--explore] [--from file.json] [--keywords] [--force]');
  process.exit(1);
}

const slug = (t) => t.toLowerCase().normalize('NFKD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '');

const article = from ? JSON.parse(await fs.readFile(path.resolve(root, from), 'utf8')) : await fetchArticle(title);
const out = path.join(dir, `${slug(article.title)}.json`);
if (!args.includes('--force') && await fs.access(out).then(() => true, () => false)) {
  console.error(`${path.relative(root, out)} already exists. Pass --force to replace it (never for the study article once the study has started).`);
  process.exit(1);
}
const chunks = chunkArticle(article.extract, explore ? {} : { complete: true });
console.log(`${article.title}: ${chunks.length} stops (${explore ? 'trimmed for Explore mode' : 'complete text'})`);

let theme;
let themeReason = null;
let suggestedBy;
let perChunk;
if (keywordsOnly) {
  theme = pickTheme(chunks);
  suggestedBy = { source: 'keywords', at: new Date().toISOString() };
  const used = new Set();
  perChunk = chunks.map((c) => {
    const s = suggestObjects(c, used);
    used.add(s[0].id);
    return s.map((m) => ({ id: m.id, why: `matches: ${explain(m)}` }));
  });
} else {
  try {
    const out = await suggestWithClaude({
      title: article.title,
      chunks: chunks.map((c) => ({ heading: c.heading, text: c.parts.map((p) => `${p.heading}\n${p.full}`).join('\n\n') })),
    });
    theme = out.theme;
    themeReason = out.themeReason;
    suggestedBy = { source: 'claude', model: out.model, at: new Date().toISOString() };
    perChunk = out.chunks.map((c) => c.suggestions);
    console.log(`Claude (${out.model}) picked theme "${theme}": ${themeReason}`);
    console.log(`tokens: ${out.usage.input_tokens} in / ${out.usage.output_tokens} out`);
  } catch (err) {
    console.error(`Claude call failed: ${describeError(err).error}`);
    console.error('Set ANTHROPIC_API_KEY (e.g. in .env, then run with node --env-file=.env), or pass --keywords.');
    process.exit(1);
  }
}

const palace = {
  format: 'wikipedia-mind-palace',
  version: 2,
  title: article.title,
  url: article.url,
  retrieved: article.retrieved || new Date().toISOString().slice(0, 10),
  license: 'Article text from Wikipedia, CC BY-SA 4.0',
  theme,
  themeReason,
  suggestedBy,
  createdAt: new Date().toISOString(),
  chunks: chunks.map((c, i) => ({ ...c, suggestions: perChunk[i], objectId: null })),
  recallSessions: [],
};

await fs.mkdir(dir, { recursive: true });
await fs.writeFile(out, `${JSON.stringify(palace, null, 2)}\n`);
console.log(`wrote ${path.relative(root, out)}`);
await writeIndex();
for (const [i, c] of palace.chunks.entries()) {
  console.log(`  ${i + 1}. ${c.heading}\n     ${c.suggestions.map((s) => `${s.id} (${s.why})`).join('\n     ')}`);
}
