// Cloudflare Worker relay for the website's "Sign Ups" page + Discord OAuth login.
//
//   Website  ──GET  /auth/login,/auth/callback,/auth/me──►  Sign in with Discord (X-Session-Id header
//                                                            carrying a signed, stateless token — see
//                                                            auth.js for why it's neither a cookie nor
//                                                            a KV-backed session)
//   Website  ──POST /auth/logout─────────────────────────►  no-op (client just discards its token)
//   Website  ──GET/POST /officers (session-or-password)──►  manage who's an officer, by family name
//   Website  ──POST /post,/edit,/op (session-or-password)──► posts to Discord as the bot
//   Website  ──POST /profile-op (session: admin or own familyName)──► queue a profile edit
//   Website  ──GET  /state (public, sanitized)──────►  live view
//   Bot      ──POST /state,/config,/links (x-bot-secret)──►  live state + channel + link map
//   Bot      ──GET  /posted (x-bot-secret)─────────►   hydrate offline-posted sheets
//
// Secrets (wrangler secret put): DISCORD_BOT_TOKEN, ADMIN_POST_PASSWORD, BOT_PUSH_SECRET,
//   DISCORD_CLIENT_SECRET, SESSION_SECRET (signs the login token — any long random string).
// Vars: DISCORD_CLIENT_ID, GUILD_ID (checked at login — see auth.js isGuildMember; NOT a secret).
// Officers aren't Discord roles — they're a plain list of Discord ids in KV ("officers"),
// managed from the website itself (bootstrap the first one with ADMIN_POST_PASSWORD).
// KV binding: SIGNUPS_KV.  Keys: "config", "state", "posted", "links", "officers".

import { postMessage, patchMessage } from "./discord.js";
import { readGearStats } from "./gear.js";
import {
  buildAuthorizeUrl,
  exchangeCode,
  fetchDiscordUser,
  isGuildMember,
  createOAuthState,
  verifyOAuthState,
  createSessionToken,
  verifyToken,
  readSessionId,
  familyNameForDiscordId,
  getOfficers,
  roleForDiscordId,
  ROLE_RANK,
} from "./auth.js";

const PAGES_ORIGIN = "https://itzdjpsycho-ctrl.github.io";
const MAX_POSTED = 25;
// The legacy shared password outranks every officer role — it's the only way
// to crown/depose a Guild Master, and a break-glass fallback for everything else.
const PASSWORD_RANK = 4;

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "";
  const allow =
    origin === PAGES_ORIGIN || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
      ? origin
      : PAGES_ORIGIN;
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, x-admin-password, x-session-id",
    Vary: "Origin",
  };
}

/** Session for this request's X-Session-Id header, or null if invalid/expired.
 *  role/familyName are resolved fresh from KV on every call (rather than
 *  baked into the token) so promoting an officer or linking an account takes
 *  effect immediately, without needing to sign in again. */
async function sessionFor(request, env) {
  const identity = await verifyToken(env, readSessionId(request));
  if (!identity) return null;
  const [role, familyName] = await Promise.all([
    roleForDiscordId(env, identity.discordId),
    familyNameForDiscordId(env, identity.discordId),
  ]);
  return { ...identity, role, isAdmin: Boolean(role), familyName };
}

/** 0-4: the legacy password outranks every role; a session's rank is its
 *  officer tier (0 if none/not signed in). Used to decide who can post
 *  sign-ups (rank >= 1) vs. who can add/remove which officer tier. */
async function rankFor(request, env) {
  if (request.headers.get("x-admin-password") === env.ADMIN_POST_PASSWORD) return PASSWORD_RANK;
  const session = await sessionFor(request, env);
  return ROLE_RANK[session?.role] || 0;
}

/** True if the request carries any officer-tier session or the legacy shared password. */
async function isAdminRequest(request, env) {
  return (await rankFor(request, env)) >= ROLE_RANK.officer;
}

function withFamilyNames(officers, links) {
  return officers.map((o) => ({ ...o, familyName: links[o.discordId] || null }));
}

function json(data, status, request) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(request) },
  });
}

/** Normalize an inbound sheet payload into the canonical state shape. */
function normalize(payload) {
  let seq = Number(payload.seq) || 0;
  const entries = (payload.entries || []).map((e, i) => {
    const num = Number(e.num) || ++seq;
    if (num > seq) seq = num;
    return {
      num,
      name: String(e.name || "Unknown"),
      status: e.status || "in",
      role: e.role ?? null,
      cls: e.cls ?? null,
    };
  });
  return {
    messageId: payload.messageId || null,
    channelId: payload.channelId || null,
    status: payload.status === "closed" ? "closed" : "open",
    date: payload.date || "",
    time: payload.time || "",
    location: payload.location || "",
    notes: payload.notes || "",
    seq,
    caps: payload.caps && typeof payload.caps === "object" ? payload.caps : {},
    updatedAt: new Date().toISOString(),
    entries,
  };
}

async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

async function getPosted(env) {
  const raw = await env.SIGNUPS_KV.get("posted");
  try { return raw ? JSON.parse(raw) : []; } catch { return []; }
}

async function getOps(env) {
  const raw = await env.SIGNUPS_KV.get("ops");
  try { return raw ? JSON.parse(raw) : []; } catch { return []; }
}

async function getProfileOps(env) {
  const raw = await env.SIGNUPS_KV.get("profileops");
  try { return raw ? JSON.parse(raw) : []; } catch { return []; }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const method = request.method.toUpperCase();

    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    // ---- Discord OAuth login ----
    if (path === "/auth/login" && method === "GET") {
      const redirectUri = `${url.origin}/auth/callback`;
      const next = url.searchParams.get("next") || PAGES_ORIGIN;
      // The `next` URL + a short expiry are signed directly into the OAuth
      // `state` param (CSRF guard) — no KV round-trip needed to recover it.
      const state = await createOAuthState(env, next);
      return Response.redirect(buildAuthorizeUrl(env, state, redirectUri), 302);
    }

    if (path === "/auth/callback" && method === "GET") {
      const code = url.searchParams.get("code");
      const statePayload = await verifyOAuthState(env, url.searchParams.get("state"));
      if (!statePayload || !code) {
        return new Response("Login failed: invalid or expired state.", { status: 400 });
      }
      const next = statePayload.next || PAGES_ORIGIN;

      const redirectUri = `${url.origin}/auth/callback`;
      const exch = await exchangeCode(env, code, redirectUri);
      if (!exch.ok) return new Response("Login failed: could not exchange code with Discord.", { status: 502 });

      const user = await fetchDiscordUser(exch.accessToken);
      if (!user) return new Response("Login failed: could not fetch Discord identity.", { status: 502 });

      if (!(await isGuildMember(exch.accessToken, env.GUILD_ID))) {
        // Any Discord account can complete the OAuth screen — only members of
        // the Purge server get a session out of it. Tell the site why via the
        // same fragment channel the token normally rides back on.
        const separator = next.includes("#") ? "&" : "#";
        return Response.redirect(`${next}${separator}purgeError=not_member`, 302);
      }

      const token = await createSessionToken(env, {
        discordId: user.id,
        username: user.username,
        avatar: user.avatar,
      });

      // The token rides back in the URL fragment (never sent to any server,
      // GitHub Pages included) — assets/auth.js picks it up client-side and
      // stores it, then attaches it as X-Session-Id on future requests.
      const separator = next.includes("#") ? "&" : "#";
      return Response.redirect(`${next}${separator}purgeSession=${token}`, 302);
    }

    if (path === "/auth/me" && method === "GET") {
      const session = await sessionFor(request, env);
      return json(
        session
          ? { loggedIn: true, discordId: session.discordId, username: session.username, avatar: session.avatar, isAdmin: session.isAdmin, role: session.role, familyName: session.familyName }
          : { loggedIn: false },
        200,
        request
      );
    }

    if (path === "/auth/logout" && method === "POST") {
      // Stateless token — nothing to invalidate server-side; the client just
      // discards it (see assets/auth.js). This endpoint exists for symmetry.
      return json({ ok: true }, 200, request);
    }

    // ---- manage the officer list, by family name ----
    // Officers are {discordId, role} in KV, role one of "officer" < "second"
    // (Second in Command) < "guildmaster" (Guild Master) — no Discord role
    // IDs needed. Adding/removing someone requires STRICTLY outranking the
    // role being granted/revoked, so: officers can't touch other officers;
    // Second in Command can add/remove officers but not touch a Guild Master
    // or another Second in Command; only the legacy password can crown or
    // depose a Guild Master. Family names resolve to a Discord id via the
    // "links" map the bot pushes (see /links below), so only players who've
    // run /profile register can hold an officer role.
    if (path === "/officers" && method === "GET") {
      if (!(await isAdminRequest(request, env))) return json({ error: "Not signed in as an officer." }, 401, request);
      const [officers, linksRaw] = await Promise.all([getOfficers(env), env.SIGNUPS_KV.get("links")]);
      const links = linksRaw ? JSON.parse(linksRaw) : {};
      return json({ officers: officers.map((o) => ({ ...o, familyName: links[o.discordId] || null })) }, 200, request);
    }

    if (path === "/officers" && method === "POST") {
      const requesterRank = await rankFor(request, env);
      if (requesterRank < ROLE_RANK.officer) return json({ error: "Not signed in as an officer." }, 401, request);

      const body = await readJson(request);
      if (!body?.familyName || (body.action !== "add" && body.action !== "remove")) {
        return json({ error: "familyName + action(add|remove) required." }, 400, request);
      }
      if (body.action === "add" && !ROLE_RANK[body.role]) {
        return json({ error: "role must be one of officer, second, guildmaster." }, 400, request);
      }

      const linksRaw = await env.SIGNUPS_KV.get("links");
      const links = linksRaw ? JSON.parse(linksRaw) : {};
      const lc = body.familyName.toLowerCase();
      const discordId = Object.keys(links).find((id) => links[id].toLowerCase() === lc);
      if (!discordId) {
        return json({ error: `${body.familyName} hasn't linked a Discord account yet (they need to run /profile register).` }, 404, request);
      }

      const officers = await getOfficers(env);
      const existing = officers.find((o) => o.discordId === discordId);
      if (body.action === "remove" && !existing) {
        return json({ ok: true, officers: withFamilyNames(officers, links) }, 200, request);
      }
      // Adding: must outrank the role being granted. Removing: must outrank
      // whatever role that person currently holds.
      const targetRank = body.action === "add" ? ROLE_RANK[body.role] : ROLE_RANK[existing.role];
      if (requesterRank <= targetRank) {
        return json({ error: "You don't have permission to do that." }, 403, request);
      }

      const next = body.action === "add"
        ? [...officers.filter((o) => o.discordId !== discordId), { discordId, role: body.role }]
        : officers.filter((o) => o.discordId !== discordId);
      await env.SIGNUPS_KV.put("officers", JSON.stringify(next));
      return json({ ok: true, officers: withFamilyNames(next, links) }, 200, request);
    }

    // ---- bot → push the private Discord-id <-> family-name link map (bot-secret gated) ----
    if (path === "/links" && method === "POST") {
      if (request.headers.get("x-bot-secret") !== env.BOT_PUSH_SECRET) {
        return json({ error: "Bad secret." }, 401, request);
      }
      const body = await readJson(request);
      if (!body || typeof body !== "object") return json({ error: "Invalid JSON." }, 400, request);
      await env.SIGNUPS_KV.put("links", JSON.stringify(body));
      return json({ ok: true }, 200, request);
    }

    // ---- public gear-screenshot OCR (no auth, per the guild's choice) ----
    // Reads AP / Awk AP / DP off a gear screenshot via Claude vision. CORS is
    // locked to the site origin and the image is size-capped to limit misuse.
    if (path === "/gear" && method === "POST") {
      if (!env.ANTHROPIC_API_KEY) {
        return json({ error: "Gear reading isn't configured (no ANTHROPIC_API_KEY)." }, 503, request);
      }
      const body = await readJson(request);
      const image = body?.image;
      const mediaType = body?.mediaType || "image/png";
      if (!image || typeof image !== "string") {
        return json({ error: "image (base64) required." }, 400, request);
      }
      if (image.length > 9_000_000) { // ~6.7MB decoded
        return json({ error: "Image too large (max ~6MB)." }, 413, request);
      }
      const r = await readGearStats(image, mediaType, env.ANTHROPIC_API_KEY, env.VISION_MODEL);
      if (!r.ok) return json({ error: r.error || "Couldn't read the screenshot." }, 502, request);
      return json({ ap: r.ap, aap: r.aap, dp: r.dp }, 200, request);
    }

    // ---- public live view ----
    if (path === "/state" && method === "GET") {
      const raw = await env.SIGNUPS_KV.get("state");
      return json(raw ? JSON.parse(raw) : {}, 200, request);
    }

    // ---- website → post / edit (admin-password gated) ----
    if ((path === "/post" || path === "/edit") && method === "POST") {
      if (!(await isAdminRequest(request, env))) {
        return json({ error: "Not signed in as an officer." }, 401, request);
      }
      const body = await readJson(request);
      if (!body) return json({ error: "Invalid JSON." }, 400, request);

      const cfgRaw = await env.SIGNUPS_KV.get("config");
      const cfg = cfgRaw ? JSON.parse(cfgRaw) : {};
      if (!cfg.channelId) {
        return json({ error: "No channel set. An admin must run /signup channel set." }, 428, request);
      }

      const state = normalize(body);
      state.channelId = cfg.channelId;

      let result;
      if (path === "/edit") {
        if (!state.messageId) return json({ error: "messageId required to edit." }, 400, request);
        result = await patchMessage(env.DISCORD_BOT_TOKEN, cfg.channelId, state.messageId, state);
      } else {
        result = await postMessage(env.DISCORD_BOT_TOKEN, cfg.channelId, state);
        if (result.ok) state.messageId = result.data.id;
      }
      if (!result.ok) {
        return json({ error: "Discord rejected the message.", status: result.status, detail: result.data }, 502, request);
      }

      // Seed live state + the posted list (so the bot can hydrate it).
      await env.SIGNUPS_KV.put("state", JSON.stringify(state));
      const posted = await getPosted(env);
      const idx = posted.findIndex((p) => p.messageId === state.messageId);
      const item = { messageId: state.messageId, channelId: cfg.channelId, postedAt: new Date().toISOString(), signup: state };
      if (idx >= 0) posted[idx] = item;
      else posted.unshift(item);
      await env.SIGNUPS_KV.put("posted", JSON.stringify(posted.slice(0, MAX_POSTED)));

      return json({ messageId: state.messageId, channelId: cfg.channelId }, 200, request);
    }

    // ---- website → granular edit op for an already-posted sheet ----
    // Each board change (add/remove/move/status/class) on a posted sheet queues
    // one op; the bot drains + applies them to signups.json so Discord-side
    // self-sign-ups are never overwritten.
    if (path === "/op" && method === "POST") {
      if (!(await isAdminRequest(request, env))) {
        return json({ error: "Not signed in as an officer." }, 401, request);
      }
      const body = await readJson(request);
      if (!body?.messageId || !body?.op?.type || (body.op.type !== "caps" && !body.op.name)) {
        return json({ error: "messageId + op{type,name} required." }, 400, request);
      }
      const ops = await getOps(env);
      ops.push({ messageId: body.messageId, op: body.op, at: new Date().toISOString() });
      await env.SIGNUPS_KV.put("ops", JSON.stringify(ops.slice(-200)));
      return json({ ok: true }, 200, request);
    }

    // ---- website → profile op (remove a screenshot / set class / set stats) ----
    // Admins can edit anyone's profile; a signed-in player (session.familyName
    // matches body.player) can edit their own.
    if (path === "/profile-op" && method === "POST") {
      const body = await readJson(request);
      if (!body?.player) return json({ error: "player required." }, 400, request);

      const opType = body.op?.type || (body.field ? "removeShot" : null);
      const opBody = body.op || { field: body.field };
      if (!opType) return json({ error: "op.type required." }, 400, request);
      if (opType === "removeShot" && !opBody.field) {
        return json({ error: "op.field required for removeShot." }, 400, request);
      }
      if (opType === "setClass" && !opBody.className) {
        return json({ error: "op.className required for setClass." }, 400, request);
      }
      if (opType === "setStats" && opBody.ap == null && opBody.aap == null && opBody.dp == null) {
        return json({ error: "op needs at least one of ap/aap/dp." }, 400, request);
      }
      if (opType === "setFlags" && typeof opBody.vacation !== "boolean" && typeof opBody.exception !== "boolean") {
        return json({ error: "op needs at least one of vacation/exception (boolean)." }, 400, request);
      }

      const admin = await isAdminRequest(request, env);
      let owner = false;
      if (!admin) {
        const session = await sessionFor(request, env);
        owner = Boolean(session?.familyName) && session.familyName.toLowerCase() === String(body.player).toLowerCase();
      }
      if (!admin && !owner) {
        return json({ error: "Not signed in as an officer or as this player." }, 401, request);
      }

      const ops = await getProfileOps(env);
      ops.push({ op: { type: opType, player: body.player, ...opBody }, at: new Date().toISOString() });
      await env.SIGNUPS_KV.put("profileops", JSON.stringify(ops.slice(-200)));
      return json({ ok: true }, 200, request);
    }

    // ---- bot → state / config / posted / ops (bot-secret gated) ----
    const botAuthed = request.headers.get("x-bot-secret") === env.BOT_PUSH_SECRET;

    if (path === "/state" && method === "POST") {
      if (!botAuthed) return json({ error: "Bad secret." }, 401, request);
      const body = await readJson(request);
      if (!body) return json({ error: "Invalid JSON." }, 400, request);
      const state = normalize(body);
      state.messageId = body.messageId || null;
      await env.SIGNUPS_KV.put("state", JSON.stringify(state));
      // Keep the posted mirror in step so hydration reflects live edits.
      if (state.messageId) {
        const posted = await getPosted(env);
        const idx = posted.findIndex((p) => p.messageId === state.messageId);
        if (idx >= 0) { posted[idx].signup = state; await env.SIGNUPS_KV.put("posted", JSON.stringify(posted)); }
      }
      return json({ ok: true }, 200, request);
    }

    if (path === "/config" && method === "POST") {
      if (!botAuthed) return json({ error: "Bad secret." }, 401, request);
      const body = await readJson(request);
      if (!body?.channelId) return json({ error: "channelId required." }, 400, request);
      await env.SIGNUPS_KV.put("config", JSON.stringify({ channelId: body.channelId, updatedAt: new Date().toISOString() }));
      return json({ ok: true }, 200, request);
    }

    if (path === "/posted" && method === "GET") {
      if (!botAuthed) return json({ error: "Bad secret." }, 401, request);
      return json({ posted: await getPosted(env) }, 200, request);
    }

    // Drain the pending op queue (read + clear) for the bot to apply.
    if (path === "/ops" && method === "GET") {
      if (!botAuthed) return json({ error: "Bad secret." }, 401, request);
      const ops = await getOps(env);
      if (ops.length) await env.SIGNUPS_KV.put("ops", "[]");
      return json({ ops }, 200, request);
    }

    // Drain the pending profile-op queue for the bot to apply.
    if (path === "/profile-ops" && method === "GET") {
      if (!botAuthed) return json({ error: "Bad secret." }, 401, request);
      const ops = await getProfileOps(env);
      if (ops.length) await env.SIGNUPS_KV.put("profileops", "[]");
      return json({ ops }, 200, request);
    }

    return json({ error: "Not found." }, 404, request);
  },
};
