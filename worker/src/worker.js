// Cloudflare Worker relay for the website's "Sign Ups" page.
//
//   Website  ──POST /post,/edit (x-admin-password)──►  posts to Discord as the bot
//   Website  ──GET  /state (public, sanitized)──────►  live view
//   Bot      ──POST /state,/config (x-bot-secret)──►   live state + channel
//   Bot      ──GET  /posted (x-bot-secret)─────────►   hydrate offline-posted sheets
//
// Secrets (wrangler secret put): DISCORD_BOT_TOKEN, ADMIN_POST_PASSWORD, BOT_PUSH_SECRET.
// KV binding: SIGNUPS_KV.  Keys: "config", "state", "posted".

import { postMessage, patchMessage } from "./discord.js";
import { readGearStats } from "./gear.js";

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
    Vary: "Origin",
  };
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
      if (request.headers.get("x-admin-password") !== env.ADMIN_POST_PASSWORD) {
        return json({ error: "Bad password." }, 401, request);
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
      if (request.headers.get("x-admin-password") !== env.ADMIN_POST_PASSWORD) {
        return json({ error: "Bad password." }, 401, request);
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

    // ---- website → profile op (e.g. remove a published screenshot), admin-gated ----
    if (path === "/profile-op" && method === "POST") {
      if (request.headers.get("x-admin-password") !== env.ADMIN_POST_PASSWORD) {
        return json({ error: "Bad password." }, 401, request);
      }
      const body = await readJson(request);
      if (!body?.player || !body?.field) {
        return json({ error: "player + field required." }, 400, request);
      }
      const ops = await getProfileOps(env);
      ops.push({ op: { type: "removeShot", player: body.player, field: body.field }, at: new Date().toISOString() });
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
