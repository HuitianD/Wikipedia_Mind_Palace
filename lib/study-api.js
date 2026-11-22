// The study backend: sign-in, the server-side clock, progress sync and the researcher's
// data access. One entry point, handleStudy(body), used by api/study.js.
//
// A participant signs in with name, email and age. The server gives them a participant
// ID, assigns the condition (balanced between the two) and returns a random token that
// the browser keeps. One email address = one session: signing in again with the same
// address, on any computer, continues that session or shows that it is closed.
// The reading clock is the server's: startedAt is set here, so a reload, another
// computer or a changed system clock cannot buy more time.
// When the reading has closed, the participant takes the memory quiz (lib/study-quiz.js).
// Its questions are only sent out then, and its clock is the server's too.
// Two days after handing that in, signing in again opens the same quiz once more (the
// "retake"), without the article: this measures what is still remembered.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { dbConfigured, collections } from './study-db.js';
import { QUIZ } from './study-quiz.js';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// ---- study settings (same files the browser reads) -------------------------------------

let settings = null;
function loadSettings() {
  if (settings) return settings;
  const read = (rel) => JSON.parse(fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8'));
  const cfg = read('data/study.json');
  const a = cfg.articles[0];
  const p = read(a.palace);
  settings = {
    readingMinutes: cfg.readingMinutes,
    quizMinutes: Number(cfg.quizMinutes) > 0 ? Number(cfg.quizMinutes) : 0, // 0 = no time limit
    // hours between handing in the quiz and the retake opening; null = no retake in the app
    retakeAfterHours: typeof cfg.retakeAfterHours === 'number' && cfg.retakeAfterHours >= 0 ? cfg.retakeAfterHours : null,
    article: { id: a.id, title: p.title, url: p.url, file: a.palace },
    theme: p.theme,
    stops: p.chunks.length,
    suggestedBy: p.suggestedBy || null,
  };
  return settings;
}

// ---- input shapes --------------------------------------------------------------------------
// Only these fields are stored; anything else a client sends is dropped.

const Token = z.string().min(20).max(100);
const SignIn = z.object({
  name: z.string().trim().min(1, 'Please enter your name.').max(80),
  email: z.string().trim().max(120).regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Please enter a valid email address.'),
  age: z.coerce.number({ error: 'Please enter your age.' }).int('Please enter your age.').min(1, 'Please enter your age.').max(120, 'Please enter your age.'),
});
const Event = z.object({
  t: z.number().min(0).max(24 * 3600 * 1000),
  type: z.string().max(40).regex(/^[a-z_]+$/),
  stop: z.number().int().min(1).max(100).optional(),
  objectId: z.string().max(40).optional(),
  rank: z.number().int().min(0).max(50).nullable().optional(),
  fromAll: z.boolean().optional(),
  via: z.string().max(10).optional(),
  open: z.boolean().optional(),
  id: z.string().max(40).optional(),
  text: z.string().max(30000).optional(),
  condition: z.string().max(20).optional(),
  reason: z.string().max(40).optional(),
});
const Highlight = z.object({
  id: z.string().max(40),
  start: z.number().int().min(0),
  end: z.number().int().min(0),
  text: z.string().max(30000),
});
const Progress = z.object({
  events: z.array(Event).max(5000),
  highlights: z.array(Highlight).max(1000),
  choices: z.array(z.string().max(40).nullable()).max(100), // object id per stop, in order
});
const EndReason = z.enum(['timeout', 'finished_early']);
const Answers = z.record(z.string().max(10), z.string().max(2000)); // question id → what the participant wrote
const QuizReason = z.enum(['submitted', 'timeout']);
const Round = z.enum(['quiz', 'retake']).default('quiz'); // the quiz right after reading, or the one two days later
/** Keep only answers to questions that exist. */
const cleanAnswers = (raw) => Object.fromEntries(QUIZ.filter((q) => typeof raw[q.id] === 'string').map((q) => [q.id, raw[q.id].trim()]));

function parse(schema, value) {
  const r = schema.safeParse(value);
  if (!r.success) throw new HttpError(400, r.error.issues[0]?.message || 'Invalid request.');
  return r.data;
}

const sha = (text) => crypto.createHash('sha256').update(text).digest();
const tokenHash = (token) => sha(token).toString('hex');

// ---- what goes back to the browser ---------------------------------------------------------

/** A session as the participant's browser sees it. Personal details stay on the server. */
function forParticipant(doc) {
  return {
    id: String(doc._id),
    participant: doc.participant,
    condition: doc.condition,
    article: doc.article,
    readingMinutes: doc.readingMinutes,
    theme: doc.theme,
    stops: doc.stops,
    suggestedBy: doc.suggestedBy,
    createdAt: doc.createdAt.toISOString(),
    startedAt: doc.startedAt ? doc.startedAt.getTime() : null,
    endedAt: doc.endedAt ? doc.endedAt.toISOString() : null,
    endedAtMs: doc.endedAtMs,
    endReason: doc.endReason,
    events: doc.events,
    highlights: doc.highlights,
    choices: doc.choices,
    quiz: roundOut(doc.quiz),
    retake: roundOut(doc.retake),
    retakeOpensAt: retakeOpensAt(doc),
  };
}

/** One round of the quiz (the first one or the retake) as the browser sees it. */
function roundOut(q) {
  if (!q) return null;
  return {
    startedAt: q.startedAt.getTime(),
    startedAtIso: q.startedAt.toISOString(),
    minutes: q.minutes,
    submittedAt: q.submittedAt ? q.submittedAt.toISOString() : null,
    endReason: q.endReason,
    answers: q.answers,
  };
}

/** When the retake opens for this participant (ms), or null if it is not known yet or not offered. */
function retakeOpensAt(doc) {
  const hours = loadSettings().retakeAfterHours;
  if (hours == null || !doc.quiz?.submittedAt) return null;
  return doc.quiz.submittedAt.getTime() + hours * 3600000;
}

/** The full record, for the research team. */
function forResearcher(doc) {
  return {
    ...forParticipant(doc),
    person: { ...doc.person, signedInAt: doc.person.signedInAt.toISOString() },
    assignment: doc.assignment,
    startedAtIso: doc.startedAt ? doc.startedAt.toISOString() : null,
    lastSeenAt: doc.lastSeenAt ? doc.lastSeenAt.toISOString() : null,
  };
}

const limitMs = (doc) => doc.readingMinutes * 60000;

// ---- participant actions -------------------------------------------------------------------

/** Give the next participant whichever condition has fewer people; a coin flip when level. */
async function assignCondition(sessions) {
  const rows = await sessions.aggregate([{ $group: { _id: '$condition', n: { $sum: 1 } } }]).toArray();
  const n = Object.fromEntries(rows.map((r) => [r._id, r.n]));
  const palace = n.palace || 0;
  const article = n.article || 0;
  if (palace === article) return crypto.randomInt(2) ? 'palace' : 'article';
  return palace < article ? 'palace' : 'article';
}

async function signIn(body) {
  const input = parse(SignIn, body);
  const { sessions, counters } = await collections();
  const emailKey = input.email.toLowerCase();
  const token = crypto.randomBytes(24).toString('base64url');
  // a returning participant (same email) gets a new token for this browser
  const addToken = { $push: { tokenHashes: { $each: [tokenHash(token)], $slice: -10 } }, $set: { lastSeenAt: new Date() } };
  let doc = await sessions.findOneAndUpdate({ emailKey }, addToken, { returnDocument: 'after' });
  let returning = !!doc;
  if (!doc) {
    const s = loadSettings();
    const condition = await assignCondition(sessions);
    const counter = await counters.findOneAndUpdate({ _id: 'participant' }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after' });
    const at = new Date();
    doc = {
      participant: `P${String(counter.seq).padStart(2, '0')}`,
      emailKey,
      person: { name: input.name, email: input.email, age: input.age, signedInAt: at },
      condition,
      assignment: 'balanced',
      article: s.article,
      readingMinutes: s.readingMinutes,
      theme: s.theme,
      stops: s.stops,
      suggestedBy: s.suggestedBy,
      createdAt: at,
      startedAt: null,
      endedAt: null,
      endedAtMs: null,
      endReason: null,
      events: [],
      highlights: [],
      choices: [],
      quiz: null,
      retake: null,
      tokenHashes: [tokenHash(token)],
      lastSeenAt: at,
    };
    try {
      doc._id = (await sessions.insertOne(doc)).insertedId;
    } catch (err) {
      if (err.code !== 11000) throw err; // two sign-ins with the same email at once: use the first
      doc = await sessions.findOneAndUpdate({ emailKey }, addToken, { returnDocument: 'after' });
      returning = true;
    }
  }
  return { session: forParticipant(doc), token, returning, now: Date.now() };
}

/** Find the session a token belongs to. */
async function authed(body) {
  const token = parse(Token, body.token);
  const { sessions } = await collections();
  const doc = await sessions.findOne({ tokenHashes: tokenHash(token) });
  if (!doc) throw new HttpError(401, 'Please sign in again.');
  return { sessions, doc };
}

async function resume(body) {
  const { sessions, doc } = await authed(body);
  await sessions.updateOne({ _id: doc._id }, { $set: { lastSeenAt: new Date() } });
  return { session: forParticipant(doc), now: Date.now() };
}

/** Start the reading clock. Calling it again never restarts it. */
async function start(body) {
  const { sessions, doc } = await authed(body);
  const at = new Date();
  const started = await sessions.findOneAndUpdate(
    { _id: doc._id, startedAt: null },
    { $set: { startedAt: at, lastSeenAt: at, events: [{ t: 0, type: 'start', condition: doc.condition }] } },
    { returnDocument: 'after' },
  );
  return { session: forParticipant(started || await sessions.findOne({ _id: doc._id })), now: Date.now() };
}

/** Save progress while reading. Ignored once the session is closed or the time is over. */
async function sync(body) {
  const { sessions, doc } = await authed(body);
  const p = parse(Progress, body);
  if (!doc.startedAt) throw new HttpError(409, 'This session has not started.');
  if (doc.endedAt) return { ended: true, now: Date.now() };
  const elapsed = Date.now() - doc.startedAt.getTime();
  if (elapsed > limitMs(doc) + 15000) return { expired: true, now: Date.now() };
  if (p.events.length < doc.events.length) return { stale: true, now: Date.now() }; // an older copy arriving late
  await sessions.updateOne({ _id: doc._id, endedAt: null }, { $set: { ...p, lastSeenAt: new Date() } });
  return { ok: true, remainingMs: limitMs(doc) - elapsed, now: Date.now() };
}

/** Close the session. The server decides how long it lasted. */
async function end(body) {
  const { sessions, doc } = await authed(body);
  const p = parse(Progress, body);
  const reason = parse(EndReason, body.reason);
  if (!doc.startedAt) throw new HttpError(409, 'This session has not started.');
  let closed = doc;
  if (!doc.endedAt) {
    const elapsed = Date.now() - doc.startedAt.getTime();
    const endedAtMs = Math.min(elapsed, limitMs(doc));
    const set = {
      endedAt: new Date(doc.startedAt.getTime() + endedAtMs),
      endedAtMs,
      endReason: elapsed >= limitMs(doc) ? 'timeout' : reason,
      lastSeenAt: new Date(),
    };
    if (p.events.length >= doc.events.length) Object.assign(set, p);
    closed = await sessions.findOneAndUpdate({ _id: doc._id, endedAt: null }, { $set: set }, { returnDocument: 'after' })
      || await sessions.findOne({ _id: doc._id });
  }
  return { session: forParticipant(closed), now: Date.now() };
}

// ---- memory quiz -----------------------------------------------------------------------------
// Two rounds with the same questions and rules: `quiz` right after reading, and `retake`
// once retakeAfterHours have passed since the first one was handed in.

const questions = () => QUIZ.map(({ id, text }) => ({ id, text })); // never the expected answers
const roundLimit = (q) => (q.minutes > 0 ? q.minutes * 60000 : Infinity);

/** Open a round. Calling it again never restarts its clock. */
async function quizStart(body) {
  const { sessions, doc } = await authed(body);
  const round = parse(Round, body.round);
  if (round === 'quiz') {
    if (!doc.endedAt) throw new HttpError(409, 'The reading part is not finished yet.');
  } else if (!doc.retake) {
    const opens = retakeOpensAt(doc);
    if (opens == null) throw new HttpError(409, 'The follow-up quiz is not available yet.');
    if (Date.now() < opens) throw new HttpError(409, 'The follow-up quiz is not open yet.');
  }
  const at = new Date();
  const started = await sessions.findOneAndUpdate(
    { _id: doc._id, [round]: null }, // null also matches sessions from before this round existed
    { $set: { [round]: { startedAt: at, minutes: loadSettings().quizMinutes, submittedAt: null, endReason: null, answers: {} }, lastSeenAt: at } },
    { returnDocument: 'after' },
  );
  return { session: forParticipant(started || await sessions.findOne({ _id: doc._id })), questions: questions(), now: Date.now() };
}

/** Keep the answers written so far, so a closed page loses nothing. */
async function quizSave(body) {
  const { sessions, doc } = await authed(body);
  const round = parse(Round, body.round);
  const answers = cleanAnswers(parse(Answers, body.answers));
  const q = doc[round];
  if (!q) throw new HttpError(409, 'The quiz has not started.');
  if (q.submittedAt) return { ended: true, now: Date.now() };
  if (Date.now() - q.startedAt.getTime() > roundLimit(q) + 15000) return { expired: true, now: Date.now() };
  await sessions.updateOne({ _id: doc._id, [`${round}.submittedAt`]: null }, { $set: { [`${round}.answers`]: answers, lastSeenAt: new Date() } });
  return { ok: true, now: Date.now() };
}

/** Hand in a round. Answers that arrive well after the time limit are not taken; the last saved ones stand. */
async function quizSubmit(body) {
  const { sessions, doc } = await authed(body);
  const round = parse(Round, body.round);
  const answers = cleanAnswers(parse(Answers, body.answers));
  const reason = parse(QuizReason, body.reason);
  const q = doc[round];
  if (!q) throw new HttpError(409, 'The quiz has not started.');
  let closed = doc;
  if (!q.submittedAt) {
    const start = q.startedAt.getTime();
    const limit = roundLimit(q);
    const elapsed = Date.now() - start;
    const set = {
      [`${round}.submittedAt`]: new Date(Math.min(Date.now(), start + limit)),
      [`${round}.endReason`]: elapsed >= limit ? 'timeout' : reason,
      lastSeenAt: new Date(),
    };
    if (elapsed <= limit + 15000) set[`${round}.answers`] = answers;
    closed = await sessions.findOneAndUpdate({ _id: doc._id, [`${round}.submittedAt`]: null }, { $set: set }, { returnDocument: 'after' })
      || await sessions.findOne({ _id: doc._id });
  }
  return { session: forParticipant(closed), now: Date.now() };
}

// ---- researcher actions --------------------------------------------------------------------

async function requireResearcher(body) {
  const want = process.env.STUDY_ADMIN_KEY;
  if (!want) throw new HttpError(403, 'Set STUDY_ADMIN_KEY on the server to use the researcher page.');
  const got = typeof body.adminKey === 'string' ? body.adminKey : '';
  if (!crypto.timingSafeEqual(sha(want), sha(got))) {
    await new Promise((r) => setTimeout(r, 400)); // slow down guessing
    throw new HttpError(401, 'Wrong researcher key.');
  }
}

async function adminList(body) {
  await requireResearcher(body);
  const { sessions } = await collections();
  const docs = await sessions.find({}, { projection: { tokenHashes: 0 } }).sort({ createdAt: 1 }).limit(2000).toArray();
  return { sessions: docs.map(forResearcher), readingMinutes: loadSettings().readingMinutes, quiz: QUIZ, now: Date.now() };
}

async function adminDelete(body) {
  await requireResearcher(body);
  const id = parse(z.string().regex(/^[0-9a-f]{24}$/), body.id);
  const { sessions } = await collections();
  const r = await sessions.deleteOne({ _id: new ObjectId(id) });
  return { deleted: r.deletedCount };
}

const ACTIONS = {
  signin: signIn, resume, start, sync, end,
  quiz_start: quizStart, quiz_save: quizSave, quiz_submit: quizSubmit,
  admin_list: adminList, admin_delete: adminDelete,
};

/** Run one request. Returns the JSON to send; throws HttpError for anything the client should see. */
export async function handleStudy(body) {
  const action = typeof body?.action === 'string' ? body.action : '';
  if (action === 'status') return { online: dbConfigured(), now: Date.now() };
  if (action === 'quiz_questions') {
    // For sessions kept in the browser (no database, a researcher is in the room). With a
    // database the questions only go to a signed-in participant whose reading has closed.
    if (dbConfigured()) throw new HttpError(403, 'The quiz is part of the online session on this server.');
    return { questions: questions(), minutes: loadSettings().quizMinutes };
  }
  if (!Object.hasOwn(ACTIONS, action)) throw new HttpError(400, 'Unknown action.');
  if (!dbConfigured()) throw new HttpError(503, 'The study database is not set up (MONGODB_URI is missing).');
  return ACTIONS[action](body);
}
