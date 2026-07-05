// Cloudflare Worker relay for the website's "Sign Ups" page + Discord OAuth login.
//
//   Website  ──GET  /auth/login,/auth/callback,/auth/me──►  Sign in with Discord (session cookie)
//   Website  ──POST /auth/logout─────────────────────────►  clear session
//   Website  ──POST /post,/edit,/op (session-or-password)──► posts to Discord as the bot
//   Website  ──POST /profile-op (session: admin or own familyName)──► queue a profile edit
//   Website  ──GET  /state (public, sanitized)──────►  live view
//   Bot      ──POST /state,/config,/links (x-bot-secret)──►  live state + channel + link map
//   Bot      ──GET  /posted (x-bot-secret)─────────►   hydrate offline-posted sheets
//
// Secrets (wrangler secret put): DISCORD_BOT_TOKEN, ADMIN_POST_PASSWORD, BOT_PUSH_SECRET,
//   DISCORD_CLIENT_SECRET. Vars: DISCORD_CLIENT_ID, GUILD_ID, ADMIN_ROLE_IDS (mirrors bot/src/config.js).
// KV binding: SIGNUPS_KV.  Keys: "config", "state", "posted", "links", "session:<id>", "oauthstate:<id>".

import { postMessage, patchMessage } from "./discord.js";
import { readGearStats } from "./gear.js";
import {
  buildAuthorizeUrl,
  exchangeCode,
  fetchDiscordUser,
  fetchGuildRoles,
  stashOAuthState,
  consumeOAuthState,
  createSession,
  getSession,
  deleteSession,
  readSessionCookie,
  sessionCookieHeader,
  clearSessionCookieHeader,
  familyNameForDiscordId,
  isAdminRoles,
} from "./auth.js";

const PAGES_ORIGIN = "https://itzdjpsycho-ctrl.github.io";
const MAX_POSTED = 25;

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "";
  const allow =
    origin === PAGES_ORIGIN || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
      ? origin
      : PAGES_ORIGIN;
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, x-admin-password",
    "Access-Control-Allow-Credentials": "true",
    Vary: "Origin",
  };
}

/** Session for this request's cookie, or null if none/expired. */
async function sessionFor(request, env) {
  return getSession(env, readSessionCookie(request));
}

/** True if the request carries either an admin session or the legacy shared password. */
async function isAdminRequest(request, env) {
  if (request.headers.get("x-admin-password") === env.ADMIN_POST_PASSWORD) return true;
  const session = await sessionFor(request, env);
  return Boolean(session?.isAdmin);
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
      const state = await stashOAuthState(env);
      const next = url.searchParams.get("next") || PAGES_ORIGIN;
      // Carried through KV (keyed by state) rather than the URL, so it can't be tampered with in transit.
      await env.SIGNUPS_KV.put(`oauthnext:${state}`, next, { expirationTtl: 600 });
      return Response.redirect(buildAuthorizeUrl(env, state, redirectUri), 302);
    }

    if (path === "/auth/callback" && method === "GET") {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const validState = await consumeOAuthState(env, state);
      const next = (await env.SIGNUPS_KV.get(`oauthnext:${state}`)) || PAGES_ORIGIN;
      await env.SIGNUPS_KV.delete(`oauthnext:${state}`);
      if (!validState || !code) {
        return new Response("Login failed: invalid or expired state.", { status: 400 });
      }

      const redirectUri = `${url.origin}/auth/callback`;
      const exch = await exchangeCode(env, code, redirectUri);
      if (!exch.ok) return new Response("Login failed: could not exchange code with Discord.", { status: 502 });

      const user = await fetchDiscordUser(exch.accessToken);
      if (!user) return new Response("Login failed: could not fetch Discord identity.", { status: 502 });

      const roles = env.GUILD_ID ? await fetchGuildRoles(exch.accessToken, env.GUILD_ID) : [];
      const sessionId = await createSession(env, {
        discordId: user.id,
        username: user.username,
        avatar: user.avatar,
        isAdmin: isAdminRoles(env, roles),
        familyName: await familyNameForDiscordId(env, user.id),
      });

      return new Response(null, {
        status: 302,
        headers: { Location: next, "Set-Cookie": sessionCookieHeader(sessionId) },
      });
    }

    if (path === "/auth/me" && method === "GET") {
      const session = await sessionFor(request, env);
      return json(
        session
          ? { loggedIn: true, discordId: session.discordId, username: session.username, avatar: session.avatar, isAdmin: session.isAdmin, familyName: session.familyName }
          : { loggedIn: false },
        200,
        request
      );
    }

    if (path === "/auth/logout" && method === "POST") {
      await deleteSession(env, readSessionCookie(request));
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders(request), "Set-Cookie": clearSessionCookieHeader() },
      });
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
