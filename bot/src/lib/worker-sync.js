import { getSignup, importSignup, setEntry, removeEntry, setCaps } from "./signups.js";
import { userForName } from "./links.js";
import { refreshSignupMessage } from "./signup-message.js";
import { fetchPosted, fetchOps, workerEnabled } from "./worker.js";

const slug = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "guest";

/** Turn a Worker `/posted` item into a local signups.json record. */
function toRecord(item) {
  const s = item.signup || {};
  const entries = {};
  let maxNum = 0;
  for (const e of s.entries || []) {
    // Attach to a real Discord user where we can, so their later button clicks
    // update the same row; otherwise a stable synthetic key keyed on the name.
    const key = userForName(e.name) || `name:${slug(e.name)}`;
    entries[key] = {
      num: e.num,
      name: e.name,
      status: e.status || "in",
      role: e.role ?? null,
      cls: e.cls ?? null,
      at: item.postedAt || new Date().toISOString(),
    };
    if (e.num > maxNum) maxNum = e.num;
  }
  return {
    id: item.messageId,
    messageId: item.messageId,
    channelId: item.channelId,
    date: s.date || "",
    time: s.time || "",
    location: s.location || "",
    notes: s.notes || "",
    status: s.status || "open",
    createdBy: "website",
    createdAt: item.postedAt || new Date().toISOString(),
    seq: Math.max(s.seq || 0, maxNum),
    caps: s.caps || {},
    entries,
  };
}

/**
 * Pull every sheet the Worker has posted and adopt any the bot doesn't yet
 * track, so their buttons work. Safe to call repeatedly. Returns how many were
 * newly hydrated.
 */
export async function syncFromWorker(client) {
  if (!workerEnabled()) return 0;
  let added = 0;
  try {
    const posted = await fetchPosted();
    for (const item of posted) {
      if (!item?.messageId || getSignup(item.messageId)) continue;
      const record = importSignup(toRecord(item));
      added++;
      // Re-render under the bot so its copy supersedes the Worker-rendered one
      // (identical output) and the live view gets a fresh push.
      if (client) await refreshSignupMessage(client, record).catch(() => {});
    }
  } catch (err) {
    console.error("syncFromWorker failed:", err.message);
  }
  return added;
}

/** Find an entry's store key (userId or synthetic) by display name. */
function keyForName(signup, name) {
  const lc = String(name || "").toLowerCase();
  for (const [k, e] of Object.entries(signup.entries || {})) {
    if (String(e.name || "").toLowerCase() === lc) return k;
  }
  return null;
}

/**
 * Drain and apply the website's pending edit-ops (add / remove / update) for
 * already-posted sheets. Because each op is applied to signups.json (the bot's
 * source of truth), website edits coexist with Discord-side self-sign-ups and
 * are never clobbered. Returns how many ops were applied.
 */
export async function applyOps(client) {
  if (!workerEnabled()) return 0;
  let applied = 0;
  try {
    const ops = await fetchOps();
    if (!ops.length) return 0;
    const touched = new Set();
    for (const item of ops) {
      const { messageId, op } = item;
      if (!messageId || !op?.type) continue;
      let signup = getSignup(messageId) || (await hydrateSignup(messageId));
      if (!signup) continue;

      // Sheet-level op: per-role capacity overrides.
      if (op.type === "caps") {
        setCaps(messageId, op.caps || {});
        touched.add(messageId);
        applied++;
        continue;
      }
      if (!op.name) continue;
      const existingKey = keyForName(signup, op.name);
      const key = existingKey || userForName(op.name) || `name:${slug(op.name)}`;

      if (op.type === "remove") {
        if (existingKey) removeEntry(messageId, existingKey);
      } else if (op.type === "add") {
        setEntry(messageId, key, {
          status: op.status || "in",
          role: op.role ?? null,
          cls: op.cls ?? null,
          name: op.name,
        });
      } else if (op.type === "update") {
        const fields = { name: op.name };
        if (op.role !== undefined) fields.role = op.role;
        if (op.status !== undefined) fields.status = op.status;
        if (op.cls !== undefined) fields.cls = op.cls;
        // Updating someone not on the sheet yet = treat as an add.
        if (!existingKey && fields.status === undefined) fields.status = "in";
        setEntry(messageId, key, fields);
      } else {
        continue;
      }
      touched.add(messageId);
      applied++;
    }
    for (const messageId of touched) {
      const signup = getSignup(messageId);
      if (signup && client) await refreshSignupMessage(client, signup).catch(() => {});
    }
  } catch (err) {
    console.error("applyOps failed:", err.message);
  }
  return applied;
}

/**
 * One-shot hydrate for a single message id — the safety net when a button click
 * arrives for a sheet we don't track yet (posted since the last interval sync).
 */
export async function hydrateSignup(messageId) {
  if (!workerEnabled()) return null;
  try {
    const posted = await fetchPosted();
    const item = posted.find((p) => p.messageId === messageId);
    if (!item) return null;
    return importSignup(toRecord(item));
  } catch {
    return null;
  }
}
