// Study mode (open index.html?study). Implements the procedure in "User Study Design":
//   researcher setup → participant sign-in → interface walkthrough → timed reading (15 min)
//   → memory quiz (10 min) → closed screen → two days later: the same quiz again (10 min)
// for two conditions that show exactly the same article text:
//   palace  – the Wikipedia Mind Palace (participant picks an object for each stop)
//   article – a plain Wikipedia-style page where the participant can highlight text
// Everything the participant does is logged with timestamps. The familiarity rating,
// and the follow-up questions stay outside the app.
//
// Where a session is kept:
//   online – when the server has a database (api/study, MongoDB). The participant opens
//            ?study on any computer and signs in; the server assigns the condition, keeps
//            the clock and stores the log. The research team reads it at ?study=admin.
//   local  – without a database, or at ?study=local. A researcher sets the session up
//            and the log stays in this browser, to be downloaded as JSON.
import { OBJECT_BY_ID } from './catalog.js';

const SESSION_KEY = 'wmp.study.session.v1';
const LOGS_KEY = 'wmp.study.logs.v1';
const ENDED_KEY = 'wmp.study.ended.v1'; // id of the session whose closed screen is showing
const TOKEN_KEY = 'wmp.study.token.v1'; // online: this browser's key to its session on the server
const ADMIN_KEY = 'wmp.study.admin'; // researcher key, kept for this tab only
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const study = { session: null };
let hooks = null;
let config = null;
let palaceData = null; // the pre-built palace for this session (fresh copy)
let tick = null;
let online = false; // the session lives on the server
let token = null;
let clockOffset = 0; // server clock minus this computer's clock
let entered = false; // the room or article is on screen

const store = {
  get(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } },
  set(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage full or blocked */ } },
  del(key) { try { localStorage.removeItem(key); } catch { /* ignore */ } },
};

const now = () => Date.now() + clockOffset;
const elapsed = () => (study.session?.startedAt ? now() - study.session.startedAt : 0);
const persist = () => (online ? queueSync() : store.set(SESSION_KEY, study.session));

// ---- talking to the server (online sessions) -------------------------------------

async function api(action, data = {}) {
  let res;
  try {
    res = await fetch('api/study', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...data }) });
  } catch {
    throw Object.assign(new Error('Could not reach the study server. Please check your internet connection.'), { status: 0 });
  }
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(out.error || `The study server answered with an error (${res.status}).`), { status: res.status });
  // reading time is measured on the server's clock
  if (out.session && typeof out.now === 'number') clockOffset = out.now - Date.now();
  return out;
}

/** What the server stores while reading: the log, the highlights and the object at each stop. */
function progress() {
  const s = study.session;
  return {
    events: s.events,
    highlights: s.highlights,
    choices: (s.palace || palaceData).chunks.map((c) => c.objectId ?? null),
  };
}

let syncTimer = null;
let syncing = false;
let dirty = false;

function queueSync(delay = 1500) {
  dirty = true;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncNow, delay);
}

async function syncNow() {
  const s = study.session;
  if (!online || !s?.startedAt || s.endedAt || syncing || !dirty) return;
  syncing = true;
  dirty = false;
  try {
    const r = await api('sync', { token, ...progress() });
    if (r.ended || r.expired) endSession('timeout'); // closed from another computer, or the time is over
  } catch {
    dirty = true; // keep it and try again
  }
  syncing = false;
  if (dirty && !study.session?.endedAt) queueSync(5000);
}

// last chance to save when the tab is closed or hidden
window.addEventListener('pagehide', () => {
  flushQuiz();
  const s = study.session;
  if (!online || !dirty || !s?.startedAt || s.endedAt) return;
  navigator.sendBeacon('api/study', new Blob([JSON.stringify({ action: 'sync', token, ...progress() })], { type: 'application/json' }));
});

/** Record one participant action. Times are ms since reading started. */
export function log(type, data = {}) {
  const s = study.session;
  if (!s?.startedAt || s.endedAt) return;
  s.events.push({ t: elapsed(), type, ...data });
  persist();
}

/** Called by main.js whenever the palace changes. */
export function saveStudy(palace) {
  if (!study.session) return;
  study.session.palace = palace;
  persist();
}

export function finishEarly() {
  if (!study.session?.startedAt || study.session.endedAt) return;
  const left = Math.max(0, study.session.readingMinutes * 60000 - elapsed());
  if (!window.confirm(`You still have ${fmt(left)} left. Are you sure you are done reading?`)) return;
  endSession('finished_early');
}

// ---- overlay helpers -----------------------------------------------------------

const overlay = () => $('#study-overlay');
function showOverlay(html, cls = '') {
  const o = overlay();
  o.className = cls;
  o.innerHTML = `<div class="study-card">${html}</div>`;
  o.hidden = false;
}
const hideOverlay = () => { overlay().hidden = true; };

function fmt(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const minutes = (n) => `${n} minute${n === 1 ? '' : 's'}`;

const download = (name, obj) => downloadText(name, JSON.stringify(obj, null, 2), 'application/json');

function downloadText(name, text, type) {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---- boot + researcher setup ----------------------------------------------------

export async function bootStudy(h, mode = '') {
  hooks = h;
  try {
    config = await (await fetch('data/study.json', { cache: 'no-cache' })).json();
  } catch {
    showOverlay('<h2>Study config missing</h2><p>Could not load <code>data/study.json</code>.</p>');
    return;
  }
  if (mode === 'admin') return showAdmin();
  if (mode !== 'local') {
    let status;
    try {
      status = await api('status');
    } catch (err) {
      // no /api at all (a plain file server): run in this browser only
      if (![404, 405, 501].includes(err.status)) return showProblem(err.message);
      status = { online: false };
    }
    if (status.online) {
      online = true;
      return bootOnline();
    }
  }
  const saved = store.get(SESSION_KEY);
  if (saved && !saved.endedAt) return resume(saved);
  // A reload after the session closed must not hand the participant the setup screen.
  const ended = (store.get(LOGS_KEY) || []).find((r) => r.id === store.get(ENDED_KEY));
  if (ended) return afterReading(ended);
  showSetup();
}

function showProblem(message) {
  showOverlay(`
    <div class="eyebrow">Study session</div>
    <h2>Something went wrong</h2>
    <p class="lead">${esc(message)}</p>
    <div class="actions"><button type="button" class="primary" id="retry">Try again</button></div>`, 'setup-overlay');
  $('#retry').onclick = () => location.reload();
}

// ---- online sessions ---------------------------------------------------------------

async function bootOnline() {
  token = store.get(TOKEN_KEY);
  if (token) {
    try {
      return await enterOnline(await api('resume', { token }));
    } catch (err) {
      if (err.status !== 401) return showProblem(err.message);
      store.del(TOKEN_KEY); // the session was removed on the server
      token = null;
    }
  }
  showSignIn();
}

/** Continue a session from what the server has: introduction, reading, or the closed screen. */
async function enterOnline(r, person = null, returning = false) {
  const sv = r.session;
  let p;
  try {
    p = await (await fetch(sv.article.file, { cache: 'no-cache' })).json();
  } catch {
    return showProblem('Could not load the article. Please check your internet connection.');
  }
  palaceData = structuredClone(p);
  palaceData.chunks.forEach((c, i) => { c.objectId = OBJECT_BY_ID[sv.choices[i]] ? sv.choices[i] : null; });
  const { choices, ...rest } = sv;
  study.session = { ...rest, person, palace: null, source: palaceData };
  const s = study.session;
  if (s.endedAt) return afterReading(s, { saved: true, returning });
  if (!s.startedAt) return showWalkthrough(0);
  if (elapsed() >= s.readingMinutes * 60000) return endSession('timeout');
  log('resume_after_reload');
  enterCondition();
}

// ---- local sessions: researcher setup -------------------------------------------------

function showSetup() {
  const logs = store.get(LOGS_KEY) || [];
  const nextId = `P${String(logs.length + 1).padStart(2, '0')}`;
  const articles = config.articles.map((a) => `<option value="${esc(a.id)}">${esc(a.title)}</option>`).join('');
  showOverlay(`
    <nav class="modes" aria-label="Mode">
      <a href="${esc(location.pathname)}" title="Build a palace for any Wikipedia article">Explore</a>
      <a class="on" href="${esc(location.pathname)}?study" aria-current="page">Study session</a>
    </nav>
    <div class="eyebrow">Researcher setup</div>
    <h2>New study session</h2>
    <p class="lead">A timed session for the user study: the participant signs in, reads for a fixed time, and then the page closes.</p>
    <form id="setup-form" class="setup">
      <label>Participant ID <input name="pid" required value="${nextId}" autocomplete="off"></label>
      <fieldset>
        <legend>Condition</legend>
        <label class="radio"><input type="radio" name="condition" value="palace" required> Wikipedia Mind Palace</label>
        <label class="radio"><input type="radio" name="condition" value="article"> Standard Wikipedia article</label>
        <button type="button" class="link" id="randomize">Assign at random</button>
      </fieldset>
      <label>Article <select name="article">${articles}</select></label>
      <label>Reading time (minutes) <input name="minutes" type="number" min="1" max="120" value="${config.readingMinutes}"></label>
      <div class="actions"><button class="primary" type="submit">Continue to sign-in</button></div>
    </form>
    <div class="setup-logs">
      <span>${logs.length} saved session log${logs.length === 1 ? '' : 's'} in this browser</span>
      ${logs.length ? '<button type="button" id="dl-all">Download all</button><button type="button" id="clear-logs">Clear</button>' : ''}
    </div>
    <p class="fine"><b>Sessions started here are saved in this browser only.</b> Hand the computer to the participant after pressing Continue: they sign in, see a short introduction, and the timer starts when they press Start reading. After reading they take the memory quiz here. The familiarity questions, the follow-up questions and the retake two days later are run outside this app in this mode.</p>
    <p class="fine"><a href="${esc(location.pathname)}?study=admin">Researcher page</a> (sessions saved to the database)</p>`,
  'setup-overlay');

  $('#randomize').onclick = () => {
    const pick = Math.random() < 0.5 ? 'palace' : 'article';
    document.querySelector(`input[name=condition][value=${pick}]`).checked = true;
  };
  $('#dl-all')?.addEventListener('click', () => download(`mind-palace-study-logs-${new Date().toISOString().slice(0, 10)}.json`, logs));
  $('#clear-logs')?.addEventListener('click', () => {
    if (!window.confirm(`Delete all ${logs.length} session logs from this browser? Download them first if you have not.`)) return;
    store.del(LOGS_KEY);
    showSetup();
  });
  $('#setup-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const article = config.articles.find((a) => a.id === f.get('article'));
    try {
      const p = await (await fetch(article.palace, { cache: 'no-cache' })).json();
      startSession({
        participant: String(f.get('pid')).trim(),
        condition: f.get('condition'),
        article: { id: article.id, title: p.title, url: p.url, file: article.palace },
        readingMinutes: Number(f.get('minutes')) || config.readingMinutes,
      }, p);
    } catch {
      window.alert(`Could not load ${article.palace}. Build it with: npm run build-palace -- "${article.title}"`);
    }
  };
}

function startSession(meta, p) {
  palaceData = structuredClone(p);
  palaceData.chunks.forEach((c) => { c.objectId = null; });
  study.session = {
    ...meta,
    id: `${meta.participant}-${meta.condition}-${now()}`,
    suggestedBy: p.suggestedBy || null,
    theme: p.theme,
    stops: p.chunks.length,
    createdAt: new Date().toISOString(),
    person: null, // filled in by the participant on the sign-in screen
    startedAt: null,
    endedAt: null,
    endReason: null,
    events: [],
    highlights: [],
    palace: null,
    source: palaceData,
  };
  persist();
  showSignIn();
}

// ---- participant sign-in -----------------------------------------------------------

function showSignIn() {
  const s = study.session; // null for an online sign-in: the server creates the session
  const mins = minutes(s ? s.readingMinutes : config.readingMinutes);
  showOverlay(`
    <div class="eyebrow">Study session</div>
    <h2>Before you start</h2>
    <p class="lead">Please tell us who you are. The research team uses this only to match your answers and to send you the follow-up quiz.</p>
    <form id="signin-form" class="setup">
      <label>Name <input name="name" required maxlength="80" autocomplete="name"></label>
      <label>Email <input name="email" type="email" required maxlength="120" autocomplete="email" placeholder="you@example.com"></label>
      <label>Age <input name="age" type="number" required min="1" max="120" step="1" inputmode="numeric"></label>
      <p class="error" id="signin-error" hidden></p>
      <div class="actions"><button class="primary" type="submit">Continue</button></div>
    </form>
    <p class="fine">The timer has not started yet. Next comes a short introduction; your ${mins} begin when you press <b>Start reading</b>.${s ? '' : ' You can take part once. If you were interrupted, sign in with the same email to pick up where you were; the clock keeps running while you are away.'}</p>
    ${s ? `<details class="researcher">
      <summary>Researcher</summary>
      <p>Session <b>${esc(s.participant)}</b> · ${s.condition === 'palace' ? 'Mind Palace' : 'Standard article'} · ${s.readingMinutes} min</p>
      <div class="actions"><button type="button" id="signin-cancel">Cancel and go back to setup</button></div>
    </details>` : `<p class="fine"><a href="${esc(location.pathname)}?study=admin">Research team</a></p>`}`, 'setup-overlay');
  $('#signin-form input[name=name]').focus();
  $('#signin-cancel')?.addEventListener('click', () => {
    store.del(SESSION_KEY);
    study.session = null;
    showSetup();
  });
  $('#signin-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const person = {
      name: String(f.get('name')).trim(),
      email: String(f.get('email')).trim(),
      age: Number(f.get('age')),
      signedInAt: new Date().toISOString(),
    };
    if (s) {
      s.person = person;
      persist();
      return showWalkthrough(0);
    }
    const button = e.target.querySelector('button[type=submit]');
    const error = $('#signin-error');
    button.disabled = true;
    error.hidden = true;
    try {
      const r = await api('signin', { name: person.name, email: person.email, age: person.age });
      token = r.token;
      store.set(TOKEN_KEY, token);
      await enterOnline(r, person, r.returning);
    } catch (err) {
      button.disabled = false;
      error.textContent = err.message;
      error.hidden = false;
    }
  };
}

// ---- walkthrough (procedure step 2) ------------------------------------------------

function walkthroughSteps() {
  const s = study.session;
  const mins = s.readingMinutes;
  if (s.condition === 'article') {
    return [
      { title: 'Read the article', body: `You will read the Wikipedia article <b>${esc(s.article.title)}</b>. Read it the way you normally would. Afterwards there will be questions about it.` },
      { title: 'Highlighting', body: 'You can highlight anything by selecting text with the mouse. Click a highlight to remove it.' },
      { title: `You have ${minutes(mins)}`, body: 'The timer starts when you press <b>Start reading</b>. When time is up the article will close. If you finish early, press <b>I\'m done</b>.' },
    ];
  }
  return [
    { title: 'This is your mind palace', body: `The article <b>${esc(s.article.title)}</b> has been split into <b>${s.stops} parts</b>. Each part belongs to one stop along the dotted path in this room, numbered from the door.` },
    { title: 'Read, then choose an object', body: 'At each stop, read the text on the right. A few objects float around the stop: point at one to see which part of the text it stands for, and click it to set it down. Choose the one that will remind you of what you just read. They are only ideas; pick whatever works for you, or open the full list.' },
    { title: 'Walk through your palace', body: 'Drag to look around and use W A S D (or the arrow keys) to walk. Click an object to reread its text. When every stop has an object you can take a guided tour along the path.' },
    { title: `You have ${minutes(mins)}`, body: 'The timer starts when you press <b>Start reading</b>. When time is up the room will close. If you finish early, press <b>I\'m done</b>.' },
  ];
}

function showWalkthrough(k) {
  const steps = walkthroughSteps();
  const s = study.session;
  if (s.condition === 'palace' && k === 0) hooks.previewPalace(palaceData);
  const step = steps[k];
  const last = k === steps.length - 1;
  showOverlay(`
    <div class="eyebrow">How it works · ${k + 1} of ${steps.length}</div>
    <h2>${step.title}</h2>
    <p class="lead">${step.body}</p>
    <div class="walk-dots">${steps.map((_, i) => `<span class="${i === k ? 'cur' : ''}"></span>`).join('')}</div>
    <p class="error" id="wt-error" hidden></p>
    <div class="actions">
      ${k > 0 ? '<button type="button" id="wt-back">Back</button>' : ''}
      <button type="button" class="primary" id="wt-next">${last ? 'Start reading' : 'Next'}</button>
    </div>`, `walkthrough-overlay ${s.condition}`);
  $('#wt-back')?.addEventListener('click', () => showWalkthrough(k - 1));
  $('#wt-next').addEventListener('click', () => (last ? beginReading() : showWalkthrough(k + 1)));
}

// ---- reading (procedure step 3) ----------------------------------------------------

async function beginReading() {
  const s = study.session;
  if (online) {
    // the server starts the clock; without it the session cannot begin
    const button = $('#wt-next');
    button.disabled = true;
    try {
      const r = await api('start', { token });
      s.startedAt = r.session.startedAt;
      s.events = r.session.events;
    } catch (err) {
      button.disabled = false;
      $('#wt-error').textContent = `${err.message} Your time has not started. Please try again.`;
      $('#wt-error').hidden = false;
      return;
    }
  } else {
    s.startedAt = now();
    s.events.push({ t: 0, type: 'start', condition: s.condition });
  }
  persist();
  hideOverlay();
  enterCondition();
}

function enterCondition() {
  const s = study.session;
  if (s.condition === 'palace') hooks.startPalace(s.palace || palaceData);
  else showReader();
  entered = true;
  startTimer();
}

function resume(saved) {
  study.session = saved;
  palaceData = saved.source;
  if (!saved.person) return showSignIn();
  if (!saved.startedAt) return showWalkthrough(0);
  if (elapsed() >= saved.readingMinutes * 60000) {
    // time ran out while the page was closed
    study.session.events.push({ t: elapsed(), type: 'resumed_after_timeout' });
    return endSession('timeout');
  }
  log('resume_after_reload');
  enterCondition();
}

function startTimer() {
  clearInterval(tick);
  const update = () => {
    const left = study.session.readingMinutes * 60000 - elapsed();
    document.querySelectorAll('.study-timer').forEach((el) => {
      el.textContent = `⏱ ${fmt(left)}`;
      el.classList.toggle('warn', left <= 60000);
    });
    if (left <= 0) endSession('timeout');
  };
  update();
  tick = setInterval(update, 500);
}

// ---- end of reading -----------------------------------------------------------------

function summarize(s) {
  // time spent on each stop / section, from the view events
  const views = s.events.filter((e) => ['stop_view', 'reread'].includes(e.type));
  const leave = s.events.filter((e) => ['free_walk', 'room_complete', 'end'].includes(e.type)).map((e) => e.t);
  const perStop = {};
  views.forEach((v, i) => {
    const next = Math.min(views[i + 1]?.t ?? Infinity, ...leave.filter((t) => t > v.t), s.endedAtMs);
    perStop[v.stop] = (perStop[v.stop] || 0) + Math.max(0, next - v.t);
  });
  const out = {
    readingMs: s.endedAtMs,
    endReason: s.endReason,
    secondsPerStop: Object.fromEntries(Object.entries(perStop).map(([k, v]) => [k, Math.round(v / 1000)])),
  };
  if (s.condition === 'palace' && s.palace) {
    out.objects = s.palace.chunks.map((c, i) => {
      const choice = [...s.events].reverse().find((e) => e.type === 'object_choose' && e.stop === i + 1);
      return { stop: i + 1, heading: c.heading, objectId: c.objectId, objectName: OBJECT_BY_ID[c.objectId]?.name ?? null, suggestionRank: choice?.rank ?? null, fromFullList: choice?.fromAll ?? null };
    });
    out.objectsPlaced = out.objects.filter((o) => o.objectId).length;
    out.objectChanges = s.events.filter((e) => e.type === 'object_choose').length - out.objectsPlaced;
  }
  if (s.condition === 'article') out.highlightCount = s.highlights.length;
  return out;
}

function endSession(reason) {
  const s = study.session;
  if (!s || s.endedAt) return;
  clearInterval(tick);
  clearTimeout(syncTimer);
  s.endedAtMs = Math.min(elapsed(), s.readingMinutes * 60000);
  s.events.push({ t: s.endedAtMs, type: 'end', reason });
  s.endedAt = new Date().toISOString();
  s.endReason = reason;
  if (s.condition === 'palace' && entered) s.palace = hooks.getPalace();
  s.summary = summarize(s);
  const record = { ...s };
  delete record.source; // the palace file is identical for everyone; keep logs small
  if (!online) {
    const logs = store.get(LOGS_KEY) || [];
    logs.push(record);
    store.set(LOGS_KEY, logs);
    store.del(SESSION_KEY);
    store.set(ENDED_KEY, record.id);
  }

  // take the material off the page, not just out of sight
  $('#reader').hidden = true;
  $('#reader').innerHTML = '';
  if (s.condition === 'palace') hooks.lockPalace();
  if (online) endSaved = sendEnd(reason);
  afterReading(record);
}

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
let endSaved = Promise.resolve(true); // online: whether the server has the finished reading session

/** Online: hand the finished reading to the server, and keep trying if the connection drops. */
async function sendEnd(reason) {
  const say = (text) => { if ($('#save-state')) $('#save-state').textContent = text; };
  for (let attempt = 0; attempt <= 40; attempt++) {
    try {
      await api('end', { token, reason, ...progress() });
      say('');
      return true;
    } catch (err) {
      if (err.status === 401 || err.status === 400) break;
      say('Saving your reading session… Please keep this page open.');
      await sleep(3000);
    }
  }
  say('Your session could not be saved. Please tell the research team.');
  return false;
}

// ---- memory quiz: after the reading has closed, and once more two days later -------------
// The same questions for both conditions, in two rounds:
//   quiz   – right after the reading, before the closed screen
//   retake – the same questions again once config.retakeAfterHours have passed (online only).
//            The participant opens the link again and signs in with the same email address;
//            the article stays closed.
// Online, the server hands the questions out only when a round may start, keeps the clock
// and stores the answers as they are typed. A session kept in this browser gets the
// questions from the local server and has no retake.

const QUIZ_UNAVAILABLE = [0, 403, 404, 405, 501, 503];
const ROUND = {
  quiz: { name: 'Memory quiz', title: 'What do you remember?' },
  retake: { name: 'Follow-up quiz', title: 'What do you still remember?' },
};
let quizState = null; // { record, round, answers, dirty } while a quiz is on screen
let quizTick = null;
let quizSaveTimer = null;

/** Write a finished local session back into this browser's logs. */
function saveLocalRecord(record) {
  const logs = store.get(LOGS_KEY) || [];
  const i = logs.findIndex((r) => r.id === record.id);
  if (i >= 0) logs[i] = record; else logs.push(record);
  store.set(LOGS_KEY, logs);
}

/** Online: take over what the server says about both rounds. */
const takeRounds = (record, sv) => Object.assign(record, { quiz: sv.quiz, retake: sv.retake, retakeOpensAt: sv.retakeOpensAt });

const quizBackend = {
  /** Start (or continue) a round; returns its questions. */
  async start(record, round) {
    if (online) {
      const r = await api('quiz_start', { token, round });
      takeRounds(record, r.session);
      return r.questions;
    }
    const r = await api('quiz_questions');
    record.quiz ||= { startedAt: Date.now(), startedAtIso: new Date().toISOString(), minutes: r.minutes, submittedAt: null, endReason: null, answers: {} };
    record.quiz.questions = r.questions;
    saveLocalRecord(record);
    return r.questions;
  },
  async save(record, round, answers) {
    if (online) return api('quiz_save', { token, round, answers });
    record[round].answers = answers;
    return saveLocalRecord(record);
  },
  async submit(record, round, answers, reason) {
    if (online) return takeRounds(record, (await api('quiz_submit', { token, round, answers, reason })).session);
    Object.assign(record[round], { answers, endReason: reason, submittedAt: new Date().toISOString() });
    return saveLocalRecord(record);
  },
};

/** Where a participant goes once the reading is closed: whichever quiz round is due, else the closed screen. */
function afterReading(record, opts = {}) {
  if (record.quizSkipped) return showEnd(record, opts);
  if (!record.quiz?.submittedAt) return record.quiz?.startedAt ? openQuiz(record, opts, 'quiz') : showQuizIntro(record, opts, 'quiz');
  if (!online || record.retakeOpensAt == null || record.retake?.submittedAt) return showEnd(record, opts);
  if (record.retake?.startedAt) return openQuiz(record, opts, 'retake'); // reloaded in the middle of it
  if (now() >= record.retakeOpensAt) return showQuizIntro(record, opts, 'retake');
  showEnd(record, opts); // the retake is not open yet
}

function showQuizIntro(record, opts = {}, round = 'quiz', problem = '') {
  const what = record.condition === 'palace' ? 'room' : 'article';
  const closed = record.endReason === 'timeout' ? `Your reading time is over and the ${what} is now closed.` : `Your reading session is closed, and so is the ${what}.`;
  const mins = Number(config.quizMinutes) > 0 ? Number(config.quizMinutes) : 0;
  const first = record.person?.name ? `, ${esc(record.person.name.split(/\s+/)[0])}` : '';
  const top = round === 'retake' ? `
    <div class="eyebrow">Follow-up quiz</div>
    <h2>Welcome back${first}</h2>
    <p class="lead">A couple of days ago you read an article here. Please answer the same questions once more. You will not see the ${what} again.</p>` : `
    <div class="eyebrow">${record.endReason === 'timeout' ? 'Time is up' : 'Reading finished'}</div>
    <h2>Next: a short memory quiz</h2>
    <p class="lead">${closed} Now please answer a few questions about what you read.</p>`;
  showOverlay(`${top}
    <ul class="quiz-rules">
      <li>Answer from memory. Please do not look anything up or ask anyone.</li>
      <li>${mins ? `You have up to ${minutes(mins)}. The timer starts when you press the button.` : 'There is no time limit.'}</li>
      <li>If you do not remember something, leave that answer empty.</li>
    </ul>
    ${problem ? `<p class="error" role="alert">${esc(problem)}</p>` : ''}
    <div class="actions"><button type="button" class="primary" id="quiz-start">Start the quiz</button></div>
    <p class="fine" id="save-state"></p>`, 'end-overlay');
  $('#quiz-start').onclick = (e) => {
    e.target.disabled = true;
    e.target.textContent = 'Loading…';
    openQuiz(record, opts, round);
  };
}

async function openQuiz(record, opts = {}, round = 'quiz') {
  let questions;
  try {
    if (online && !(await endSaved)) throw Object.assign(new Error('Your reading session could not be saved, so the quiz cannot start. Please tell the research team.'), { status: 409 });
    questions = await quizBackend.start(record, round);
  } catch (err) {
    if (!online && QUIZ_UNAVAILABLE.includes(err.status)) {
      // a session kept in this browser, on a server that cannot hand out the questions
      record.quizSkipped = 'not available on this server';
      saveLocalRecord(record);
      return showEnd(record, opts);
    }
    return showQuizIntro(record, opts, round, err.message);
  }
  const quiz = record[round];
  if (quiz.submittedAt) return afterReading(record, { saved: true });
  const limit = quiz.minutes > 0 ? quiz.minutes * 60000 : 0;
  const left = () => limit - (now() - quiz.startedAt);
  if (limit && left() <= 0) return submitQuiz(record, round, quiz.answers || {}, 'timeout'); // time ran out while the page was closed

  showOverlay(`
    <div class="quiz-head">
      <div class="eyebrow">${ROUND[round].name}</div>
      ${limit ? '<span class="study-timer" id="quiz-timer"></span>' : ''}
    </div>
    <h2>${ROUND[round].title}</h2>
    <p class="lead">Answer from memory, in a few words or a sentence. Leave an answer empty if you do not remember.</p>
    <form id="quiz-form" class="quiz" autocomplete="off">
      <ol>${questions.map((q) => `
        <li><label for="quiz-${esc(q.id)}">${esc(q.text)}</label>
          <textarea id="quiz-${esc(q.id)}" name="${esc(q.id)}" rows="2" maxlength="2000" spellcheck="false">${esc(quiz.answers?.[q.id] || '')}</textarea></li>`).join('')}
      </ol>
      <div class="actions"><button class="primary" type="submit">Submit my answers</button></div>
    </form>
    <p class="fine" id="quiz-state">Your answers are saved as you type.</p>`, 'end-overlay quiz-overlay');
  overlay().scrollTop = 0;

  const form = $('#quiz-form');
  const answers = () => Object.fromEntries(questions.map((q) => [q.id, form.elements[q.id].value]));
  quizState = { record, round, answers, dirty: false };
  form.addEventListener('input', () => {
    quizState.dirty = true;
    clearTimeout(quizSaveTimer);
    quizSaveTimer = setTimeout(saveQuizDraft, 2000);
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const empty = questions.filter((q) => !form.elements[q.id].value.trim()).length;
    if (empty && !window.confirm(`You left ${empty} answer${empty === 1 ? '' : 's'} empty. Submit anyway?`)) return;
    submitQuiz(record, round, answers(), 'submitted');
  });
  if (limit) {
    const update = () => {
      const ms = left();
      const el = $('#quiz-timer');
      if (el) { el.textContent = `⏱ ${fmt(ms)}`; el.classList.toggle('warn', ms <= 60000); }
      if (ms <= 0) submitQuiz(record, round, answers(), 'timeout');
    };
    clearInterval(quizTick);
    quizTick = setInterval(update, 500);
    update();
  }
  form.querySelector('textarea')?.focus({ preventScroll: true });
}

async function saveQuizDraft() {
  const q = quizState;
  if (!q?.dirty) return;
  q.dirty = false;
  try {
    const r = await quizBackend.save(q.record, q.round, q.answers());
    if (r?.ended || r?.expired) submitQuiz(q.record, q.round, q.answers(), 'timeout');
  } catch {
    if (quizState === q) { q.dirty = true; quizSaveTimer = setTimeout(saveQuizDraft, 5000); }
  }
}

/** Last chance to keep quiz answers when the tab is closed or hidden. */
function flushQuiz() {
  const q = quizState;
  if (!q?.dirty) return;
  if (online) navigator.sendBeacon('api/study', new Blob([JSON.stringify({ action: 'quiz_save', token, round: q.round, answers: q.answers() })], { type: 'application/json' }));
  else quizBackend.save(q.record, q.round, q.answers());
  q.dirty = false;
}

async function submitQuiz(record, round, answers, reason) {
  if (quizState?.submitting) return;
  quizState = { record, round, answers: () => answers, dirty: false, submitting: true };
  clearInterval(quizTick);
  clearTimeout(quizSaveTimer);
  showOverlay(`
    <div class="eyebrow">${ROUND[round].name}</div>
    <h2>${reason === 'timeout' ? 'Time is up' : 'Saving your answers…'}</h2>
    <p class="lead" id="quiz-saving">Saving your answers… Please keep this page open.</p>`, 'end-overlay');
  for (let attempt = 0; attempt <= 40; attempt++) {
    try {
      await quizBackend.submit(record, round, answers, reason);
      quizState = null;
      return afterReading(record, { saved: true });
    } catch (err) {
      if (err.status === 401 || err.status === 400 || err.status === 409) break;
      await sleep(3000);
    }
  }
  if ($('#quiz-saving')) $('#quiz-saving').textContent = 'Your answers could not be saved. Please keep this page open and tell the research team.';
}

const httpsLink = (url, label) => (/^https:\/\//.test(url || '') ? `<div class="actions"><a class="button primary" href="${esc(url)}">${label}</a></div>` : '');
const longDate = (ms) => new Date(ms).toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/**
 * The closed screen. It stays up, even after a reload, until a new session is started:
 * by the researcher (local), or never for the same email address (online). Online, it
 * also says when the follow-up quiz opens, and the same link then leads to that quiz.
 */
function showEnd(record, { saved = false, returning = false } = {}) {
  const what = record.condition === 'palace' ? 'room' : 'article';
  const quizDone = !!record.quiz?.submittedAt;
  const first = record.person?.name ? `, ${esc(record.person.name.split(/\s+/)[0])}` : '';
  const savedLine = `<p class="fine" id="save-state">${saved ? 'Your session has been saved. You can close this page.' : 'Saving your session… Please keep this page open.'}</p>`;
  if (online && record.retake?.submittedAt) {
    // both rounds are in
    const next = httpsLink(config.afterRetakeUrl, 'Continue to the last question');
    showOverlay(`
      <div class="eyebrow">Study complete</div>
      <h2>Thank you${first}!</h2>
      <p class="lead">${returning ? 'You have already finished both parts of the study.' : `${record.retake.endReason === 'timeout' ? 'The quiz time is over and your answers are in.' : 'Your answers are in.'} You have finished both parts of the study.`} ${next ? 'One last question, please.' : 'We appreciate your time.'}</p>
      ${next}${savedLine}`, 'end-overlay');
    return;
  }
  const closed = quizDone
    ? (record.quiz.endReason === 'timeout' ? 'The quiz time is over and your answers are in.' : 'Your answers are in.')
    : record.endReason === 'timeout' ? `Your reading time is over and the ${what} is now closed.` : 'Your reading session is closed.';
  const head = `
    <div class="eyebrow">${quizDone ? 'Session complete' : record.endReason === 'timeout' ? 'Time is up' : 'Reading finished'}</div>
    <h2>Thank you${first}!</h2>`;
  if (online) {
    const next = httpsLink(config.afterReadingUrl, 'Continue to the questions');
    const mins = Number(config.quizMinutes) > 0 ? ` It takes up to ${minutes(Number(config.quizMinutes))}.` : '';
    const comeBack = record.retakeOpensAt != null
      ? `<p class="lead come-back"><b>One more step in two days:</b> a short follow-up quiz opens on <b>${esc(longDate(record.retakeOpensAt))}</b>. Please come back to this same link then, and sign in with the same email address if you are asked.${mins}</p>`
      : '';
    const today = comeBack ? 'That is everything for today.' : 'That is everything for today. The research team will contact you about the follow-up quiz in two days.';
    showOverlay(`${head}
      <p class="lead">${returning ? (comeBack ? 'You have finished the first part. The follow-up quiz is not open yet.' : 'You have already completed this session, so it cannot be opened again.') : `${closed} ${next ? 'Please continue with the questions.' : today}`}</p>
      ${next}${comeBack}${savedLine}`, 'end-overlay');
    return;
  }
  const answered = quizDone ? Object.values(record.quiz.answers || {}).filter((a) => a.trim()).length : 0;
  const quizLine = quizDone
    ? ` · quiz: ${answered} of ${record.quiz.questions?.length ?? '?'} answered${record.quiz.endReason === 'timeout' ? ' (time ran out)' : ''}`
    : record.quizSkipped ? ` · no quiz (${esc(record.quizSkipped)}): give it on paper or a form` : '';
  showOverlay(`${head}
    <p class="lead">${closed} Please let the researcher know you are done.</p>
    <details class="researcher">
      <summary>Researcher</summary>
      <p>Session <b>${esc(record.participant)}</b> · ${record.condition === 'palace' ? 'Mind Palace' : 'Standard article'} · ${fmt(record.endedAtMs)} read · ${esc(record.endReason)}${quizLine}</p>
      <div class="actions">
        <button type="button" class="primary" id="dl-session">Download this log</button>
        <button type="button" id="new-session">New session</button>
      </div>
    </details>`, 'end-overlay');
  $('#dl-session').onclick = () => download(`${record.participant}-${record.condition}-${record.article.id}.json`, record);
  $('#new-session').onclick = () => {
    store.del(ENDED_KEY);
    location.href = `${location.pathname}?study=local`;
  };
}

// ---- researcher page (?study=admin): the sessions saved in the database ----------------

const CONDITION = { palace: 'Mind Palace', article: 'Standard article' };

function adminKey() {
  try { return sessionStorage.getItem(ADMIN_KEY); } catch { return null; }
}

function showAdminKey(message = '') {
  showOverlay(`
    <div class="eyebrow">Research team</div>
    <h2>Study data</h2>
    <p class="lead">Enter the researcher key to see the sessions saved in the database.</p>
    <form id="key-form" class="setup">
      <label>Researcher key <input name="key" type="password" required autocomplete="off"></label>
      ${message ? `<p class="error">${esc(message)}</p>` : ''}
      <div class="actions"><button class="primary" type="submit">Open</button></div>
    </form>
    <p class="fine">This is the STUDY_ADMIN_KEY set on the server. It is remembered only until you close this tab.</p>
    <p class="fine"><a href="${esc(location.pathname)}?study=local">Run a session in this browser only</a> (not saved to the database)</p>`, 'setup-overlay');
  $('#key-form').onsubmit = (e) => {
    e.preventDefault();
    try { sessionStorage.setItem(ADMIN_KEY, String(new FormData(e.target).get('key'))); } catch { /* private mode */ }
    showAdmin();
  };
}

function statusOf(sv, at) {
  const limit = sv.readingMinutes * 60000;
  if (!sv.startedAt) return { label: 'Signed in, not started', ms: null };
  if (sv.endedAt) return { label: sv.endReason === 'timeout' ? 'Time ran out' : 'Finished early', ms: sv.endedAtMs };
  if (at - sv.startedAt < limit) return { label: 'Reading now', ms: at - sv.startedAt, live: true };
  return { label: 'Time ran out (page was closed)', ms: limit };
}

const shortDate = (ms) => new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Where a participant is with one round of the quiz ('quiz' or 'retake'), for the researcher page. */
function quizStatusOf(sv, at, round = 'quiz') {
  const q = sv[round];
  if (!q && round === 'retake') {
    if (sv.retakeOpensAt == null) return { label: '–', answered: null, ms: null };
    return { label: at < sv.retakeOpensAt ? `Opens ${shortDate(sv.retakeOpensAt)}` : 'Open, not started', answered: null, ms: null };
  }
  if (!q) return { label: sv.endedAt ? 'Not started' : '–', answered: null, ms: null };
  const answered = Object.values(q.answers || {}).filter((a) => a.trim()).length;
  const limit = q.minutes > 0 ? q.minutes * 60000 : Infinity;
  if (q.submittedAt) return { label: q.endReason === 'timeout' ? 'Time ran out' : 'Submitted', answered, ms: new Date(q.submittedAt) - q.startedAt, done: true };
  if (at - q.startedAt < limit) return { label: 'Answering now', answered, ms: at - q.startedAt };
  return { label: 'Time ran out (page was closed)', answered, ms: limit, done: true };
}

const palaceFiles = {};
const palaceFile = (path) => (palaceFiles[path] ??= fetch(path, { cache: 'no-cache' }).then((r) => r.json()).catch(() => null));

/** A server session plus its status and the same summary a local log gets. */
async function toRecord(sv, at, quiz = []) {
  const st = statusOf(sv, at);
  const qs = quizStatusOf(sv, at);
  const rs = quizStatusOf(sv, at, 'retake');
  const record = { ...sv, status: st.label, quizStatus: qs.label, retakeStatus: rs.label };
  if (sv.retake) {
    record.retake = {
      ...sv.retake,
      seconds: rs.ms == null ? null : Math.round(rs.ms / 1000),
      // how long after the first quiz was handed in the retake began
      hoursAfterQuiz: sv.quiz?.submittedAt ? Math.round((sv.retake.startedAt - new Date(sv.quiz.submittedAt)) / 360000) / 10 : null,
      responses: quiz.map((q) => ({ id: q.id, question: q.text, expected: q.answer, answer: sv.retake.answers?.[q.id] ?? '' })),
    };
  }
  if (sv.quiz) {
    record.quiz = {
      ...sv.quiz,
      seconds: qs.ms == null ? null : Math.round(qs.ms / 1000),
      // how long after the reading closed the quiz began
      secondsAfterReading: sv.endedAt ? Math.max(0, Math.round((sv.quiz.startedAt - new Date(sv.endedAt)) / 1000)) : null,
      responses: quiz.map((q) => ({ id: q.id, question: q.text, expected: q.answer, answer: sv.quiz.answers?.[q.id] ?? '' })),
    };
  }
  if (sv.startedAt && !st.live) {
    const p = await palaceFile(sv.article.file);
    record.summary = summarize({
      ...sv,
      endedAtMs: st.ms,
      endReason: sv.endReason || 'timeout',
      palace: p ? { chunks: p.chunks.map((c, i) => ({ heading: c.heading, objectId: sv.choices[i] ?? null })) } : null,
    });
  }
  return { record, st, qs, rs };
}

function toCsv(records, quiz = []) {
  const stops = Math.max(0, ...records.map((r) => r.stops || 0));
  const head = ['participant', 'name', 'email', 'age', 'condition', 'status', 'signed_in', 'started', 'reading_seconds',
    'objects_placed', 'object_changes', 'highlights', ...Array.from({ length: stops }, (_, i) => `seconds_stop_${i + 1}`),
    'quiz_status', 'quiz_started', 'quiz_seconds', 'quiz_seconds_after_reading', ...quiz.map((q) => q.id),
    'retake_status', 'retake_started', 'retake_seconds', 'retake_hours_after_quiz', ...quiz.map((q) => `retake_${q.id}`)];
  const cell = (v) => {
    let t = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`; // a name must never run as a spreadsheet formula
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const rows = records.map((r) => [
    r.participant, r.person.name, r.person.email, r.person.age, r.condition, r.status, r.person.signedInAt, r.startedAtIso,
    r.summary ? Math.round(r.summary.readingMs / 1000) : '', r.summary?.objectsPlaced, r.summary?.objectChanges, r.summary?.highlightCount,
    ...Array.from({ length: stops }, (_, i) => r.summary?.secondsPerStop?.[i + 1]),
    r.quizStatus, r.quiz?.startedAtIso, r.quiz?.seconds, r.quiz?.secondsAfterReading, ...quiz.map((q) => r.quiz?.answers?.[q.id]),
    r.retakeStatus, r.retake?.startedAtIso, r.retake?.seconds, r.retake?.hoursAfterQuiz, ...quiz.map((q) => r.retake?.answers?.[q.id]),
  ]);
  return [head, ...rows].map((row) => row.map(cell).join(',')).join('\n');
}

async function showAdmin() {
  const key = adminKey();
  if (!key) return showAdminKey();
  let data;
  try {
    data = await api('admin_list', { adminKey: key });
  } catch (err) {
    try { sessionStorage.removeItem(ADMIN_KEY); } catch { /* ignore */ }
    return showAdminKey(err.message);
  }
  const quiz = Array.isArray(data.quiz) ? data.quiz : [];
  const rows = await Promise.all(data.sessions.map((sv) => toRecord(sv, data.now, quiz)));
  const records = rows.map((r) => r.record);
  const count = (c) => records.filter((r) => r.condition === c).length;
  const done = rows.filter((r) => r.st.ms != null && !r.st.live).length;
  const quizDone = rows.filter((r) => r.qs.done).length;
  const retakeDone = rows.filter((r) => r.rs.done).length;
  const link = `${location.origin}${location.pathname}?study`;
  const day = new Date().toISOString().slice(0, 10);
  const when = (iso) => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '–');

  showOverlay(`
    <div class="eyebrow">Research team</div>
    <h2>Study data</h2>
    <p class="lead">${records.length} participant${records.length === 1 ? '' : 's'} · ${count('palace')} Mind Palace · ${count('article')} standard article · ${done} finished reading · ${quizDone} finished the quiz · ${retakeDone} finished the retake</p>
    <label class="share">Link for participants
      <span><input id="share-link" readonly value="${esc(link)}"><button type="button" id="copy-link">Copy</button></span>
    </label>
    <div class="admin-bar">
      <button type="button" id="admin-refresh">Refresh</button>
      <button type="button" id="admin-json" ${records.length ? '' : 'disabled'}>Download all (JSON)</button>
      <button type="button" id="admin-csv" ${records.length ? '' : 'disabled'}>Download table (CSV)</button>
      <span class="grow"></span>
      <button type="button" id="admin-lock">Lock</button>
    </div>
    <div class="admin-table-wrap"><table class="admin-table">
      <thead><tr><th>ID</th><th>Name</th><th>Email</th><th>Age</th><th>Condition</th><th>Status</th><th>Signed in</th><th>Read</th><th>Result</th><th>Quiz</th><th>Retake</th><th></th></tr></thead>
      <tbody>${rows.map(({ record: r, st, qs, rs }, i) => `<tr>
        <td><b>${esc(r.participant)}</b></td>
        <td>${esc(r.person.name)}</td>
        <td>${esc(r.person.email)}</td>
        <td>${esc(r.person.age)}</td>
        <td>${CONDITION[r.condition] || esc(r.condition)}</td>
        <td>${esc(r.status)}</td>
        <td>${esc(when(r.person.signedInAt))}</td>
        <td>${st.ms == null ? '–' : fmt(st.ms)}</td>
        <td>${!r.summary ? '–' : r.condition === 'palace' ? `${r.summary.objectsPlaced ?? 0}/${r.stops} objects` : `${r.summary.highlightCount} highlight${r.summary.highlightCount === 1 ? '' : 's'}`}</td>
        <td>${esc(qs.label)}${qs.answered == null ? '' : `<br><small>${qs.answered}/${quiz.length} answered · ${fmt(qs.ms)}</small>`}</td>
        <td>${esc(rs.label)}${rs.answered == null ? '' : `<br><small>${rs.answered}/${quiz.length} answered · ${fmt(rs.ms)}${r.retake?.hoursAfterQuiz == null ? '' : ` · ${r.retake.hoursAfterQuiz} h later`}</small>`}</td>
        <td><button type="button" data-dl="${i}">JSON</button> <button type="button" data-del="${i}">Delete</button></td>
      </tr>`).join('') || '<tr><td colspan="12">No one has signed in yet.</td></tr>'}</tbody>
    </table></div>
    <details class="researcher answer-key">
      <summary>Quiz questions and expected answers</summary>
      <ol>${quiz.map((q) => `<li>${esc(q.text)}<br><b>${esc(q.answer)}</b></li>`).join('')}</ol>
      <p>Each participant's answers are in the downloads: one column per question in the CSV, and next to the expected answer in the JSON.</p>
    </details>
    <p class="fine">These records hold names, email addresses and ages. Keep downloaded files within the research team and out of the repository. Deleting a session lets that email address take part again; use it for your own test runs.</p>
    <p class="fine"><a href="${esc(location.pathname)}?study=local">Run a session in this browser only</a> (not saved to the database)</p>`, 'admin-overlay');

  $('#copy-link').onclick = async () => {
    $('#share-link').select();
    try { await navigator.clipboard.writeText(link); $('#copy-link').textContent = 'Copied'; } catch { /* the link is selected: copy by hand */ }
  };
  $('#admin-refresh').onclick = showAdmin;
  $('#admin-json').onclick = () => download(`mind-palace-study-${day}.json`, records);
  $('#admin-csv').onclick = () => downloadText(`mind-palace-study-${day}.csv`, toCsv(records, quiz), 'text/csv');
  $('#admin-lock').onclick = () => {
    try { sessionStorage.removeItem(ADMIN_KEY); } catch { /* ignore */ }
    showAdminKey();
  };
  overlay().querySelectorAll('[data-dl]').forEach((b) => {
    const r = records[b.dataset.dl];
    b.onclick = () => download(`${r.participant}-${r.condition}-${r.article.id}.json`, r);
  });
  overlay().querySelectorAll('[data-del]').forEach((b) => {
    const r = records[b.dataset.del];
    b.onclick = async () => {
      if (!window.confirm(`Delete ${r.participant} (${r.person.name}, ${r.person.email}) from the database? This cannot be undone. Download the record first if you may need it.`)) return;
      try { await api('admin_delete', { adminKey: key, id: r.id }); } catch (err) { window.alert(err.message); }
      showAdmin();
    };
  });
}

// ---- control condition: standard article with highlighting ----------------------------

function showReader() {
  const s = study.session;
  const reader = $('#reader');
  // Same text as the palace: walk the chunks' parts and restart a section heading
  // whenever the original section changes.
  let section = null;
  let html = '';
  for (const c of palaceData.chunks) {
    for (const p of c.parts) {
      if (p.section !== section) {
        section = p.section;
        if (section !== 'Overview') html += `<h2>${esc(section)}</h2>`;
      }
      html += p.full.split(/\n+/).filter(Boolean).map((t) => `<p>${esc(t)}</p>`).join('');
    }
  }
  reader.innerHTML = `
    <header class="reader-bar">
      <span class="reader-brand">Wikipedia</span>
      <span class="study-timer" title="Reading time left"></span>
      <button type="button" id="reader-done">I'm done</button>
    </header>
    <article class="reader-page">
      <h1>${esc(palaceData.title)}</h1>
      <div class="reader-sub">From Wikipedia, the free encyclopedia</div>
      <div id="reader-body">${html}</div>
      <p class="attrib">Text from Wikipedia, CC BY-SA 4.0. Select text to highlight it; click a highlight to remove it.</p>
    </article>`;
  reader.hidden = false;
  hooks.room.renderer.setAnimationLoop(null); // the 3D room is not shown in this condition
  $('#reader-done').onclick = finishEarly;

  // restore highlights after a reload
  for (const h of s.highlights) applyHighlightByOffsets(h.start, h.end, h.id);

  const body = $('#reader-body');
  const onSelect = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    if (!body.contains(range.commonAncestorContainer)) return;
    const start = textOffset(body, range.startContainer, range.startOffset);
    const end = textOffset(body, range.endContainer, range.endOffset);
    if (end - start < 2) return;
    const id = `h${now()}`;
    const text = body.textContent.slice(start, end);
    applyHighlightByOffsets(start, end, id);
    sel.removeAllRanges();
    s.highlights.push({ id, start, end, text });
    log('highlight', { id, text });
  };
  body.addEventListener('mouseup', onSelect);
  body.addEventListener('touchend', () => setTimeout(onSelect, 50));
  body.addEventListener('click', (e) => {
    const mark = e.target.closest('mark');
    if (!mark || !window.getSelection().isCollapsed) return;
    const id = mark.dataset.id;
    body.querySelectorAll(`mark[data-id="${id}"]`).forEach((m) => m.replaceWith(...m.childNodes));
    body.normalize();
    const removed = s.highlights.find((h) => h.id === id);
    s.highlights = s.highlights.filter((h) => h.id !== id);
    log('unhighlight', { id, text: removed?.text });
  });
}

/** Character offset of (node, offset) within root's text. */
function textOffset(root, node, offset) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n = 0;
  if (node.nodeType !== Node.TEXT_NODE) {
    // offset counts child nodes: convert to the text before that child
    const r = document.createRange();
    r.setStart(root, 0);
    r.setEnd(node, offset);
    return r.toString().length;
  }
  while (walker.nextNode()) {
    if (walker.currentNode === node) return n + offset;
    n += walker.currentNode.textContent.length;
  }
  return n;
}

/** Wrap the text between two character offsets in <mark> elements. */
function applyHighlightByOffsets(start, end, id) {
  const body = $('#reader-body');
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  const targets = [];
  let n = 0;
  while (walker.nextNode()) {
    const t = walker.currentNode;
    const len = t.textContent.length;
    const a = Math.max(start, n);
    const b = Math.min(end, n + len);
    if (a < b) targets.push([t, a - n, b - n]);
    n += len;
  }
  for (const [t, a, b] of targets) {
    let node = t;
    if (a > 0) node = node.splitText(a);
    if (b - a < node.textContent.length) node.splitText(b - a);
    const mark = document.createElement('mark');
    mark.dataset.id = id;
    node.replaceWith(mark);
    mark.appendChild(node);
  }
}
