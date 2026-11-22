// Vercel serverless function: POST /api/auth
// Body: { action: 'config', token? }        → whether Claude needs a sign-in here, and who is signed in
//       { action: 'google', credential }    → check a "Sign in with Google" ID token, start a session
// See lib/access.js. Set GOOGLE_CLIENT_ID in the Vercel project's environment variables.
import { describeAccess, signInWithGoogle, AccessError } from '../lib/access.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Use POST.' });
  }
  try {
    const body = (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body) || {};
    if (body.action === 'config') return res.status(200).json(await describeAccess(body.token));
    if (body.action === 'google') return res.status(200).json(await signInWithGoogle(body.credential));
    return res.status(400).json({ error: 'Unknown action.' });
  } catch (err) {
    if (err instanceof AccessError) return res.status(err.status).json({ error: err.message, code: err.code });
    if (err instanceof SyntaxError) return res.status(400).json({ error: 'Invalid JSON.' });
    console.error('auth api:', err?.name, err?.message);
    return res.status(500).json({ error: 'Sign-in failed on the server. Please try again.' });
  }
}
