// Sign-in for Claude's suggestions (Explore mode). The server decides who may use
// Claude (lib/access.js); this file shows the "Sign in with Google" button on the
// start page and keeps the session token. Ready-made palaces and keyword suggestions
// never need a sign-in.

const TOKEN_KEY = 'wmp.access.token.v1';
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const store = {
  get() { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set(v) { try { v ? localStorage.setItem(TOKEN_KEY, v) : localStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ } },
};

/** claude: 'unknown' (no server answer yet / static hosting) | 'off' | 'open' | 'signin' */
export const access = { claude: 'unknown', domains: [], dailyLimit: 0, clientId: '', hd: '', user: null, token: store.get() };

let box = null;
let problem = '';

async function post(body) {
  const res = await fetch('api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(data?.error || `server returned ${res.status}`), { code: data?.code });
  return data;
}

export const domainText = () => access.domains.map((d) => `@${d}`).join(' or ');
/** True when Claude would refuse because nobody is signed in. */
export const needsSignIn = () => access.claude === 'signin' && !access.user;

export function signOut() {
  access.user = null;
  access.token = null;
  store.set(null);
  try { window.google?.accounts.id.disableAutoSelect(); } catch { /* not loaded */ }
  render();
}

/** The server said the session is no longer valid. */
export function sessionExpired() {
  if (access.user) signOut();
}

export function setRemaining(n) {
  if (access.user && Number.isFinite(n)) { access.user.remaining = n; render(); }
}

let googleScript = null;
const loadGoogle = () => (googleScript ??= new Promise((resolve, reject) => {
  const s = document.createElement('script');
  s.src = 'https://accounts.google.com/gsi/client';
  s.async = true;
  s.onload = resolve;
  s.onerror = () => { googleScript = null; reject(new Error('Could not load Google sign-in.')); };
  document.head.append(s);
}));

async function onCredential(response) {
  problem = '';
  try {
    const r = await post({ action: 'google', credential: response.credential });
    access.token = r.token;
    access.user = r.user;
    store.set(r.token);
  } catch (err) {
    problem = err.message;
  }
  render();
}

async function render() {
  if (!box) return;
  if (access.claude !== 'signin') { box.hidden = true; return; }
  box.hidden = false;
  if (access.user) {
    const left = access.user.remaining;
    box.innerHTML = `
      <p><strong>Signed in as ${esc(access.user.email)}.</strong> Claude picks the setting and objects for any article
      (${left} of ${access.dailyLimit} request${access.dailyLimit === 1 ? '' : 's'} left today).
      <button type="button" class="link" id="access-out">Sign out</button></p>`;
    box.querySelector('#access-out').addEventListener('click', signOut);
    return;
  }
  box.innerHTML = `
    <p><strong>Any other article:</strong> sign in with a Brown account (${esc(domainText())}) and Claude picks the setting and objects.
    Without signing in, objects are matched by keywords. The ready-made palaces are open to everyone.</p>
    <div id="access-button"></div>
    ${problem ? `<p class="error" role="alert">${esc(problem)}</p>` : ''}`;
  try {
    await loadGoogle();
    const slot = box.querySelector('#access-button');
    if (!slot || access.user) return; // re-rendered while the script was loading
    window.google.accounts.id.initialize({ client_id: access.clientId, callback: onCredential, ...(access.hd ? { hd: access.hd } : {}) });
    window.google.accounts.id.renderButton(slot, { type: 'standard', theme: 'outline', size: 'medium', text: 'signin_with', shape: 'pill', locale: 'en' });
  } catch (err) {
    const slot = box.querySelector('#access-button');
    if (slot) slot.innerHTML = `<p class="error">${esc(err.message)}</p>`;
  }
}

let loading = null;
/** Ask the server whether Claude needs a sign-in here; resolves when known. */
export function loadAccess(el) {
  if (el) box = el;
  return (loading ??= post({ action: 'config', token: access.token || undefined })
    .then((cfg) => {
      Object.assign(access, { claude: cfg.claude, domains: cfg.domains || [], dailyLimit: cfg.dailyLimit || 0, clientId: cfg.clientId || '', hd: cfg.hd || '', user: cfg.user || null });
      if (!access.user && access.token) { access.token = null; store.set(null); } // expired or no longer allowed
    })
    .catch(() => { /* no /api/auth (plain static hosting): leave 'unknown', suggestions fall back as before */ })
    .then(render));
}
