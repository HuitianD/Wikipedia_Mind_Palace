// Vercel serverless function: POST /api/study
// Body: { action, ... }. Actions: status, signin, resume, start, sync, end (participants)
// and admin_list, admin_delete (research team, with the STUDY_ADMIN_KEY).
// Set MONGODB_URI and STUDY_ADMIN_KEY in the Vercel project's environment variables.
import { handleStudy, HttpError } from '../lib/study-api.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Use POST.' });
  }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body;
    return res.status(200).json(await handleStudy(body || {}));
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err instanceof SyntaxError) return res.status(400).json({ error: 'Invalid JSON.' });
    console.error('study api:', err?.name, err?.message); // never the request body: it holds personal data
    return res.status(500).json({ error: 'The study server could not save or load the data. Please try again.' });
  }
}
