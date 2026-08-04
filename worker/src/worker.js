// Cloudflare Worker relay for the website's "Sign Ups" page + Discord OAuth login.
//
//   Website  ──GET  /auth/login,/auth/callback,/auth/me──►  Sign in with Discord (X-Session-Id header
//                                                            carrying a signed, stateless token — see
//                                                            auth.js for why it's neither a cookie nor
//                                                            a KV-backed session)
//   Website  ──POST /auth/logout─────────────────────────►  no-op (client just discards its token)
//   Website  ──GET/POST /officers (session-or-password)──►  manage who's an officer, by family name
//   Website  ──GET/POST /presets (session-or-password)──►  save/load named role-cap presets
//   Website  ──POST /post,/edit,/op (session-or-password)──► posts to Discord as the bot
//   Website  ──POST /war (public, origin-locked)──────►  Claude vision reads a war result screenshot
//   Website  ──GET  /state (public, sanitized)──────►  live view
//   Bot      ──POST /state,/config,/links (x-bot-secret)──►  live state + channel + link map
//   Bot      ──POST /state/clear (x-bot-secret)──────►  wipe live state after auto-deleting a sheet
//   Bot      ──GET  /posted (x-bot-secret)─────────►   hydrate offline-posted sheets
//
// ---- D1-backed guild data (formerly data.js/profiles.js/attendance.js — see worker/src/data.js) ----
//   Website  ──GET  /data.js,/profiles.js,/attendance.js (public)──► served as literal JS, drop-in
//                                                            replacement for the old committed files
//   DELETE /matches/:date (officer or x-bot-secret)───►  delete a war, takes effect immediately
//   POST /matches (officer or x-bot-secret)───►  add/replace a war (website manual entry or /addwar)
//   POST /profiles/:name (admin/owner or x-bot-secret; setImage is bot-only)──► apply a profile edit
//   POST /merge (officer-only)──────►  combine two players' entire history (website Merge Stats) —
//                                       also queues a "renameLink" op onto "mergeops" KV for the bot
//                                       to pick up (GET /merge-ops, x-bot-secret), since the private
//                                       Discord-link map only exists on the bot host.
//   POST /roster (x-bot-secret)──────►  replace rosterMembers wholesale (/roster sync)
//   POST /attendance (x-bot-secret)──►  push a freshly-computed attendance summary
//
// ---- VOD Review (D1-backed: vods, vod_notes) ----
//   GET  /vods (public)──────────────►  list every posted VOD (+ note count)
//   POST /vods (any signed-in member)──►  post a YouTube link {title, youtubeUrl}
//   GET  /vods/:id (public)──────────►  one VOD + its timestamped notes
//   DELETE /vods/:id (officer or poster)──►  delete a VOD + all its notes
//   POST /vods/:id/notes (any signed-in member)──►  add a timestamped note, optionally with a drawing
//   DELETE /vods/:id/notes/:noteId (officer or note author)──►  delete a note
//
// Secrets (wrangler secret put): DISCORD_BOT_TOKEN, ADMIN_POST_PASSWORD, BOT_PUSH_SECRET,
//   DISCORD_CLIENT_SECRET, SESSION_SECRET (signs the login token — any long random string).
// Vars: DISCORD_CLIENT_ID, GUILD_ID (checked at login — see auth.js isGuildMember; NOT a secret).
// Officers aren't Discord roles — they're a plain list of Discord ids in KV ("officers"),
// managed from the website itself (bootstrap the first one with ADMIN_POST_PASSWORD).
// KV binding: SIGNUPS_KV.  Keys: "config", "state", "posted", "links", "officers", "presets",
//   "ops" (sign-up board edits), "mergeops" (pending Discord-link renames after a merge — see /merge).
// D1 binding: DB ("purge-guild-db").  Tables: matches, extended_stats, roster_members, profiles,
//   attendance, vods, vod_notes (see worker/schema.sql).

import { postMessage, patchMessage } from "./discord.js";
import { readGearStats } from "./gear.js";
import { readWar } from "./war.js";
import {
  buildGuildData,
  buildProfiles,
  buildAttendance,
  addOrReplaceMatch,
  removeMatch,
  mergeMatchNames,
  setRosterMembers,
  setProfileClass,
  setProfileImage,
  removeProfileImage,
  setProfileGear,
  setProfileFlags,
  mergeProfileRows,
  setAttendance,
  youtubeIdFromUrl,
  listVods,
  getVod,
  getVodOwner,
  getVodNoteOwner,
  createVod,
  deleteVod,
  addVodNote,
  deleteVodNote,
} from "./data.js";
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
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
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

/** Serve a D1-backed global as literal JS — a byte-shape drop-in replacement
 *  for the site's old `<script src="data.js">` etc., so pages keep loading it
 *  the exact same (synchronous, parser-blocking) way. See worker/src/data.js. */
function jsResponse(globalName, data, request) {
  return new Response(`window.${globalName} = ${JSON.stringify(data)};`, {
    status: 200,
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-cache",
      ...corsHeaders(request),
    },
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

async function getMergeOps(env) {
  const raw = await env.SIGNUPS_KV.get("mergeops");
  try { return raw ? JSON.parse(raw) : []; } catch { return []; }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const method = request.method.toUpperCase();
    const botAuthed = request.headers.get("x-bot-secret") === env.BOT_PUSH_SECRET;

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

    // ---- role-cap presets, shared across officers — each war may need a
    // different number of each role, so officers save/load named cap sets
    // instead of retyping them. Gated the same as /officers (admin-tier). ----
    if (path === "/presets" && method === "GET") {
      if (!(await isAdminRequest(request, env))) return json({ error: "Not signed in as an officer." }, 401, request);
      const raw = await env.SIGNUPS_KV.get("presets");
      return json({ presets: raw ? JSON.parse(raw) : [] }, 200, request);
    }

    if (path === "/presets" && method === "POST") {
      if (!(await isAdminRequest(request, env))) return json({ error: "Not signed in as an officer." }, 401, request);
      const body = await readJson(request);
      if (!body?.name || (body.action !== "save" && body.action !== "delete")) {
        return json({ error: "name + action(save|delete) required." }, 400, request);
      }
      const raw = await env.SIGNUPS_KV.get("presets");
      const presets = raw ? JSON.parse(raw) : [];
      const lc = body.name.trim().toLowerCase();
      const idx = presets.findIndex((p) => p.name.toLowerCase() === lc);

      if (body.action === "delete") {
        if (idx >= 0) presets.splice(idx, 1);
      } else {
        if (!body.caps || typeof body.caps !== "object") {
          return json({ error: "caps required to save." }, 400, request);
        }
        const item = { name: body.name.trim(), caps: body.caps, updatedAt: new Date().toISOString() };
        if (idx >= 0) presets[idx] = item;
        else presets.push(item);
      }
      presets.sort((a, b) => a.name.localeCompare(b.name));
      await env.SIGNUPS_KV.put("presets", JSON.stringify(presets));
      return json({ ok: true, presets }, 200, request);
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

    // ---- public war-result OCR (no auth, per the guild's choice) ----
    // Reads a full Node War result (date/location/result + every player's
    // stats) off 1-4 screenshots via Claude vision. CORS is locked to the
    // site origin and the images are size-capped to limit misuse.
    if (path === "/war" && method === "POST") {
      if (!env.ANTHROPIC_API_KEY) {
        return json({ error: "War reading isn't configured (no ANTHROPIC_API_KEY)." }, 503, request);
      }
      const body = await readJson(request);
      const images = body?.images;
      if (!Array.isArray(images) || !images.length) {
        return json({ error: "images (array of {base64,mediaType}) required." }, 400, request);
      }
      if (images.length > 4) {
        return json({ error: "Max 4 screenshots at a time." }, 400, request);
      }
      const totalLen = images.reduce((sum, im) => sum + (im?.base64?.length || 0), 0);
      if (totalLen > 28_000_000) { // ~21MB decoded across all images
        return json({ error: "Images too large (max ~20MB total)." }, 413, request);
      }
      const r = await readWar(images, env.ANTHROPIC_API_KEY, env.VISION_MODEL);
      if (!r.ok) return json({ error: r.error === "no-key" ? "War reading isn't configured." : (r.error || "Couldn't read the screenshots.") }, 502, request);
      return json({ war: r.war }, 200, request);
    }

    // ---- public live view ----
    if (path === "/state" && method === "GET") {
      const raw = await env.SIGNUPS_KV.get("state");
      return json(raw ? JSON.parse(raw) : {}, 200, request);
    }

    // ---- public: canonical guild data, D1-backed, served as literal JS ----
    // Drop-in replacements for the old committed data.js/profiles.js/
    // attendance.js — pages point their existing document.write script-tag
    // load at these instead, so no page-side rendering code needs to change.
    if (path === "/data.js" && method === "GET") {
      return jsResponse("GUILD_DATA", await buildGuildData(env), request);
    }
    if (path === "/profiles.js" && method === "GET") {
      return jsResponse("GUILD_PROFILES", await buildProfiles(env), request);
    }
    if (path === "/attendance.js" && method === "GET") {
      return jsResponse("GUILD_ATTENDANCE", await buildAttendance(env), request);
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

    // ---- apply a profile edit directly to D1 (officer, the player editing
    // their own profile, or the bot on their behalf) ----
    const profileMatch = path.match(/^\/profiles\/(.+)$/);
    if (profileMatch && method === "POST") {
      const player = decodeURIComponent(profileMatch[1]);
      const body = await readJson(request);

      const opType = body?.op?.type || (body?.field ? "removeShot" : null);
      const opBody = body?.op || { field: body?.field };
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
      if (opType === "setImage" && (!opBody.slotKey || !opBody.path)) {
        return json({ error: "op.slotKey + op.path required for setImage." }, 400, request);
      }

      // setImage is bot-only — it's set right after the bot commits the actual
      // screenshot file to git (assets/profiles/), which only the bot can do.
      if (opType === "setImage" && !botAuthed) {
        return json({ error: "setImage is bot-only." }, 401, request);
      }

      const admin = await isAdminRequest(request, env);
      let owner = false;
      if (!admin && !botAuthed) {
        const session = await sessionFor(request, env);
        owner = Boolean(session?.familyName) && session.familyName.toLowerCase() === player.toLowerCase();
      }
      if (!admin && !owner && !botAuthed) {
        return json({ error: "Not signed in as an officer or as this player." }, 401, request);
      }

      let result;
      if (opType === "removeShot") result = { removedPath: await removeProfileImage(env, player, opBody.field) };
      else if (opType === "setClass") result = { ok: await setProfileClass(env, player, opBody.className) };
      else if (opType === "setStats") result = await setProfileGear(env, player, opBody);
      else if (opType === "setFlags") result = await setProfileFlags(env, player, opBody);
      else if (opType === "setImage") result = { prevPath: await setProfileImage(env, player, opBody.slotKey, opBody.path) };
      else return json({ error: `Unknown op.type "${opType}".` }, 400, request);

      return json({ ok: true, result }, 200, request);
    }

    // ---- delete a war directly from D1 ----
    // Officer session (website's "Remove This War") OR bot-secret (the
    // Discord /removewar flow) — takes effect immediately, no git commit,
    // no wait for GitHub Pages to redeploy.
    const matchDateMatch = path.match(/^\/matches\/(.+)$/);
    if (matchDateMatch && method === "DELETE") {
      if (!botAuthed && !(await isAdminRequest(request, env))) {
        return json({ error: "Not signed in as an officer." }, 401, request);
      }
      const result = await removeMatch(env, decodeURIComponent(matchDateMatch[1]));
      return json(result, 200, request);
    }

    // ---- add/replace a war directly in D1 ----
    // Officer session (manual/website entry) OR bot-secret (the Discord
    // /addwar flow, after its own OCR + officer Confirm in Discord).
    if (path === "/matches" && method === "POST") {
      if (!botAuthed && !(await isAdminRequest(request, env))) {
        return json({ error: "Not signed in as an officer." }, 401, request);
      }
      const body = await readJson(request);
      const war = body?.war;
      if (!war?.date || !Array.isArray(war?.players)) {
        return json({ error: "war.date + war.players[] required." }, 400, request);
      }
      const result = await addOrReplaceMatch(env, war);
      return json(result, 200, request);
    }

    // ---- website → merge two names directly in D1 (officer-only) ----
    // Doesn't touch attendance (see worker/src/data.js mergeProfileRows() doc
    // comment) — only the bot's signups.json cross-reference can recompute
    // that correctly, and the next /addwar or /removewar naturally does.
    // Also can't touch the private Discord-id<->family-name link (bot/data/
    // links.json lives only on the bot host) — queues a lightweight
    // "renameLink" op onto the (otherwise-retired) mergeops list so the bot's
    // small link-sync poller (bot/src/lib/link-sync.js) can pick it up.
    if (path === "/merge" && method === "POST") {
      if (!(await isAdminRequest(request, env))) {
        return json({ error: "Not signed in as an officer." }, 401, request);
      }
      const body = await readJson(request);
      const op = body?.op;
      if (op?.type !== "mergeNames" || !op.from || !op.to) {
        return json({ error: "op.type 'mergeNames' + op.from + op.to required." }, 400, request);
      }
      if (String(op.from).toLowerCase() === String(op.to).toLowerCase()) {
        return json({ error: "from and to must be different names." }, 400, request);
      }

      const [matchResult, profileResult] = await Promise.all([
        mergeMatchNames(env, op.from, op.to),
        mergeProfileRows(env, op.from, op.to),
      ]);

      const linkOps = await getMergeOps(env);
      linkOps.push({ op: { type: "renameLink", from: op.from, to: op.to }, at: new Date().toISOString() });
      await env.SIGNUPS_KV.put("mergeops", JSON.stringify(linkOps.slice(-200)));

      return json({ ok: true, ...matchResult, ...profileResult }, 200, request);
    }

    // ---- bot → state / config / posted / ops (bot-secret gated) ----

    // Bot → replace rosterMembers wholesale in D1, after /roster sync's
    // Playwright scrape + Discord Confirm. Bot-secret gated (not officer
    // session) since this is always bot-initiated, never a website action.
    if (path === "/roster" && method === "POST") {
      if (!botAuthed) return json({ error: "Bad secret." }, 401, request);
      const body = await readJson(request);
      if (!Array.isArray(body?.names)) return json({ error: "names[] required." }, 400, request);
      const result = await setRosterMembers(env, body.names);
      return json(result, 200, request);
    }

    // Bot → push a freshly-computed attendance summary into D1. Only the bot
    // can compute this (it cross-references its private signups.json against
    // data.js/D1 matches) — the Worker just stores the wholesale result.
    if (path === "/attendance" && method === "POST") {
      if (!botAuthed) return json({ error: "Bad secret." }, 401, request);
      const body = await readJson(request);
      if (!body?.summary || typeof body.summary !== "object") {
        return json({ error: "summary required." }, 400, request);
      }
      await setAttendance(env, body.summary);
      return json({ ok: true }, 200, request);
    }

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

    // Bot → clear the live-view state after deleting a sign-up's Discord
    // message (auto-expiry cleanup), so the website stops showing a stale
    // sheet. Only clears if the stored state still points at that same
    // message — guards against a race with a newer sheet already posted.
    if (path === "/state/clear" && method === "POST") {
      if (!botAuthed) return json({ error: "Bad secret." }, 401, request);
      const body = await readJson(request);
      const raw = await env.SIGNUPS_KV.get("state");
      const current = raw ? JSON.parse(raw) : null;
      if (!body?.messageId || !current || current.messageId === body.messageId) {
        await env.SIGNUPS_KV.put("state", JSON.stringify({}));
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

    // Drain pending "renameLink" ops queued by /merge above (see link-sync.js).
    if (path === "/merge-ops" && method === "GET") {
      if (!botAuthed) return json({ error: "Bad secret." }, 401, request);
      const ops = await getMergeOps(env);
      if (ops.length) await env.SIGNUPS_KV.put("mergeops", "[]");
      return json({ ops }, 200, request);
    }

    // ---- VOD Review: public reads, any signed-in member can post/note, ----
    // ---- officer or the original poster/author can delete. ----

    if (path === "/vods" && method === "GET") {
      return json({ vods: await listVods(env) }, 200, request);
    }

    if (path === "/vods" && method === "POST") {
      const session = await sessionFor(request, env);
      if (!session) return json({ error: "Sign in with Discord to post a VOD." }, 401, request);
      const body = await readJson(request);
      const title = String(body?.title || "").trim().slice(0, 200);
      const youtubeId = youtubeIdFromUrl(body?.youtubeUrl);
      if (!title) return json({ error: "title required." }, 400, request);
      if (!youtubeId) return json({ error: "Couldn't find a YouTube video in that URL." }, 400, request);
      const vod = await createVod(env, {
        title,
        youtubeId,
        authorName: session.familyName || session.username,
        authorDiscordId: session.discordId,
      });
      return json({ vod }, 200, request);
    }

    const vodDetailMatch = path.match(/^\/vods\/([^/]+)$/);
    if (vodDetailMatch && method === "GET") {
      const data = await getVod(env, vodDetailMatch[1]);
      if (!data) return json({ error: "VOD not found." }, 404, request);
      return json(data, 200, request);
    }

    if (vodDetailMatch && method === "DELETE") {
      const ownerId = await getVodOwner(env, vodDetailMatch[1]);
      if (ownerId === null) return json({ error: "VOD not found." }, 404, request);
      const session = await sessionFor(request, env);
      const isOwner = Boolean(session) && session.discordId === ownerId;
      if (!isOwner && !(await isAdminRequest(request, env))) {
        return json({ error: "Not signed in as an officer or as the poster." }, 401, request);
      }
      return json(await deleteVod(env, vodDetailMatch[1]), 200, request);
    }

    const vodNotesMatch = path.match(/^\/vods\/([^/]+)\/notes$/);
    if (vodNotesMatch && method === "POST") {
      const session = await sessionFor(request, env);
      if (!session) return json({ error: "Sign in with Discord to add a note." }, 401, request);
      const body = await readJson(request);
      const timestampSeconds = Number(body?.timestampSeconds);
      const text = String(body?.text || "").trim().slice(0, 2000);
      const drawing = body?.drawing || null;
      if (!Number.isFinite(timestampSeconds) || timestampSeconds < 0) {
        return json({ error: "timestampSeconds required." }, 400, request);
      }
      if (!text && !drawing) return json({ error: "text or drawing required." }, 400, request);
      if (drawing && JSON.stringify(drawing).length > 60_000) {
        return json({ error: "Drawing too large." }, 413, request);
      }
      const note = await addVodNote(env, vodNotesMatch[1], {
        timestampSeconds,
        text,
        drawing,
        authorName: session.familyName || session.username,
        authorDiscordId: session.discordId,
      });
      if (!note) return json({ error: "VOD not found." }, 404, request);
      return json({ note }, 200, request);
    }

    const vodNoteMatch = path.match(/^\/vods\/([^/]+)\/notes\/([^/]+)$/);
    if (vodNoteMatch && method === "DELETE") {
      const ownerId = await getVodNoteOwner(env, vodNoteMatch[1], vodNoteMatch[2]);
      if (ownerId === null) return json({ error: "Note not found." }, 404, request);
      const session = await sessionFor(request, env);
      const isOwner = Boolean(session) && session.discordId === ownerId;
      if (!isOwner && !(await isAdminRequest(request, env))) {
        return json({ error: "Not signed in as an officer or as the note's author." }, 401, request);
      }
      return json(await deleteVodNote(env, vodNoteMatch[1], vodNoteMatch[2]), 200, request);
    }

    return json({ error: "Not found." }, 404, request);
  },
};
