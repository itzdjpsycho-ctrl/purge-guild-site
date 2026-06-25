import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
// The canonical data lives at the repo root in data.js (a browser global that
// the website also loads). bot/src/lib -> ../../../data.js
const DATA_PATH = join(__dirname, "..", "..", "..", "data.js");

// Index positions inside an EXTENDED_STATS row (mirrors data.extendedColumns).
export const EXT = {
  name: 0, kills: 1, deaths: 2, streak: 3, dmgDone: 4, dmgTaken: 5, cc: 6,
  hpHealed: 7, allyHpHealed: 8, fortDmg: 9, cannonsLanded: 10, objDestroyed: 11,
  cannonDist: 12, traps: 13, timeDead: 14, timeAlive: 15,
};

/**
 * Read fresh every call so newly added wars show up without a bot restart.
 * data.js wraps the data as `window.GUILD_DATA = { ... };` for the browser;
 * here we strip that wrapper and parse the JSON payload.
 */
export function loadData() {
  const raw = readFileSync(DATA_PATH, "utf8");
  // Greedy match so any mention of the global in comments is skipped and we
  // land on the real assignment (the last one in the file).
  const json = raw
    .replace(/^[\s\S]*window\.GUILD_DATA\s*=\s*/, "")
    .replace(/;\s*$/, "");
  return JSON.parse(json);
}

/** All wars, newest first. */
export function listWars() {
  return [...loadData().matches].sort((a, b) => b.date.localeCompare(a.date));
}

/** Most recent war. */
export function latestWar() {
  return listWars()[0] || null;
}

/** Find a war by exact YYYY-MM-DD date, or null. */
export function getWar(date) {
  return loadData().matches.find((m) => m.date === date) || null;
}

/** Extended stat rows for a war date (array of arrays), or [] if none. */
export function extendedFor(date) {
  return loadData().extendedStats[date] || [];
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
export function playerHistory(query) {
  const data = loadData();
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

/**
 * Write the data object back to data.js, preserving the file's leading comment
 * header and the `window.GUILD_DATA = ...;` wrapper. The body is pretty-printed
 * JSON (2-space), matching the existing file so diffs stay minimal.
 */
export function saveData(data) {
  const raw = readFileSync(DATA_PATH, "utf8");
  const prefix = raw.slice(0, raw.indexOf("window.GUILD_DATA"));
  const body = "window.GUILD_DATA = " + JSON.stringify(data, null, 2) + ";\n";
  writeFileSync(DATA_PATH, prefix + body);
}

/**
 * Append (or replace, by date) a war into matches + extendedStats.
 * @param {{date,day,location,result,players:Array<object>}} war - players carry
 *        full stat fields keyed like extendedColumns (name, kills, deaths, ...).
 * @returns {{replaced:boolean, players:number}}
 */
export function addWar(war) {
  const data = loadData();
  const cols = data.extendedColumns; // canonical column order

  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const basicPlayers = war.players.map((p) => [p.name, num(p.kills), num(p.deaths)]);
  const extRows = war.players.map((p) =>
    cols.map((c) => (c === "name" ? p.name : num(p[c])))
  );

  const match = {
    date: war.date,
    day: war.day || "",
    location: war.location || "",
    result: war.result === "Victory" ? "Victory" : "Defeat",
    players: basicPlayers,
  };

  const replaced = data.matches.some((m) => m.date === war.date);
  data.matches = data.matches.filter((m) => m.date !== war.date);
  data.matches.push(match);
  data.matches.sort((a, b) => a.date.localeCompare(b.date)); // keep chronological
  data.extendedStats[war.date] = extRows;

  saveData(data);
  return { replaced, players: basicPlayers.length };
}

/** List of all distinct player names (for autocomplete), sorted. */
export function allPlayerNames() {
  const set = new Set();
  for (const m of loadData().matches) {
    for (const p of m.players) set.add(p[0]);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

// ---- formatting helpers (match the website) ----

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
