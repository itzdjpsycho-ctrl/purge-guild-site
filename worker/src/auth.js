// Discord OAuth login for the website — "Sign in with Discord" against the
// same Discord application the bot uses (adds an OAuth2 redirect URI there,
// no new app). Sessions live in SIGNUPS_KV; the site holds only an opaque
// session id (never the Discord access token), sent back as the X-Session-Id
// header — NOT a cookie, since the site (github.io) and this Worker
// (workers.dev) are different domains and browsers increasingly refuse to
// store/send third-party SameSite=None cookies (Safari and Brave block them
// outright). A header the client attaches explicitly sidesteps that entirely.

const API = "https://discord.com/api/v10";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days
const STATE_TTL_SECONDS = 60 * 10; // 10 minutes, just long enough for the redirect round-trip

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

function randomId() {
  return crypto.randomUUID();
}

export async function stashOAuthState(env) {
  const state = randomId();
  await env.SIGNUPS_KV.put(`oauthstate:${state}`, "1", { expirationTtl: STATE_TTL_SECONDS });
  return state;
}

export async function consumeOAuthState(env, state) {
  if (!state) return false;
  const key = `oauthstate:${state}`;
  const found = await env.SIGNUPS_KV.get(key);
  if (!found) return false;
  await env.SIGNUPS_KV.delete(key);
  return true;
}

export async function createSession(env, { discordId, username, avatar, isAdmin, familyName }) {
  const id = randomId();
  const session = { discordId, username, avatar, isAdmin, familyName: familyName || null, createdAt: new Date().toISOString() };
  await env.SIGNUPS_KV.put(`session:${id}`, JSON.stringify(session), { expirationTtl: SESSION_TTL_SECONDS });
  return id;
}

export async function getSession(env, id) {
  if (!id) return null;
  const raw = await env.SIGNUPS_KV.get(`session:${id}`);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export async function deleteSession(env, id) {
  if (!id) return;
  await env.SIGNUPS_KV.delete(`session:${id}`);
}

export function readSessionId(request) {
  return request.headers.get("X-Session-Id") || null;
}

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
