// The study backend: sign-in, the server-side clock, progress sync and the researcher's
// data access. One entry point, handleStudy(body), used by api/study.js.
//
// A participant signs in with name, email and age. The server gives them a participant
// ID, assigns the condition (balanced between the two) and returns a random token that
// the browser keeps. One email address = one session: signing in again with the same
// address, on any computer, continues that session or shows that it is closed.
// The reading clock is the server's: startedAt is set here, so a reload, another
// computer or a changed system clock cannot buy more time.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { dbConfigured, collections } from './study-db.js';

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
  };
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
  return { sessions: docs.map(forResearcher), readingMinutes: loadSettings().readingMinutes, now: Date.now() };
}

async function adminDelete(body) {
  await requireResearcher(body);
  const id = parse(z.string().regex(/^[0-9a-f]{24}$/), body.id);
  const { sessions } = await collections();
  const r = await sessions.deleteOne({ _id: new ObjectId(id) });
  return { deleted: r.deletedCount };
}

const ACTIONS = { signin: signIn, resume, start, sync, end, admin_list: adminList, admin_delete: adminDelete };

/** Run one request. Returns the JSON to send; throws HttpError for anything the client should see. */
export async function handleStudy(body) {
  const action = typeof body?.action === 'string' ? body.action : '';
  if (action === 'status') return { online: dbConfigured(), now: Date.now() };
  if (!Object.hasOwn(ACTIONS, action)) throw new HttpError(400, 'Unknown action.');
  if (!dbConfigured()) throw new HttpError(503, 'The study database is not set up (MONGODB_URI is missing).');
  return ACTIONS[action](body);
}
