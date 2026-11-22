// Vercel serverless function: POST /api/suggest
// Body: { title, chunks: [{ heading, text }] } → Claude's theme + object suggestions.
// Set ANTHROPIC_API_KEY in the Vercel project's environment variables.
import { readInput, suggestWithClaude, describeError } from '../lib/palace-ai.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Use POST.' });
  }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body;
    const out = await suggestWithClaude(readInput(body));
    return res.status(200).json(out);
  } catch (err) {
    const { status, error } = describeError(err);
    if (status >= 500) console.error(err);
    return res.status(status).json({ error });
  }
}
