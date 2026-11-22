// Who may spend the Claude API key. Used by api/suggest.js and api/auth.js.
//
// The ready-made palaces and the keyword suggestions cost nothing and are open to
// everyone. Asking Claude about a new article costs money, so on a public site it is
// limited to people who sign in with Google using an allowed address (by default any
// @brown.edu account), and each person gets a fixed number of requests per day.
//
//   GOOGLE_CLIENT_ID       OAuth client ID (Google Cloud console). Turns sign-in on.
//   ALLOWED_EMAIL_DOMAINS  comma-separated, default: brown.edu
//   ALLOWED_EMAILS         extra single addresses that may sign in (optional)
//   SUGGEST_DAILY_LIMIT    Claude requests per person per day, default 10
//   SESSION_SECRET         signs the sign-in sessions (optional; derived from the API key if unset)
//
// Without GOOGLE_CLIENT_ID: on your own computer Claude stays open (local development);
// on Vercel it is switched off, so a deployment can never expose the key by accident.
import crypto from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, errors as joseErrors } from 'jose';
import { dbConfigured, collections } from './study-db.js';

export class AccessError extends Error {
  /** code: 'signin' | 'domain' | 'limit' | 'off' | 'unavailable' */
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

const SESSION_DAYS = 7;
const list = (v) => String(v || '').toLowerCase().split(/[\s,]+/).filter(Boolean);
const apiKey = () => process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || '';

export function accessConfig() {
  const clientId = (process.env.GOOGLE_CLIENT_ID || '').trim();
  const domains = list(process.env.ALLOWED_EMAIL_DOMAINS || 'brown.edu');
  const emails = list(process.env.ALLOWED_EMAILS);
  const limit = Number.parseInt(process.env.SUGGEST_DAILY_LIMIT, 10);
  let claude = 'off'; // 'off' | 'signin' | 'open'
  if (apiKey()) claude = clientId ? 'signin' : (process.env.VERCEL ? 'off' : 'open');
  const why = claude !== 'off' ? null : apiKey() ? 'no_signin' : 'no_key'; // why it is off
  return { claude, why, clientId, domains, emails, dailyLimit: limit > 0 ? limit : 10 };
}

const who = (cfg) => cfg.domains.map((d) => `@${d}`).join(' or ');

// ---- sign-in sessions ------------------------------------------------------------------------
// After Google confirms who someone is, the browser gets a signed session token so it
// does not have to ask Google again for a week. Nothing is stored on the server.

function signingKey() {
  const secret = process.env.SESSION_SECRET || apiKey() || 'no-secret';
  return crypto.createHmac('sha256', secret).update('wikipedia mind palace session v1').digest();
}
const mac = (text) => crypto.createHmac('sha256', signingKey()).update(text).digest();

export function issueSession(user) {
  const expiresAt = Date.now() + SESSION_DAYS * 86400000;
  const body = Buffer.from(JSON.stringify({ e: user.email, n: user.name || '', x: expiresAt })).toString('base64url');
  return { token: `${body}.${mac(body).toString('base64url')}`, expiresAt };
}

/** The signed-in person a session token belongs to, or null. */
export function readSession(token, cfg = accessConfig()) {
  if (typeof token !== 'string' || token.length > 2000) return null;
  const [body, sig, extra] = token.split('.');
  if (!body || !sig || extra !== undefined) return null;
  const got = Buffer.from(sig, 'base64url');
  const want = mac(body);
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (typeof p.e !== 'string' || !(p.x > Date.now())) return null;
    // the allowed list may have changed since this session was issued
    if (!cfg.emails.includes(p.e) && !cfg.domains.includes(p.e.split('@').pop())) return null;
    return { email: p.e, name: typeof p.n === 'string' ? p.n : '' };
  } catch {
    return null;
  }
}

// ---- Google sign-in --------------------------------------------------------------------------

let googleKeys = null;

/**
 * Check the ID token from the "Sign in with Google" button and start a session.
 * `keys` is only passed by tests; normally Google's public keys are fetched and cached.
 */
export async function signInWithGoogle(credential, { keys } = {}) {
  const cfg = accessConfig();
  if (!cfg.clientId) throw new AccessError(503, 'off', 'Sign-in is not set up on this site.');
  if (typeof credential !== 'string' || !credential || credential.length > 6000) throw new AccessError(400, 'signin', 'Missing Google sign-in.');
  googleKeys ??= createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
  let payload;
  try {
    ({ payload } = await jwtVerify(credential, keys || googleKeys, {
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: cfg.clientId,
      algorithms: ['RS256'],
    }));
  } catch (err) {
    if (!(err instanceof joseErrors.JOSEError) || err.code === 'ERR_JWKS_TIMEOUT') {
      throw new AccessError(502, 'unavailable', 'Could not reach Google to check the sign-in. Please try again.');
    }
    throw new AccessError(401, 'signin', 'Google sign-in could not be verified. Please try again.');
  }
  const email = String(payload.email || '').toLowerCase();
  if (!email.includes('@') || payload.email_verified !== true) throw new AccessError(401, 'signin', 'Google did not confirm an email address for this account.');
  const domain = email.split('@').pop();
  // `hd` is the Google Workspace domain the account belongs to; it must match too
  const inDomain = cfg.domains.includes(domain) && String(payload.hd || '').toLowerCase() === domain;
  if (!inDomain && !cfg.emails.includes(email)) {
    throw new AccessError(403, 'domain', `Please sign in with a ${who(cfg)} account. ${email} is not on the list.`);
  }
  const user = { email, name: String(payload.name || '').slice(0, 80) };
  return { ...issueSession(user), user: { ...user, remaining: Math.max(0, cfg.dailyLimit - await usedToday(email)) } };
}

// ---- daily limit per person ------------------------------------------------------------------
// Counted in MongoDB when MONGODB_URI is set (the count then holds across Vercel's
// server instances). Without a database it is counted in memory, which is only
// dependable on a single long-running server such as `npm run dev`.

const memory = new Map();
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()); // YYYY-MM-DD
const usageId = (email) => `${email}|${today()}`;

async function usedToday(email) {
  const id = usageId(email);
  if (!dbConfigured()) return memory.get(id) || 0;
  try {
    const { usage } = await collections();
    return (await usage.findOne({ _id: id }))?.n || 0;
  } catch {
    return 0; // only for display; takeOne() is what enforces the limit
  }
}

/** Count one request. Returns the new count, or null when the limit is already reached. */
async function takeOne(email, limit) {
  const id = usageId(email);
  if (!dbConfigured()) {
    const n = memory.get(id) || 0;
    if (n >= limit) return null;
    if (memory.size > 5000) memory.clear();
    memory.set(id, n + 1);
    return n + 1;
  }
  const { usage } = await collections();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const doc = await usage.findOneAndUpdate(
        { _id: id, n: { $lt: limit } },
        { $inc: { n: 1 }, $set: { email, day: today(), at: new Date() } },
        { upsert: true, returnDocument: 'after' },
      );
      return doc.n;
    } catch (err) {
      // the row exists and is at the limit (or two first requests raced: try once more)
      if (err.code !== 11000) throw err;
    }
  }
  return null;
}

async function giveBack(email) {
  const id = usageId(email);
  if (!dbConfigured()) { if (memory.get(id) > 0) memory.set(id, memory.get(id) - 1); return; }
  const { usage } = await collections();
  await usage.updateOne({ _id: id, n: { $gt: 0 } }, { $inc: { n: -1 } });
}

// ---- the gate --------------------------------------------------------------------------------

/**
 * Let one Claude request through, or throw an AccessError.
 * Returns { remaining, refund }: call refund() if the request then fails, so that a
 * failed request does not use up someone's allowance.
 */
export async function admit(token) {
  const cfg = accessConfig();
  if (cfg.claude === 'off') {
    throw new AccessError(503, 'off', apiKey()
      ? 'Claude suggestions are switched off on this site until sign-in is set up (GOOGLE_CLIENT_ID).'
      : 'No Claude API key configured on the server.');
  }
  if (cfg.claude === 'open') return { remaining: null, refund: async () => {} };
  const user = readSession(token, cfg);
  if (!user) throw new AccessError(401, 'signin', `Sign in with a ${who(cfg)} account to use Claude's suggestions.`);
  let n;
  try {
    n = await takeOne(user.email, cfg.dailyLimit);
  } catch (err) {
    console.error('access: usage counter failed:', err?.name, err?.message);
    throw new AccessError(503, 'unavailable', 'Could not check your daily allowance. Please try again.');
  }
  if (n === null) {
    throw new AccessError(429, 'limit', `You have used today's ${cfg.dailyLimit} Claude requests. The count resets at midnight, Eastern time.`);
  }
  return { remaining: cfg.dailyLimit - n, refund: () => giveBack(user.email).catch(() => {}) };
}

/** What the browser needs to know: whether sign-in is needed, and who is signed in. */
export async function describeAccess(token) {
  const cfg = accessConfig();
  const out = { claude: cfg.claude, why: cfg.why, domains: cfg.domains, dailyLimit: cfg.dailyLimit, user: null };
  if (cfg.claude !== 'signin') return out;
  out.clientId = cfg.clientId; // public by design: it is part of the sign-in button
  out.hd = cfg.domains.length === 1 && !cfg.emails.length ? cfg.domains[0] : '';
  const user = readSession(token, cfg);
  if (user) out.user = { ...user, remaining: Math.max(0, cfg.dailyLimit - await usedToday(user.email)) };
  return out;
}
