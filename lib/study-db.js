// Server-side storage for study sessions (MongoDB). Used by api/study.js.
//   MONGODB_URI   connection string, e.g. from MongoDB Atlas. Without it the study runs
//                 in "this browser only" mode and nothing here is used.
//   MONGODB_DB    database name (default: mind_palace)
// One document per participant in `sessions`; `counters` hands out P01, P02, ...
import { MongoClient } from 'mongodb';

let connecting = null;

export const dbConfigured = () => !!process.env.MONGODB_URI;

async function connect() {
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000, maxPoolSize: 5 });
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'mind_palace');
  const sessions = db.collection('sessions');
  // one session per email address; tokens are looked up on every request
  await sessions.createIndex({ emailKey: 1 }, { unique: true });
  await sessions.createIndex({ tokenHashes: 1 });
  return { sessions, counters: db.collection('counters') };
}

/** The collections, connecting on first use. The connection is reused between requests. */
export function collections() {
  if (!connecting) connecting = connect().catch((err) => { connecting = null; throw err; });
  return connecting;
}
