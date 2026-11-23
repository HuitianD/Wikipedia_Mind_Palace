import { Room } from './room.js';
import { parseTitle, searchTitles, fetchArticle, chunkArticle } from './wiki.js';
import { THEMES, pickTheme, suggestObjects, explain } from './mapper.js';
import { OBJECTS, OBJECT_BY_ID } from './catalog.js';
import { study, bootStudy, log as studyLog, saveStudy, finishEarly } from './study.js';
import { findAnchors } from './anchors.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const paras = (t) => t.split(/\n+/).filter(Boolean).map((p) => `<p>${esc(p)}</p>`).join('');
const STORE_KEY = 'wmp.palace.v1';

// The three modes of the site, chosen by the address:
//   demo    (/)          the ready-made palaces only. No Claude, so it can be public.
//   explore (/?explore)  a palace for any Wikipedia article, with Claude. Only where the app
//                        runs on your own computer; the deployed site does not offer it
//                        (api/suggest.js). /?article=… also lands here.
//   study   (/?study)    the timed user-study session, with its own sign-in (js/study.js).
const params = new URLSearchParams(location.search);
const MODE = params.has('study') ? 'study' : params.has('explore') || params.has('article') ? 'explore' : 'demo';

const room = new Room($('#scene'));
room.setTheme(THEMES.library);
room.onPick = (i) => onPick(i);
window.mindPalaceRoom = room; // for debugging in the console

let palace = null;
let view = { mode: 'landing' };
const inStudy = () => !!study.session;

// ---- persistence --------------------------------------------------------------

function save() {
  if (inStudy()) { saveStudy(palace); return; }
  try { localStorage.setItem(STORE_KEY, JSON.stringify(palace)); } catch { /* private mode etc. */ }
}
function loadSaved() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)); } catch { return null; }
}

// ---- small UI helpers --------------------------------------------------------------

const panel = $('#panel');

function openPanel(html) {
  panel.innerHTML = html;
  panel.hidden = false;
  panel.scrollTop = 0;
  const wide = window.innerWidth >= 760;
  const r = panel.getBoundingClientRect();
  room.setInset(wide ? Math.round(r.width + 24) : 0, wide ? 0 : Math.round(r.height + 8));
}
function closePanel() {
  panel.hidden = true;
  room.setInset(0, 0);
}
window.addEventListener('resize', () => { if (!panel.hidden) openPanel(panel.innerHTML); });

let toastTimer = null;
function toast(msg, ms = 5000) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

/** A paragraph with some sentences wrapped so they can light up. marks: [{ sentence, ks }] */
function markedPara(p, marks) {
  const spans = marks.map((m) => ({ ...m, at: p.indexOf(m.sentence) })).filter((m) => m.at >= 0).sort((a, b) => a.at - b.at);
  let html = '';
  let pos = 0;
  for (const m of spans) {
    if (m.at < pos) continue;
    html += `${esc(p.slice(pos, m.at))}<span class="anchor" data-a="${m.ks.join(' ')}">${esc(m.sentence)}</span>`;
    pos = m.at + m.sentence.length;
  }
  return `<p>${html}${esc(p.slice(pos))}</p>`;
}

function chunkHtml(chunk, expanded, marks = []) {
  let lastSection = null;
  const body = chunk.parts.map((p) => {
    const showHead = chunk.parts.length > 1 && p.heading !== lastSection;
    lastSection = p.heading;
    const text = (expanded ? p.full : p.text).split(/\n+/).filter(Boolean).map((para) => markedPara(para, marks)).join('');
    return `${showHead ? `<h4>${esc(p.heading)}</h4>` : ''}${text}`;
  }).join('');
  const more = chunk.parts.some((p) => p.trimmed)
    ? `<button class="link" data-act="expand">${expanded ? 'Show the short version' : 'Read the full section'}</button>`
    : '';
  return `<div class="article">${body}</div>${more}`;
}

const dots = (cur) => `<div class="dots">${palace.chunks.map((c, i) =>
  `<button class="dot ${i === cur ? 'cur' : ''} ${c.objectId ? 'done' : ''}" data-go="${i}" aria-label="Stop ${i + 1}">${c.objectId ? OBJECT_BY_ID[c.objectId].icon : i + 1}</button>`).join('')}</div>`;

// In the study the participant must not leave the page, so no outbound link.
const attribution = () => (inStudy()
  ? '<p class="attrib">Text from Wikipedia, CC BY-SA 4.0.</p>'
  : `<p class="attrib">Text from <a href="${esc(palace.url)}" target="_blank" rel="noopener">Wikipedia</a>, CC BY-SA 4.0.</p>`);

// ---- top bar + hint ---------------------------------------------------------------

function renderTopbar() {
  const bar = $('#topbar');
  if (!palace || view.mode === 'landing') { bar.hidden = true; return; }
  bar.hidden = false;
  const placed = palace.chunks.filter((c) => c.objectId).length;
  const total = palace.chunks.length;
  const complete = placed === total;
  const modeButtons = complete ? `
    <button data-top="tour" class="${view.mode === 'read' ? 'on' : ''}">Guided tour</button>
    <button data-top="walk" class="${view.mode === 'walk' ? 'on' : ''}">Free walk</button>` : `
    <button data-top="build" class="on">Placing objects</button>`;

  if (inStudy()) {
    bar.innerHTML = `
      <div class="brand">🏛️ <span>Mind Palace</span></div>
      <div class="title"><span class="title-text">${esc(palace.title)}</span>
        <span class="meta">${complete ? `${total} stops` : `${placed}/${total} objects placed`}</span></div>
      <span class="study-timer" title="Reading time left"></span>
      <nav>${modeButtons}<button data-top="finish">I'm done</button></nav>`;
    return;
  }

  const themeOptions = Object.entries(THEMES).map(([id, t]) =>
    `<option value="${id}" ${id === palace.theme ? 'selected' : ''}>${esc(t.name)}</option>`).join('');
  bar.innerHTML = `
    <div class="brand">🏛️ <span>Mind Palace</span></div>
    <div class="title"><a href="${esc(palace.url)}" target="_blank" rel="noopener">${esc(palace.title)}</a>
      <span class="meta">${complete ? `${total} stops` : `${placed}/${total} objects placed`}</span></div>
    <label class="theme" title="${esc(palace.themeReason || '')}">Setting <select id="theme-select">${themeOptions}</select></label>
    <nav>
      ${modeButtons}
      ${complete ? `<button data-top="recall" class="${view.mode === 'recall' ? 'on' : ''}">Recall test</button>` : ''}
      <button data-top="export" title="Download the palace file">Export</button>
      <button data-top="new" title="Start over with another article">New</button>
    </nav>`;
}

$('#topbar').addEventListener('click', (e) => {
  const act = e.target.closest('[data-top]')?.dataset.top;
  if (act === 'tour') showRead(0);
  if (act === 'walk') showWalk();
  if (act === 'recall') startRecall();
  if (act === 'build') goBuild(view.index ?? 0);
  if (act === 'export') exportPalace();
  if (act === 'new') showLanding();
  if (act === 'finish') finishEarly();
});
$('#topbar').addEventListener('change', (e) => {
  if (e.target.id !== 'theme-select') return;
  palace.theme = e.target.value;
  palace.themeReason = null;
  room.setTheme(THEMES[palace.theme]);
  room.setPathVisible(true);
  // the stops moved with the building: point the camera at the right place again
  if (view.mode === 'build') { syncCandidates(); room.focusSlot(view.index, undefined, true); }
  else if (view.mode === 'read' || view.mode === 'recall') room.focusSlot(view.index);
  else if (view.mode === 'walk') room.entrance();
  else room.overview();
  save();
});

function setHint(text) {
  const h = $('#hint');
  h.hidden = !text;
  h.textContent = text || '';
}

// ---- landing ------------------------------------------------------------------------

function showLanding() {
  hideCandidates();
  view = { mode: 'landing' };
  room.mode = 'landing';
  room.setSlotCount(0);
  room.setTheme(THEMES.library);
  room.setPathVisible(true);
  room.entrance(1.2);
  closePanel();
  setHint('');
  renderTopbar();
  $('#landing').hidden = false;
  const saved = loadSaved();
  const resume = $('#resume');
  resume.hidden = !saved?.chunks?.length;
  if (saved?.title) resume.textContent = `Resume “${saved.title}”`;
  renderLandingMode();
  if (!$('#search-form').hidden) $('#q').focus();
}

/** Show the parts of the start page that belong to this mode, and to what this server offers. */
function renderLandingMode() {
  const explore = MODE === 'explore' && site.known && site.explore;
  $('#mode-explore').hidden = !(site.known && site.explore); // no Explore tab on the deployed site
  for (const [id, on] of [['#mode-demo', !explore], ['#mode-explore', explore]]) {
    $(id).classList.toggle('on', on);
    if (on) $(id).setAttribute('aria-current', 'page'); else $(id).removeAttribute('aria-current');
  }
  const note = $('#explore-note');
  note.hidden = true;
  if (MODE === 'explore' && site.known && !site.explore) {
    note.textContent = 'Building a palace for a new article is only available when the app runs on your own computer. Here you can try the ready-made palaces.';
    note.hidden = false;
  } else if (explore && !site.claude) {
    note.textContent = 'No Claude API key on this server: the setting and objects are matched by keywords.';
    note.hidden = false;
  }
  $('#landing-lead').textContent = explore
    ? 'Turn any Wikipedia article into a room. Claude suggests the setting and an object for each section; you choose, and retrace the path later to remember it.'
    : 'Turn a Wikipedia article into a room. Each section becomes an object you choose, placed along a path. Retrace the path later to remember it. Pick an article below to try it.';
  $('#search-form').hidden = !explore;
  $('#open-file').hidden = !explore;
  $('#ready-title').textContent = explore ? 'Or a ready-made palace' : 'Ready-made palaces';
  document.querySelector('.alt').hidden = $('#resume').hidden && $('#open-file').hidden;
}

function showError(msg) {
  const el = $('#landing-error');
  el.textContent = msg;
  el.hidden = !msg;
}

function setLoading(msg) {
  $('#loading').hidden = !msg;
  $('#loading-text').textContent = msg || '';
}

/** Ask the server (api/suggest.js) for Claude's theme + object suggestions. */
async function requestClaude(title, chunks) {
  const res = await fetch('api/suggest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title,
      chunks: chunks.map((c) => ({ heading: c.heading, text: c.parts.map((p) => `${p.heading}\n${p.full}`).join('\n\n') })),
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error || (res.status === 404 || res.status === 501 ? 'no AI server running' : `server returned ${res.status}`));
  }
  return res.json();
}

function keywordSuggestions(chunks) {
  const used = new Set();
  return chunks.map((c) => {
    const s = suggestObjects(c, used);
    used.add(s[0].id);
    return s.map((m) => ({ id: m.id, why: `matches: ${explain(m)}` }));
  });
}

// What this server offers (GET api/suggest): Explore mode at all, and Claude for it.
// The deployed site answers explore: false. A plain file server has no such endpoint;
// Explore then works with keyword suggestions, which cost nothing.
const site = { known: false, explore: true, claude: false };
const siteReady = MODE === 'study' ? Promise.resolve() : fetch('api/suggest')
  .then((r) => (r.ok ? r.json() : null))
  .then((j) => { if (j) Object.assign(site, { explore: !!j.explore, claude: !!j.claude }); })
  .catch(() => {})
  .then(() => { site.known = true; if (view.mode === 'landing') renderLandingMode(); });

// ---- ready-made palaces ---------------------------------------------------------------
// Articles listed in data/palaces/index.json were built ahead of time
// (scripts/build-palace.mjs): their chunks, setting and object suggestions are fixed,
// so they open at once. Claude is only asked about articles that are not on the list.

let readyList = null;
const readyPalaces = () => (readyList ??= fetch('data/palaces/index.json', { cache: 'no-cache' })
  .then((r) => (r.ok ? r.json() : []))
  .then((list) => (Array.isArray(list) ? list : []))
  .catch(() => []));
const titleKey = (t) => String(t).toLowerCase().replace(/[_\s]+/g, ' ').trim();
const findReady = async (title) => (await readyPalaces()).find((p) => titleKey(p.title) === titleKey(title));

/** Open a ready-made palace as a fresh copy (nothing placed yet). False if it could not be loaded. */
async function openReady(entry) {
  try {
    const res = await fetch(entry.file, { cache: 'no-cache' });
    if (!res.ok) return false;
    const p = await res.json();
    if (!Array.isArray(p.chunks) || !p.chunks.length || !THEMES[p.theme]) return false;
    p.chunks.forEach((c) => { c.objectId = null; });
    loadPalace({ ...p, ready: true, createdAt: new Date().toISOString(), recallSessions: [] });
    return true;
  } catch {
    return false;
  }
}

async function buildFromArticle(getArticle) {
  showError('');
  setLoading('Reading the article…');
  try {
    const article = await getArticle();
    // a redirect ("Honeybee" → "Honey bee") may land on a ready-made article
    const ready = await findReady(article.title);
    if (ready && await openReady(ready)) return;
    setLoading('Breaking it into chunks…');
    const chunks = chunkArticle(article.extract);
    if (!chunks.length) throw new Error('That article has no readable sections.');

    await siteReady;
    setLoading(site.claude ? 'Asking Claude to pick a theme and objects…' : 'Matching objects to each section…');
    let theme;
    let themeReason = null;
    let perChunk;
    let suggestedBy;
    try {
      if (!site.claude) throw new Error('no Claude API key on this server');
      const ai = await requestClaude(article.title, chunks);
      theme = ai.theme;
      themeReason = ai.themeReason;
      perChunk = ai.chunks.map((c) => c.suggestions);
      suggestedBy = { source: 'claude', model: ai.model, at: new Date().toISOString() };
    } catch (err) {
      theme = pickTheme(chunks);
      perChunk = keywordSuggestions(chunks);
      suggestedBy = { source: 'keywords', at: new Date().toISOString(), note: err.message };
      toast(`Claude suggestions unavailable (${err.message.replace(/\.$/, '')}). Using keyword suggestions instead.`);
    }

    loadPalace({
      format: 'wikipedia-mind-palace',
      version: 2,
      title: article.title,
      url: article.url,
      theme,
      themeReason,
      suggestedBy,
      createdAt: new Date().toISOString(),
      chunks: chunks.map((c, i) => ({ ...c, suggestions: perChunk[i], objectId: null })),
      recallSessions: [],
    });
  } catch (err) {
    showError(err.message || String(err));
  } finally {
    setLoading('');
  }
}

const startFromTitle = async (input) => {
  const title = parseTitle(input);
  if (!title) return;
  showError('');
  const ready = await findReady(title);
  if (ready && await openReady(ready)) return;
  if (MODE !== 'explore') return showError('That palace could not be opened. Please try another one.');
  // anything that is not ready-made is built live, which the deployed site does not offer
  await siteReady;
  if (!site.explore) return showError(`“${title}” is not one of the ready-made palaces.`);
  buildFromArticle(() => fetchArticle(title));
};
const startSample = () => startFromTitle('Honey bee');

// the ready-made articles, as buttons on the landing page
readyPalaces().then((list) => {
  if (!list.length) return;
  $('#ready-list').innerHTML = list.map((p) =>
    `<button type="button" data-ready="${esc(p.title)}" title="${esc(THEMES[p.theme]?.name || '')}, ${p.stops} stops">${esc(p.title)}</button>`).join('');
  $('#ready').hidden = false;
});
$('#ready-list').addEventListener('click', (e) => {
  const t = e.target.closest('[data-ready]')?.dataset.ready;
  if (t) startFromTitle(t);
});

$('#search-form').addEventListener('submit', (e) => {
  e.preventDefault();
  $('#suggestions').hidden = true;
  startFromTitle($('#q').value);
});
$('#resume').addEventListener('click', () => { const p = loadSaved(); if (p) loadPalace(p); });
$('#open-file').addEventListener('click', () => $('#file-input').click());
$('#file-input').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const p = JSON.parse(await f.text());
    if (p.format !== 'wikipedia-mind-palace' || !Array.isArray(p.chunks)) throw new Error();
    loadPalace(p);
  } catch {
    showError('That file is not a Mind Palace file.');
  }
});

// search-as-you-type suggestions
let searchCtl = null;
let searchTimer = null;
$('#q').addEventListener('input', (e) => {
  const q = e.target.value.trim();
  clearTimeout(searchTimer);
  const list = $('#suggestions');
  if (q.length < 2 || /^https?:/.test(q)) { list.hidden = true; return; }
  searchTimer = setTimeout(async () => {
    searchCtl?.abort();
    searchCtl = new AbortController();
    try {
      const titles = await searchTitles(q, searchCtl.signal);
      list.innerHTML = titles.map((t) => `<li><button type="button" data-title="${esc(t)}">${esc(t)}</button></li>`).join('');
      list.hidden = !titles.length;
    } catch { /* aborted or offline */ }
  }, 220);
});
$('#suggestions').addEventListener('click', (e) => {
  const t = e.target.closest('[data-title]')?.dataset.title;
  if (!t) return;
  $('#q').value = t;
  $('#suggestions').hidden = true;
  startFromTitle(t);
});

// ---- palace -------------------------------------------------------------------------

/** Show the room for a palace without opening any text (used behind the study walkthrough). */
function previewPalace(p) {
  hideCandidates();
  palace = p;
  $('#landing').hidden = true;
  room.setTheme(THEMES[p.theme] || THEMES.library);
  room.setSlotCount(p.chunks.length);
  p.chunks.forEach((c, i) => room.placeObject(i, c.objectId, false));
  room.setPathVisible(true);
  room.mode = 'walk';
  room.overview(1.6);
  closePanel();
  setHint('');
}

function loadPalace(p) {
  previewPalace(p);
  palace.recallSessions ||= [];
  save();
  const next = p.chunks.findIndex((c) => !c.objectId);
  if (next === -1) showComplete();
  else goBuild(next);
}

const usedIds = (except) => new Set(palace.chunks.filter((c, i) => i !== except && c.objectId).map((c) => c.objectId));

function onPick(i) {
  if (view.mode === 'build') goBuild(i);
  else if (view.mode === 'walk' || view.mode === 'read' || view.mode === 'complete') showRead(i);
}

// ---- build: pick an object for each chunk ---------------------------------------------

/**
 * The 3–5 options shown for a stop: the stored suggestions (Claude's, or the
 * keyword matcher's) minus objects already used elsewhere, topped up from the
 * keyword ranking so there are always at least 3.
 */
function optionsFor(i) {
  const chunk = palace.chunks[i];
  const used = usedIds(i);
  const stored = (chunk.suggestions || []).filter((s) => s && typeof s === 'object' && OBJECT_BY_ID[s.id]);
  const opts = stored.filter((s) => !used.has(s.id)).map((s) => ({ id: s.id, why: s.why }));
  if (opts.length < 3) {
    const taken = new Set([...used, ...opts.map((o) => o.id)]);
    for (const m of suggestObjects(chunk, taken)) {
      if (opts.length >= 4) break;
      opts.push({ id: m.id, why: `matches: ${explain(m)}` });
    }
  }
  return opts.slice(0, 5);
}

// Claude sometimes starts a hook with the object's own name ("Chapel: …"); the
// name is already shown, so drop the repeat.
function tidyHook(o, why) {
  const m = why && why.match(/^([^:]{2,30}):\s+(.+)$/s);
  if (!m) return why;
  const [p, n] = [m[1].toLowerCase(), o.name.toLowerCase()];
  return n.startsWith(p) || p.startsWith(n) ? m[2][0].toUpperCase() + m[2].slice(1) : why;
}

// ---- candidates: the suggested objects floating around the current stop ----------------
// The 3D objects live in room.js. This side keeps their name labels on top of the
// canvas and links each one to the sentence of the text it stands for.

const labelLayer = $('#cand-labels');
let cands = [];       // [{ id, why, rank, name, icon }] in the order they sit on the ring
let labelEls = [];
let hotCand = null;
let hoverFromPanel = false;

/** The objects offered at stop i, minus the one already standing there. `rank` is the suggestion's place in the list. */
function candidatesFor(i) {
  const chunk = palace.chunks[i];
  return optionsFor(i)
    .map((o, k) => ({ ...o, rank: k + 1, name: OBJECT_BY_ID[o.id].name, icon: OBJECT_BY_ID[o.id].icon, why: tidyHook(OBJECT_BY_ID[o.id], o.why) }))
    .filter((o) => o.id !== chunk.objectId);
}

function syncCandidates() {
  if (view.mode !== 'build') return hideCandidates();
  // one is on its way down to this stop; onLanded brings the rest back
  if (room.cand?.landing && room.cand.slot === view.index) return;
  cands = candidatesFor(view.index);
  room.showCandidates(view.index, cands.map((c) => c.id));
  labelLayer.innerHTML = cands.map((c, k) =>
    `<div class="cand-label" data-k="${k}"><b>${esc(c.name)}</b><span>${esc(c.why || '')}</span></div>`).join('');
  labelEls = [...labelLayer.children];
  labelLayer.hidden = false;
  applyHot(room.cand?.hot ?? null);
}

function hideCandidates() {
  room.clearCandidates();
  cands = [];
  labelEls = [];
  hotCand = null;
  labelLayer.hidden = true;
  labelLayer.innerHTML = '';
}

/** Show which candidate is pointed at: its label opens, its sentence lights up in the text. */
function applyHot(k) {
  hotCand = k;
  labelEls.forEach((el, n) => {
    el.classList.toggle('hot', n === k);
    el.classList.toggle('cool', k !== null && n !== k);
  });
  panel.querySelectorAll('.chip').forEach((el) => el.classList.toggle('hot', Number(el.dataset.k) === k));
  let first = null;
  panel.querySelectorAll('.anchor').forEach((el) => {
    const on = k !== null && el.dataset.a.split(' ').includes(String(k));
    el.classList.toggle('on', on);
    if (on) first ||= el;
  });
  // bring the sentence into view, unless the pointer is in the panel (the text must not move under it)
  if (first && !hoverFromPanel) panel.scrollTo({ top: Math.max(0, first.offsetTop - panel.clientHeight / 3), behavior: 'smooth' });
}

room.onCandidateHover = (k) => applyHot(k);
room.onCandidatePick = (k) => { if (cands[k]) chooseObject(cands[k].id, cands[k].rank, 'room'); };
room.onCandidatesMove = (pts) => {
  for (const p of pts) {
    const el = labelEls[p.k];
    if (!el) continue;
    el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translateX(-50%)`;
    el.style.visibility = p.visible ? '' : 'hidden';
  }
};
room.onLanded = (slot) => {
  if (view.mode === 'build' && view.index === slot && !view.advancing) syncCandidates();
};

function goBuild(i, { keepCamera = false } = {}) {
  const prev = view;
  view = { mode: 'build', index: i, expanded: prev.mode === 'build' && prev.index === i ? prev.expanded : false, showAll: false };
  room.mode = 'build';
  setHint('Point at a floating object to see what it stands for · click it to place it · drag to look around');
  renderBuild();
  renderTopbar();
  if (!keepCamera) room.focusSlot(i, undefined, true);
  studyLog('stop_view', { stop: i + 1 });
}

function renderBuild() {
  const i = view.index;
  const chunk = palace.chunks[i];
  const used = usedIds(i);
  const list = candidatesFor(i);
  const choice = (o) => `
    <button class="choice" data-obj="${o.id}" data-rank="all">
      <span class="icon">${o.icon}</span>
      <span class="text"><span class="name">${esc(o.name)}</span></span>
    </button>`;
  const offered = new Set(list.map((c) => c.id));
  const others = OBJECTS.filter((o) => !used.has(o.id) && !offered.has(o.id) && o.id !== chunk.objectId);
  const here = chunk.objectId ? OBJECT_BY_ID[chunk.objectId] : null;
  const byClaude = palace.suggestedBy?.source === 'claude';

  // which sentence each candidate stands for (several can share one)
  const shown = chunk.parts.flatMap((p) => (view.expanded ? p.full : p.text).split(/\n+/).filter(Boolean));
  const bySentence = new Map();
  findAnchors(shown, list.map((c) => c.why)).forEach((sentence, k) => {
    if (!sentence) return;
    if (!bySentence.has(sentence)) bySentence.set(sentence, []);
    bySentence.get(sentence).push(k);
  });
  const marks = [...bySentence].map(([sentence, ks]) => ({ sentence, ks }));

  openPanel(`
    <div class="panel-head"><span class="step">Stop ${i + 1} of ${palace.chunks.length}</span></div>
    <h2>${esc(chunk.heading)}</h2>
    ${chunkHtml(chunk, view.expanded, marks)}
    <div class="picker">
      <div class="picker-title">Choose an object to hold this idea</div>
      ${here ? `<p class="placed"><span class="icon">${here.icon}</span> <b>${esc(here.name)}</b> stands at this stop. Pick another object to swap it.</p>` : ''}
      <p class="picker-sub">${list.length} objects are floating around stop ${i + 1} in the room. Point at one to see which part of the text it stands for, then click it to set it down. Pick the one that best reminds <em>you</em> of this section. ${byClaude
        ? 'Claude suggested them from the text; they are only ideas.'
        : 'They were matched to words in the text.'}</p>
      <div class="chips">${list.map((c, k) => `<button class="chip" data-obj="${c.id}" data-rank="${c.rank}" data-k="${k}">${c.icon} ${esc(c.name)}</button>`).join('')}</div>
      <button class="link" data-act="all">${view.showAll ? 'Hide other objects' : `Show all objects (${others.length} more)`}</button>
      ${view.showAll ? `<div class="choices grid">${others.map(choice).join('')}</div>` : ''}
    </div>
    <div class="nav">
      <button data-act="prev" ${i === 0 ? 'disabled' : ''}>← Back</button>
      ${dots(i)}
      <button data-act="next" ${i === palace.chunks.length - 1 && !isComplete() ? 'disabled' : ''}>${i === palace.chunks.length - 1 && isComplete() ? 'Finish' : 'Next →'}</button>
    </div>
    ${attribution()}`);
  syncCandidates();
}

const isComplete = () => palace.chunks.every((c) => c.objectId);

/** via: 'room' (clicked the floating object), 'list' (its name in the panel) or the full kit. */
function chooseObject(id, rank, via = 'list') {
  if (room.cand?.landing) return;   // one at a time
  const i = view.index;
  const chunk = palace.chunks[i];
  if (chunk.objectId === id) return;
  const first = !chunk.objectId;
  chunk.objectId = id;
  // an object that is floating by the stop flies down to it; one from the full kit just appears
  const k = cands.findIndex((c) => c.id === id);
  const flying = k !== -1 && room.landCandidate(k);
  if (flying) labelLayer.hidden = true;
  else room.placeObject(i, id);
  studyLog('object_choose', { stop: i + 1, objectId: id, rank: rank === 'all' ? null : Number(rank), fromAll: rank === 'all', via: rank === 'all' ? 'all' : via });
  save();
  view.advancing = first;
  renderBuild();
  renderTopbar();
  if (!first) return;
  const idx = view.index;
  setTimeout(() => {
    if (view.mode !== 'build' || view.index !== idx) return;
    const order = [...palace.chunks.keys()].map((n) => (idx + 1 + n) % palace.chunks.length);
    const next = order.find((n) => !palace.chunks[n].objectId);
    if (next === undefined) showComplete();
    else goBuild(next);
  }, flying ? 1900 : 900);
}

// ---- completed room --------------------------------------------------------------------

function showComplete() {
  hideCandidates();
  view = { mode: 'complete' };
  room.mode = 'walk';
  room.overview();
  setHint('Click any object to reread its section');
  renderTopbar();
  studyLog('room_complete');
  const list = palace.chunks.map((c, i) =>
    `<li><span class="icon">${OBJECT_BY_ID[c.objectId].icon}</span><span><b>${i + 1}.</b> ${esc(c.heading)}</span></li>`).join('');
  openPanel(`
    <div class="panel-head"><span class="step">Room complete</span></div>
    <h2>Your palace for “${esc(palace.title)}”</h2>
    <p class="lead">Follow the dotted path from the door: each stop holds one section. ${inStudy()
      ? 'You can keep rereading: take the guided tour or walk around and click objects.'
      : 'Later, retrace the path in your head and let each object bring back its idea.'}</p>
    <ol class="route">${list}</ol>
    <div class="actions">
      <button class="primary" data-act="tour">Take the guided tour</button>
      <button data-act="walk">Walk freely</button>
      ${inStudy() ? '' : '<button data-act="recall">Test my recall</button>'}
      <button data-act="edit">Change objects</button>
    </div>
    ${attribution()}`);
}

// ---- reading / guided tour ----------------------------------------------------------------

function showRead(i) {
  hideCandidates();
  view = { mode: 'read', index: i, expanded: view.mode === 'read' && view.index === i ? view.expanded : false };
  room.mode = 'walk';
  setHint('Drag to look · W A S D to walk · Esc to close');
  renderTopbar();
  const c = palace.chunks[i];
  const o = OBJECT_BY_ID[c.objectId];
  const last = i === palace.chunks.length - 1;
  openPanel(`
    <div class="panel-head"><span class="step">Stop ${i + 1} of ${palace.chunks.length} · ${o ? `${o.icon} ${esc(o.name)}` : ''}</span>
      <button class="close" data-act="close" aria-label="Close">✕</button></div>
    <h2>${esc(c.heading)}</h2>
    ${chunkHtml(c, view.expanded)}
    <div class="nav">
      <button data-act="prev" ${i === 0 ? 'disabled' : ''}>← Previous stop</button>
      ${dots(i)}
      <button data-act="${last ? 'end-tour' : 'next'}">${last ? 'End of path' : 'Next stop →'}</button>
    </div>
    ${attribution()}`);
  room.focusSlot(i);
  studyLog('reread', { stop: i + 1 });
}

function showWalk() {
  hideCandidates();
  view = { mode: 'walk' };
  room.mode = 'walk';
  closePanel();
  renderTopbar();
  room.entrance();
  setHint('Drag to look around · W A S D / arrows to walk · scroll to step · click an object to read it');
  studyLog('free_walk');
}

// ---- self-recall test (Explore only; the study has its own memory quiz in study.js) ----------

function startRecall() {
  if (inStudy()) return;
  hideCandidates();
  view = { mode: 'recall', index: 0, revealed: false, notes: [], ratings: [] };
  room.mode = 'walk';
  renderTopbar();
  renderRecall();
}

function renderRecall() {
  const i = view.index;
  if (i >= palace.chunks.length) return finishRecall();
  setHint('Look at the object. What did you put here?');
  const c = palace.chunks[i];
  const o = OBJECT_BY_ID[c.objectId];
  openPanel(`
    <div class="panel-head"><span class="step">Recall · stop ${i + 1} of ${palace.chunks.length}</span>
      <button class="close" data-act="quit-recall" aria-label="Stop the test">✕</button></div>
    <h2>${o.icon} The ${esc(o.name.toLowerCase())}</h2>
    <p class="lead">What section of the article lives here, and what did it say?</p>
    <textarea id="recall-note" rows="5" placeholder="Write everything you remember…" ${view.revealed ? 'readonly' : ''}>${esc(view.notes[i] || '')}</textarea>
    ${view.revealed ? `
      <div class="reveal">
        <div class="reveal-label">It was: <b>${esc(c.heading)}</b></div>
        ${chunkHtml(c, false)}
      </div>
      <div class="picker-title">How well did you remember it?</div>
      <div class="rate">
        <button data-rate="1">✅ Got it</button>
        <button data-rate="0.5">〰️ Partly</button>
        <button data-rate="0">❌ Missed</button>
      </div>` : `
      <div class="actions"><button class="primary" data-act="reveal">Reveal</button></div>`}
  `);
  room.focusSlot(i);
  if (!view.revealed) setTimeout(() => $('#recall-note')?.focus({ preventScroll: true }), 50);
}

function finishRecall() {
  const score = view.ratings.reduce((a, b) => a + b, 0);
  const total = palace.chunks.length;
  palace.recallSessions.push({ date: new Date().toISOString(), ratings: view.ratings, notes: view.notes });
  save();
  const rows = palace.chunks.map((c, i) => {
    const r = view.ratings[i];
    return `<li><span class="icon">${OBJECT_BY_ID[c.objectId].icon}</span><span>${esc(c.heading)}</span><span class="r">${r === 1 ? '✅' : r === 0.5 ? '〰️' : '❌'}</span></li>`;
  }).join('');
  view = { mode: 'complete' };
  room.overview();
  renderTopbar();
  setHint('');
  openPanel(`
    <div class="panel-head"><span class="step">Recall results</span></div>
    <h2>${score % 1 ? score.toFixed(1) : score} / ${total} recalled</h2>
    <p class="lead">Retake this later to see what stuck.${palace.recallSessions.length > 1 ? ` This is attempt ${palace.recallSessions.length}.` : ''}</p>
    <ol class="route results">${rows}</ol>
    <div class="actions">
      <button class="primary" data-act="recall">Try again</button>
      <button data-act="tour">Guided tour</button>
      <button data-act="export">Export results</button>
    </div>`);
}

// ---- panel events -----------------------------------------------------------------------------

panel.addEventListener('click', (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.dataset.obj) return chooseObject(t.dataset.obj, t.dataset.rank, 'list');
  if (t.dataset.go) {
    const i = Number(t.dataset.go);
    return view.mode === 'build' ? goBuild(i) : view.mode === 'recall' ? null : showRead(i);
  }
  if (t.dataset.rate) {
    view.ratings[view.index] = Number(t.dataset.rate);
    view.index += 1;
    view.revealed = false;
    return renderRecall();
  }
  const act = t.dataset.act;
  const n = palace?.chunks.length || 0;
  switch (act) {
    case 'expand':
      view.expanded = !view.expanded;
      return view.mode === 'build' ? renderBuild() : showRead(view.index);
    case 'all':
      view.showAll = !view.showAll;
      studyLog('show_all_objects', { stop: view.index + 1, open: view.showAll });
      return renderBuild();
    case 'prev':
      return view.mode === 'build' ? goBuild(view.index - 1) : showRead(view.index - 1);
    case 'next':
      if (view.mode === 'build') {
        if (view.index === n - 1) return isComplete() ? showComplete() : null;
        return goBuild(view.index + 1);
      }
      return showRead(view.index + 1);
    case 'end-tour':
      return showComplete();
    case 'close':
      return showWalk();
    case 'tour': return showRead(0);
    case 'walk': return showWalk();
    case 'recall': return startRecall();
    case 'edit': return goBuild(0);
    case 'export': return exportPalace();
    case 'reveal':
      view.notes[view.index] = $('#recall-note').value;
      view.revealed = true;
      return renderRecall();
    case 'quit-recall':
      return showComplete();
    default:
  }
});

// pointing at an object's name in the panel points at it in the room too
const chipHover = (e, on) => {
  const chip = e.target.closest?.('.chip');
  if (!chip) return;
  hoverFromPanel = true;
  room.setCandidateHover(on ? Number(chip.dataset.k) : null);
  hoverFromPanel = false;
};
panel.addEventListener('mouseover', (e) => chipHover(e, true));
panel.addEventListener('mouseout', (e) => chipHover(e, false));
panel.addEventListener('focusin', (e) => chipHover(e, true));
panel.addEventListener('focusout', (e) => chipHover(e, false));

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && view.mode === 'read') showWalk();
});

// ---- export ----------------------------------------------------------------------------------

function exportPalace() {
  const blob = new Blob([JSON.stringify(palace, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${palace.title.replace(/[^\w]+/g, '-').toLowerCase()}.palace.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---- boot ------------------------------------------------------------------------------------

if (MODE === 'study') {
  $('#landing').hidden = true;
  room.mode = 'landing';
  bootStudy({
    room,
    previewPalace,
    startPalace: (p) => loadPalace(p),
    getPalace: () => palace,
    lockPalace: () => { hideCandidates(); closePanel(); setHint(''); $('#topbar').hidden = true; room.mode = 'landing'; },
  }, params.get('study'));
} else {
  showLanding();
  if (params.get('article')) {
    $('#q').value = params.get('article');
    startFromTitle(params.get('article'));
  } else if (params.has('sample')) {
    startSample();
  }
}

