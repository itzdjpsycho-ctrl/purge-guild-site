import { WORKER_URL, BOT_PUSH_SECRET } from "../config.js";
import { loadData } from "./data.js";
import { listAll } from "./signups.js";
import { nameForUser } from "./links.js";
import { canonicalName } from "./profiles.js";

// Attendance is still computed HERE on the bot (only it has the private,
// git-ignored bot/data/signups.json sign-up history to cross-reference
// against wars), but the result is now pushed wholesale to D1 via the
// Worker's bot-secret-gated POST /attendance instead of being written to the
// repo-root attendance.js file. See worker/src/data.js's mergeProfileRows()
// doc comment for why a website-initiated merge can't recompute this itself.

// A player counts as having committed to a war if they were placed "in",
// running "late", or held on the "bench" (still expected to show). Signing
// "tentative" or marking "absence" doesn't count toward the denominator.
const COMMITTED_STATUSES = new Set(["in", "late", "bench"]);

/**
 * Cross-reference every historical sign-up sheet against wars that actually
 * happened (D1 matches, via loadData()) to compute per-player attendance.
 * Resolves each sign-up entry's Discord user id to a family name via the
 * private links.json, falling back to the sign-up's stored display name if
 * unlinked. Entries that can't be resolved to a known roster/war name are
 * skipped.
 *
 * Returns { players, byWar }:
 *   - players[name]: { signups, attended, noShows, rate, updatedAt, noShowWars }
 *     — noShowWars is the deduped list of { date, location } this player
 *     signed up (in/late/bench) for but didn't appear in the results of.
 *   - byWar[date]: { location, noShows: [{name, status}] } — present for
 *     every war date that had at least one matching sign-up sheet, even if
 *     noShows ends up empty. A date's ABSENCE from byWar means no sign-up
 *     data exists for that war at all, distinct from "zero no-shows".
 *
 * Sheets are processed oldest-to-newest by createdAt so that when two sheets
 * share a war date (which happens in practice), the more recent sheet's
 * status wins for a given player on that date.
 */
export async function computeAttendance() {
  const data = await loadData();
  const warsByDate = new Map(data.matches.map((m) => [m.date, m]));

  const players = {}; // name -> { signups, attended, noShows }
  const warSheetDates = new Set(); // dates with >=1 sheet matched to a real war
  const noShowByDate = new Map(); // date -> Map(lowerName -> {name, status})

  const sheets = [...listAll()].sort((a, b) =>
    (a.createdAt || "").localeCompare(b.createdAt || "")
  );

  for (const sheet of sheets) {
    const war = warsByDate.get(sheet.date);
    if (!war) continue; // sign-up for a war that hasn't happened (yet) or was never logged
    warSheetDates.add(sheet.date);

    const roster = new Set(war.players.map((p) => p[0].toLowerCase()));

    for (const [userId, entry] of Object.entries(sheet.entries || {})) {
      if (!COMMITTED_STATUSES.has(entry.status)) continue;

      const name = await canonicalName(nameForUser(userId) || entry.name);
      if (!name) continue; // can't attribute this entry to a known player

      if (!players[name]) players[name] = { signups: 0, attended: 0, noShows: 0 };
      const s = players[name];
      s.signups += 1;

      if (roster.has(name.toLowerCase())) {
        s.attended += 1;
      } else {
        s.noShows += 1;
        if (!noShowByDate.has(sheet.date)) noShowByDate.set(sheet.date, new Map());
        noShowByDate.get(sheet.date).set(name.toLowerCase(), { name, status: entry.status });
      }
    }
  }

  const byWar = {};
  for (const date of warSheetDates) {
    const war = warsByDate.get(date);
    const nameMap = noShowByDate.get(date) || new Map();
    byWar[date] = {
      location: war.location,
      noShows: [...nameMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  for (const [date, entry] of Object.entries(byWar)) {
    for (const ns of entry.noShows) {
      const p = players[ns.name];
      if (!p) continue;
      (p.noShowWars ??= []).push({ date, location: entry.location });
    }
  }

  const now = new Date().toISOString();
  for (const name of Object.keys(players)) {
    const s = players[name];
    s.rate = s.signups > 0 ? s.attended / s.signups : 0;
    s.updatedAt = now;
    s.noShowWars = (s.noShowWars || []).sort((a, b) => a.date.localeCompare(b.date));
  }

  return { players, byWar };
}

/** Push a freshly-computed attendance summary to D1 via the Worker. */
export async function writeAttendance(summary) {
  const res = await fetch(`${WORKER_URL}/attendance`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-bot-secret": BOT_PUSH_SECRET },
    body: JSON.stringify({ summary }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Worker POST /attendance failed: HTTP ${res.status}${detail ? ` — ${detail}` : ""}`);
  }
}
