// Vercel serverless function: POST /api/suggest
// Body: { title, chunks: [{ heading, text }], token? } → Claude's theme + object suggestions.
// Set ANTHROPIC_API_KEY in the Vercel project's environment variables.
// On a public site each request must carry a sign-in session (see lib/access.js):
// set GOOGLE_CLIENT_ID as well, or Claude stays switched off there.
import { readInput, suggestWithClaude, describeError } from '../lib/palace-ai.js';
import { admit, AccessError } from '../lib/access.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Use POST.' });
  }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body;
    const input = readInput(body); // reject bad requests before they count against anyone
    const pass = await admit(body?.token);
    let out;
    try {
      out = await suggestWithClaude(input);
    } catch (err) {
      await pass.refund();
      throw err;
    }
    return res.status(200).json({ ...out, remaining: pass.remaining });
  } catch (err) {
    if (err instanceof AccessError) return res.status(err.status).json({ error: err.message, code: err.code });
    const { status, error } = describeError(err);
    if (status >= 500) console.error('suggest api:', err?.name, err?.message);
    return res.status(status).json({ error });
  }
}
