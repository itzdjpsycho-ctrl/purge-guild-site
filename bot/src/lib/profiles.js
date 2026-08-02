import { WORKER_URL, BOT_PUSH_SECRET } from "../config.js";
import { loadData, allPlayerNames } from "./data.js";

// Canonical player profiles (class, gear/crystal/addon screenshot paths, gear
// stats) now live in Cloudflare D1 behind the Worker (see worker/src/data.js)
// instead of the repo-root profiles.js file. This is now an HTTP client:
// reads hit the Worker's public GET /profiles.js (served as literal
// `window.GUILD_PROFILES = {...};` JS), writes hit the Worker's
// bot-secret-gated POST /profiles/:name.
//
// The screenshot FILES themselves (assets/profiles/*) are unaffected by this
// migration — they're still git-committed static assets served by GitHub
// Pages (see images.js + git.js) — only the JSON metadata (which path, class,
// gear stats) moved to D1.

// Maps the /upload slot choice to the website's profile image key.
export const SLOT_KEYS = {
  gear: "gearImg",
  crystals: "crystalsImg",
  addons: "addonsImg",
};

/** All names the site knows about (roster + everyone who's played a war). */
export async function knownNames() {
  const [data, names] = await Promise.all([loadData(), allPlayerNames()]);
  const set = new Map(); // lowercase -> canonical
  for (const n of data.rosterMembers) set.set(n.toLowerCase(), n);
  for (const n of names) if (!set.has(n.toLowerCase())) set.set(n.toLowerCase(), n);
  return set;
}

/** Resolve a typed name to its canonical roster casing, or null if unknown. */
export async function canonicalName(query) {
  const names = await knownNames();
  return names.get(String(query).toLowerCase().trim()) || null;
}

export async function loadProfiles() {
  const res = await fetch(`${WORKER_URL}/profiles.js`);
  if (!res.ok) throw new Error(`Couldn't load profiles from the Worker (HTTP ${res.status}).`);
  const raw = await res.text();
  const json = raw
    .replace(/^[\s\S]*window\.GUILD_PROFILES\s*=\s*/, "")
    .replace(/;\s*$/, "");
  return JSON.parse(json);
}

export async function getProfile(name) {
  const profiles = await loadProfiles();
  return profiles[name] || null;
}

async function profileOp(name, op) {
  const res = await fetch(`${WORKER_URL}/profiles/${encodeURIComponent(name)}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-bot-secret": BOT_PUSH_SECRET },
    body: JSON.stringify({ op }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Worker profile op "${op.type}" for ${name} failed: HTTP ${res.status}${detail ? ` — ${detail}` : ""}`);
  }
  return res.json();
}

/** Returns false if the player has no profile row yet (mirrors the old file-based no-op). */
export async function setClass(name, className) {
  const r = await profileOp(name, { type: "setClass", className });
  return Boolean(r.result?.ok);
}

/** Set an image path (relative, e.g. assets/profiles/x-gear.png) for a slot.
 *  Returns the prior path (for asset cleanup) or null. */
export async function setImage(name, slotKey, relativePath) {
  const r = await profileOp(name, { type: "setImage", slotKey, path: relativePath });
  return r.result?.prevPath ?? null;
}

/**
 * Store gear stats (ap / aap / dp) for a player. Only non-null values are
 * written, so a stat the screenshot reader couldn't see never clobbers an
 * existing good value. Returns the updated profile.
 */
export async function setGear(name, { ap, aap, dp } = {}) {
  const r = await profileOp(name, { type: "setStats", ap, aap, dp });
  return r.result;
}

/**
 * Vacation excludes a player from the Dashboard's attendance rankings while
 * it's on. Exception exempts them from the site's automatic Watch flag.
 * Returns the updated profile.
 */
export async function setFlags(name, { vacation, exception } = {}) {
  const r = await profileOp(name, { type: "setFlags", vacation, exception });
  return r.result;
}
