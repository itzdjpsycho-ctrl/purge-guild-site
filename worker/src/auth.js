// Discord OAuth login for the website — "Sign in with Discord" against the
// same Discord application the bot uses (adds an OAuth2 redirect URI there,
// no new app).
//
// Sessions are a signed, stateless token (HMAC-SHA256 over the payload with
// SESSION_SECRET) — NOT a KV-backed lookup and NOT a cookie:
//   - Not a cookie: the site (github.io) and this Worker (workers.dev) are
//     different domains, and browsers increasingly refuse to store/send
//     third-party SameSite=None cookies (Safari and Brave block them
//     outright). The token instead rides back once in the OAuth redirect's
//     URL fragment, gets stashed in localStorage, and is attached explicitly
//     as the X-Session-Id header on every request.
//   - Not KV-backed: Workers KV is only *eventually* consistent — a value
//     written at one Cloudflare edge can take up to ~60s to appear at
//     another. A KV-backed session looked fine on the page you signed in on,
//     then vanished the moment you navigated (new request, different edge,
//     KV write hadn't propagated yet). Verifying a signature needs no
//     storage read at all, so this can't happen.
// The token only carries Discord identity (discordId/username/avatar) since
// that never changes mid-session; officer status and family-name link are
// looked up fresh from KV on every request instead of being baked into the
// token, so promoting/demoting an officer or linking an account takes effect
// immediately — no re-login needed.

const API = "https://discord.com/api/v10";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — "stay signed in until I sign out"
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes, just long enough for the redirect round-trip

export function buildAuthorizeUrl(env, state, redirectUri) {
  const params = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "identify",
    state,
  });
  return `https://discord.com/oauth2/authorize?${params}`;
}

export async function exchangeCode(env, code, redirectUri) {
  const body = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    client_secret: env.DISCORD_CLIENT_SECRET,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });
  const res = await fetch(`${API}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.access_token) return { ok: false, error: data };
  return { ok: true, accessToken: data.access_token };
}

export async function fetchDiscordUser(accessToken) {
  const res = await fetch(`${API}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  return res.json();
}

// ---- signed, stateless tokens (used for both the session and the OAuth `state`) ----

function b64urlEncode(bytes) {
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function hmacKey(env) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.SESSION_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

async function signBody(env, bodyB64) {
  const key = await hmacKey(env);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(bodyB64));
  return b64urlEncode(new Uint8Array(sig));
}

/** Sign an arbitrary JSON-able payload into a compact, tamper-proof token. */
export async function createToken(env, payload) {
  const body = b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await signBody(env, body);
  return `${body}.${sig}`;
}

/** Verify + decode a token from createToken(), or null if invalid/tampered/expired. */
export async function verifyToken(env, token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const expectedSig = await signBody(env, body);
  if (sig !== expectedSig) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body)));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export function readSessionId(request) {
  return request.headers.get("X-Session-Id") || null;
}

/** Signed `next` URL + short expiry, passed as the OAuth `state` param (CSRF guard). */
export function createOAuthState(env, next) {
  return createToken(env, { next, nonce: crypto.randomUUID(), exp: Date.now() + STATE_TTL_MS });
}

export function verifyOAuthState(env, state) {
  return verifyToken(env, state);
}

export function createSessionToken(env, { discordId, username, avatar }) {
  return createToken(env, { discordId, username, avatar, exp: Date.now() + SESSION_TTL_MS });
}

// ---- KV-backed data that's expected to change independently of login (so it's
// looked up fresh on every request instead of baked into the session token) ----

/** Look up the family name linked to a Discord user id, via the bot's pushed link map. */
export async function familyNameForDiscordId(env, discordId) {
  const raw = await env.SIGNUPS_KV.get("links");
  if (!raw) return null;
  try {
    const map = JSON.parse(raw);
    return map[discordId] || null;
  } catch {
    return null;
  }
}

/** Officers are a plain list of Discord ids, managed from the website itself
 *  (see worker.js GET/POST /officers) — no Discord role IDs needed. */
export async function getOfficerIds(env) {
  const raw = await env.SIGNUPS_KV.get("officers");
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export async function isOfficer(env, discordId) {
  const ids = await getOfficerIds(env);
  return ids.includes(discordId);
}
