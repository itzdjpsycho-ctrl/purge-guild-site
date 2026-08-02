import { WORKER_URL, BOT_PUSH_SECRET } from "../config.js";

// Canonical guild data (matches/extendedStats/rosterMembers) now lives in
// Cloudflare D1 behind the Worker (see worker/src/data.js) instead of the
// repo-root data.js file. This is now an HTTP client: reads hit the Worker's
// public GET /data.js (served as literal `window.GUILD_DATA = {...};` JS —
// the same strip-the-wrapper trick works on the fetched text), writes hit
// the Worker's bot-secret-gated /matches, /matches/:date, /roster.
// Requires WORKER_URL + BOT_PUSH_SECRET (bot/.env) — there is no local-file
// fallback anymore, so these two are no longer optional the way they are for
// the sign-up-board features.

// Index positions inside an EXTENDED_STATS row (mirrors data.extendedColumns).
export const EXT = {
  name: 0, kills: 1, deaths: 2, streak: 3, dmgDone: 4, dmgTaken: 5, cc: 6,
  hpHealed: 7, allyHpHealed: 8, fortDmg: 9, cannonsLanded: 10, objDestroyed: 11,
  cannonDist: 12, traps: 13, timeDead: 14, timeAlive: 15,
};

async function workerCall(path, method, body) {
  const res = await fetch(`${WORKER_URL}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-bot-secret": BOT_PUSH_SECRET },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Worker ${method} ${path} failed: HTTP ${res.status}${detail ? ` — ${detail}` : ""}`);
  }
  return res.json();
}

/** Fetched fresh every call so newly added/removed wars show up without a bot restart. */
export async function loadData() {
  const res = await fetch(`${WORKER_URL}/data.js`);
  if (!res.ok) throw new Error(`Couldn't load guild data from the Worker (HTTP ${res.status}).`);
  const raw = await res.text();
  const json = raw
    .replace(/^[\s\S]*window\.GUILD_DATA\s*=\s*/, "")
    .replace(/;\s*$/, "");
  return JSON.parse(json);
}

/** All wars, newest first. */
export async function listWars() {
  const data = await loadData();
  return [...data.matches].sort((a, b) => b.date.localeCompare(a.date));
}

/** Most recent war. */
export async function latestWar() {
  const wars = await listWars();
  return wars[0] || null;
}

/** Find a war by exact YYYY-MM-DD date, or null. */
export async function getWar(date) {
  const data = await loadData();
  return data.matches.find((m) => m.date === date) || null;
}

/** Extended stat rows for a war date (array of arrays), or [] if none. */
export async function extendedFor(date) {
  const data = await loadData();
  return data.extendedStats[date] || [];
}

/** Turn an extended row into a named object. */
export function rowToObj(row) {
  const o = {};
  for (const [key, idx] of Object.entries(EXT)) o[key] = row[idx];
  return o;
}

/**
 * Case-insensitive player lookup across all wars.
 * Returns { name, wars: [{ date, location, result, ext|null, kills, deaths }] }
 * or null if the player was never in a war.
 */
export async function playerHistory(query) {
  const data = await loadData();
  const lc = query.toLowerCase();
  let canonical = null;
  const wars = [];

  for (const m of data.matches) {
    const basic = m.players.find((p) => p[0].toLowerCase() === lc);
    if (!basic) continue;
    canonical = basic[0];
    const extRow = (data.extendedStats[m.date] || []).find(
      (r) => r[0].toLowerCase() === lc
    );
    wars.push({
      date: m.date,
      day: m.day,
      location: m.location,
      result: m.result,
      kills: basic[1],
      deaths: basic[2],
      ext: extRow ? rowToObj(extRow) : null,
    });
  }

  if (!canonical) return null;
  wars.sort((a, b) => b.date.localeCompare(a.date));
  return { name: canonical, wars };
}

/** List of all distinct player names (for autocomplete), sorted. */
export async function allPlayerNames() {
  const data = await loadData();
  const set = new Set();
  for (const m of data.matches) {
    for (const p of m.players) set.add(p[0]);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

/**
 * Add (or replace, by date) a war directly in D1 via the Worker.
 * @param {{date,day,location,result,players:Array<object>}} war - players carry
 *        full stat fields keyed like extendedColumns (name, kills, deaths, ...).
 * @returns {Promise<{replaced:boolean, players:number}>}
 */
export async function addWar(war) {
  return workerCall("/matches", "POST", { war });
}

/**
 * Delete a war by exact YYYY-MM-DD date directly in D1 via the Worker.
 * @returns {Promise<{removed:boolean, location:string|null}>}
 */
export async function removeWar(date) {
  return workerCall(`/matches/${encodeURIComponent(date)}`, "DELETE");
}

/**
 * Replace rosterMembers wholesale (e.g. from /roster sync) directly in D1.
 * Does not touch matches/extendedStats — anyone with war history still shows
 * up on the site even if they've since left the guild.
 * @returns {Promise<{added:string[], removed:string[]}>} diff vs. the previous list.
 */
export async function setRosterMembers(names) {
  return workerCall("/roster", "POST", { names });
}

// ---- formatting helpers (match the website; pure, no data dependency) ----

export function fmtNum(v) {
  v = Number(v) || 0;
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + "M";
  if (v >= 100_000) return (v / 1000).toFixed(1) + "K";
  return String(v);
}

export function fmtKD(kills, deaths) {
  if (kills === 0 && deaths === 0) return "—";
  const v = deaths === 0 ? kills : kills / deaths;
  return v.toFixed(2);
}

export function fmtTime(seconds) {
  seconds = Number(seconds) || 0;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function fmtDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", {
    weekday: "short", day: "numeric", month: "short", year: "numeric",
  });
}
