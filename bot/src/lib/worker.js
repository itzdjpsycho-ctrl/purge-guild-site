import { WORKER_URL, BOT_PUSH_SECRET } from "../config.js";

/**
 * Outbound client for the Cloudflare Worker relay (see worker/). Everything here
 * is fire-and-forget from the bot's point of view — a Worker that's down or
 * unconfigured must never break a Discord interaction. If WORKER_URL is unset,
 * every call is a no-op so the bot runs fine standalone.
 */
export function workerEnabled() {
  return Boolean(WORKER_URL);
}

/** Strip Discord user ids from a signup record → the public/sanitized shape. */
export function sanitizeSignup(signup) {
  const entries = Object.values(signup.entries || {})
    .map((e) => ({
      num: e.num,
      name: e.name,
      status: e.status,
      role: e.role ?? null,
      cls: e.cls ?? null,
    }))
    .sort((a, b) => a.num - b.num);
  return {
    messageId: signup.messageId || signup.id || null,
    channelId: signup.channelId || null,
    status: signup.status || "open",
    date: signup.date || "",
    time: signup.time || "",
    location: signup.location || "",
    notes: signup.notes || "",
    seq: signup.seq || 0,
    updatedAt: new Date().toISOString(),
    entries,
  };
}

async function send(path, method, body) {
  if (!WORKER_URL) return { ok: false, skipped: true };
  try {
    const res = await fetch(`${WORKER_URL}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        "x-bot-secret": BOT_PUSH_SECRET,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      return { ok: false, status: res.status, error: await res.text().catch(() => "") };
    }
    return { ok: true, data: await res.json().catch(() => ({})) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/** Push the current sanitized sign-up state for the website's live view. */
export async function pushState(signup) {
  return send("/state", "POST", sanitizeSignup(signup));
}

/** Tell the Worker which channel to post sheets into. */
export async function pushConfig(channelId) {
  return send("/config", "POST", { channelId });
}

/** Pull sign-ups the Worker posted (while the bot may have been offline). */
export async function fetchPosted() {
  const r = await send("/posted", "GET");
  if (!r.ok) return [];
  return Array.isArray(r.data?.posted) ? r.data.posted : [];
}

/** Drain pending website edit-ops (add/remove/update) for posted sheets. */
export async function fetchOps() {
  const r = await send("/ops", "GET");
  if (!r.ok) return [];
  return Array.isArray(r.data?.ops) ? r.data.ops : [];
}
