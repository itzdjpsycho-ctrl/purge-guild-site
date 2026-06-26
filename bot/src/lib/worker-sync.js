import { getSignup, importSignup } from "./signups.js";
import { userForName } from "./links.js";
import { refreshSignupMessage } from "./signup-message.js";
import { fetchPosted, workerEnabled } from "./worker.js";

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
