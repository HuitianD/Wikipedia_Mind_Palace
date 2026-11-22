// Sign-in for Explore mode. Explore asks Claude about any article, which costs money,
// so the server only lets signed-in people use it (lib/access.js). This file shows the
// "Sign in with Google" button on the Explore page and keeps the session token.
// Demo mode (the ready-made palaces) and the study never need this sign-in.

const TOKEN_KEY = 'wmp.access.token.v1';
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const store = {
  get() { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set(v) { try { v ? localStorage.setItem(TOKEN_KEY, v) : localStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ } },
};

/**
 * claude: 'unknown' – no answer from the server (plain static hosting): keyword suggestions
 *         'signin'  – Explore needs a Google sign-in
 *         'open'    – no sign-in set up on this computer (local development): Claude is open
 *         'off'     – why 'no_key': no API key, keyword suggestions; why 'no_signin': a
 *                     public site without sign-in set up, so Explore is closed
 */
export const access = { claude: 'unknown', why: null, domains: [], dailyLimit: 0, clientId: '', hd: '', user: null, token: store.get() };

let box = null;
let onChange = () => {};
let problem = '';

async function post(body) {
  const res = await fetch('api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(data?.error || `server returned ${res.status}`), { code: data?.code });
  return data;
}

export const domainText = () => access.domains.map((d) => `@${d}`).join(' or ');
/** True when Explore is waiting for someone to sign in. */
export const needsSignIn = () => access.claude === 'signin' && !access.user;
/** True when this visitor may build a palace from any article. */
export const canExplore = () => !needsSignIn() && !(access.claude === 'off' && access.why === 'no_signin');

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
  onChange();
  if (!box) return;
  box.hidden = access.claude === 'unknown';
  if (access.claude === 'open') {
    box.innerHTML = '<p><strong>Sign-in is off on this computer.</strong> No <code>GOOGLE_CLIENT_ID</code> is set here, so Claude is open to anyone using this server. On the public site, Explore asks for a Brown Google sign-in first.</p>';
    return;
  }
  if (access.claude === 'off') {
    box.innerHTML = access.why === 'no_signin'
      ? '<p><strong>Explore is not open on this site yet.</strong> It needs Google sign-in, which has not been set up here (<code>GOOGLE_CLIENT_ID</code>). The Demo works without it.</p>'
      : '<p><strong>No Claude API key on this server.</strong> You can still build a palace for any article: the setting and objects are then matched by keywords.</p>';
    return;
  }
  if (access.claude !== 'signin') return;
  if (access.user) {
    const left = access.user.remaining;
    box.innerHTML = `
      <p><strong>Signed in as ${esc(access.user.email)}.</strong>
      ${left} of ${access.dailyLimit} Claude request${access.dailyLimit === 1 ? '' : 's'} left today.
      <button type="button" class="link" id="access-out">Sign out</button></p>`;
    box.querySelector('#access-out').addEventListener('click', signOut);
    return;
  }
  box.innerHTML = `
    <p><strong>Sign in to use Explore.</strong> Explore asks Claude to pick the setting and objects for any Wikipedia article,
    so it is open to Brown accounts (${esc(domainText())}). The Demo needs no sign-in.</p>
    <div id="access-button"></div>
    ${problem ? `<p class="error" role="alert">${esc(problem)}</p>` : ''}`;
  try {
    await loadGoogle();
    const slot = box.querySelector('#access-button');
    if (!slot || access.user) return; // re-rendered while the script was loading
    window.google.accounts.id.initialize({ client_id: access.clientId, callback: onCredential, ...(access.hd ? { hd: access.hd } : {}) });
    window.google.accounts.id.renderButton(slot, { type: 'standard', theme: 'outline', size: 'large', text: 'signin_with', shape: 'pill', locale: 'en' });
  } catch (err) {
    const slot = box.querySelector('#access-button');
    if (slot) slot.innerHTML = `<p class="error">${esc(err.message)}</p>`;
  }
}

let loading = null;
/**
 * Ask the server whether Explore needs a sign-in here; resolves when known.
 * `el` is where the sign-in box goes; `changed` is called whenever the answer or the
 * signed-in person changes.
 */
export function loadAccess(el, changed) {
  if (el) box = el;
  if (changed) onChange = changed;
  return (loading ??= post({ action: 'config', token: access.token || undefined })
    .then((cfg) => {
      Object.assign(access, { claude: cfg.claude, why: cfg.why || null, domains: cfg.domains || [], dailyLimit: cfg.dailyLimit || 0, clientId: cfg.clientId || '', hd: cfg.hd || '', user: cfg.user || null });
      if (!access.user && access.token) { access.token = null; store.set(null); } // expired or no longer allowed
    })
    .catch(() => { /* no /api/auth (plain static hosting): leave 'unknown', suggestions fall back as before */ })
    .then(render));
}
