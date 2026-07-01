import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadData } from "./data.js";
import { listAll } from "./signups.js";
import { nameForUser } from "./links.js";
import { canonicalName } from "./profiles.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Committed attendance summary at repo root, read by the website too.
// bot/src/lib -> ../../../attendance.js
export const ATTENDANCE_PATH = join(__dirname, "..", "..", "..", "attendance.js");

// A player counts as having committed to a war if they were placed "in",
// running "late", or held on the "bench" (still expected to show). Signing
// "tentative" or marking "absence" doesn't count toward the denominator.
const COMMITTED_STATUSES = new Set(["in", "late", "bench"]);

/**
 * Cross-reference every historical sign-up sheet against wars that actually
 * happened (data.js matches) to compute per-player attendance. Resolves each
 * sign-up entry's Discord user id to a family name via the private
 * links.json, falling back to the sign-up's stored display name if unlinked.
 * Entries that can't be resolved to a known roster/war name are skipped.
 */
export function computeAttendance() {
  const data = loadData();
  const warsByDate = new Map(data.matches.map((m) => [m.date, m]));

  const summary = {}; // name -> { signups, attended, noShows }

  for (const sheet of listAll()) {
    const war = warsByDate.get(sheet.date);
    if (!war) continue; // sign-up for a war that hasn't happened (yet) or was never logged

    const roster = new Set(war.players.map((p) => p[0].toLowerCase()));

    for (const [userId, entry] of Object.entries(sheet.entries || {})) {
      if (!COMMITTED_STATUSES.has(entry.status)) continue;

      const name = canonicalName(nameForUser(userId) || entry.name);
      if (!name) continue; // can't attribute this entry to a known player

      if (!summary[name]) summary[name] = { signups: 0, attended: 0, noShows: 0 };
      const s = summary[name];
      s.signups += 1;
      if (roster.has(name.toLowerCase())) s.attended += 1;
      else s.noShows += 1;
    }
  }

  const now = new Date().toISOString();
  for (const name of Object.keys(summary)) {
    const s = summary[name];
    s.rate = s.signups > 0 ? s.attended / s.signups : 0;
    s.updatedAt = now;
  }

  return summary;
}

export function loadAttendance() {
  if (!existsSync(ATTENDANCE_PATH)) return {};
  const raw = readFileSync(ATTENDANCE_PATH, "utf8");
  try {
    const json = raw
      .replace(/^[\s\S]*window\.GUILD_ATTENDANCE\s*=\s*/, "")
      .replace(/;\s*$/, "");
    return JSON.parse(json);
  } catch {
    return {};
  }
}

export function writeAttendance(summary) {
  const header =
    "// Canonical guild ATTENDANCE — per-player sign-up vs. actual-war-result\n" +
    "// counts, computed by the Discord bot after every /addwar from bot/data/\n" +
    "// signups.json + data.js. The website reads this via\n" +
    '// <script src="attendance.js"> for the Dashboard attendance panel.\n' +
    "// Contains NO Discord IDs — the name<->Discord link is kept privately on\n" +
    "// the bot host (bot/data/links.json), never published here.\n";
  const body = "window.GUILD_ATTENDANCE = " + JSON.stringify(summary, null, 2) + ";\n";
  writeFileSync(ATTENDANCE_PATH, header + body);
}
