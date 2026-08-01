import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "..", "data");
const LINKS_PATH = join(DATA_DIR, "links.json");

// Private (git-ignored) map of Discord user id -> canonical family name.
// Kept off the public website on purpose.
function readAll() {
  if (!existsSync(LINKS_PATH)) return {};
  try {
    return JSON.parse(readFileSync(LINKS_PATH, "utf8"));
  } catch {
    return {};
  }
}

function writeAll(map) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(LINKS_PATH, JSON.stringify(map, null, 2) + "\n");
}

/** Family name linked to this Discord user, or null. */
export function nameForUser(userId) {
  return readAll()[userId] || null;
}

/** The full Discord-id -> family-name map, for pushing to the Worker. */
export function allLinks() {
  return readAll();
}

/** Discord user id that owns this family name, or null. */
export function userForName(name) {
  const lc = name.toLowerCase();
  for (const [userId, n] of Object.entries(readAll())) {
    if (n.toLowerCase() === lc) return userId;
  }
  return null;
}

/**
 * Link a user to a name. Enforces one-name-per-user and one-user-per-name.
 * Returns { ok, error }.
 */
export function link(userId, name) {
  const map = readAll();
  const owner = userForName(name);
  if (owner && owner !== userId) {
    return { ok: false, error: `**${name}** is already claimed by <@${owner}>. An admin can reassign it.` };
  }
  map[userId] = name; // replaces any previous name this user held
  writeAll(map);
  return { ok: true };
}

export function unlink(userId) {
  const map = readAll();
  const had = map[userId] || null;
  delete map[userId];
  writeAll(map);
  return had;
}

/**
 * Repoint any link whose family name matches fromName (case-insensitive) to
 * toName instead — used by "Merge Stats" (a character rename) so the same
 * person's /profile commands and My Stats page keep working under their new
 * name. Skips a user whose link already points at fromName if toName is
 * already claimed by a DIFFERENT user, leaving both links untouched for an
 * officer to reconcile manually via /profile unlink + register.
 * @returns {boolean} whether anything changed.
 */
export function renameLink(fromName, toName) {
  const map = readAll();
  const fromLower = fromName.toLowerCase();
  const existingToOwner = userForName(toName);
  let changed = false;
  for (const [userId, n] of Object.entries(map)) {
    if (n.toLowerCase() !== fromLower) continue;
    if (existingToOwner && existingToOwner !== userId) continue;
    map[userId] = toName;
    changed = true;
  }
  if (changed) writeAll(map);
  return changed;
}
