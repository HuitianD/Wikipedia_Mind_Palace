// Vercel serverless function: /api/suggest
//   GET   → { explore, claude }: whether this server builds palaces for new articles
//           (Explore mode), and whether Claude makes the suggestions for them.
//   POST  Body: { title, chunks: [{ heading, text }] } → Claude's theme + object suggestions.
//
// Claude costs money and this endpoint has no sign-in, so it only answers when the app
// runs on your own computer (`npm run dev`, with ANTHROPIC_API_KEY in .env). On the
// deployed site it is always switched off, whether or not a key is set there: the Demo
// and the study only use palaces that were built ahead of time.
import { readInput, suggestWithClaude, describeError } from '../lib/palace-ai.js';

const PUBLIC_SITE = !!process.env.VERCEL; // set by Vercel on every deployment
const hasKey = () => !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') return res.status(200).json({ explore: !PUBLIC_SITE, claude: !PUBLIC_SITE && hasKey() });
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Use POST.' });
  }
  if (PUBLIC_SITE) return res.status(403).json({ error: 'Claude is switched off on this site.' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body;
    const out = await suggestWithClaude(readInput(body));
    return res.status(200).json(out);
  } catch (err) {
    const { status, error } = describeError(err);
    if (status >= 500) console.error('suggest api:', err?.name, err?.message);
    return res.status(status).json({ error });
  }
}
