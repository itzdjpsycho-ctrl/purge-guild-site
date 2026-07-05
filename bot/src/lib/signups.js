import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "..", "data");
const STORE_PATH = join(DATA_DIR, "signups.json");

/**
 * Store shape:
 * {
 *   "<messageId>": {
 *     id, channelId, messageId, date, time, location, notes,
 *     status: "open"|"closed", createdBy, createdAt, seq,
 *     entries: {
 *       "<userId>": {
 *         num,                       // persistent slot number (sign-up order)
 *         name,                      // display name at sign-up time
 *         status: "in"|"bench"|"late"|"tentative"|"absence",
 *         role: "<roleId>"|null,
 *         cls: "<BDO class>"|null,
 *         at,
 *       }
 *     }
 *   }
 * }
 * Sign-ups are keyed by the Discord message id of their embed, so a button
 * click can find its sheet directly from the interaction.
 */
function ensure() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(STORE_PATH)) writeFileSync(STORE_PATH, "{}\n");
}

function readAll() {
  ensure();
  try {
    return JSON.parse(readFileSync(STORE_PATH, "utf8"));
  } catch {
    return {};
  }
}

function writeAll(store) {
  ensure();
  writeFileSync(STORE_PATH, JSON.stringify(store, null, 2) + "\n");
}

export function createSignup({ messageId, channelId, date, time, location, notes, createdBy }) {
  const store = readAll();
  store[messageId] = {
    id: messageId,
    messageId,
    channelId,
    date,
    time: time || "",
    location: location || "",
    notes: notes || "",
    status: "open",
    createdBy,
    createdAt: new Date().toISOString(),
    seq: 0,
    caps: {},
    entries: {},
  };
  writeAll(store);
  return store[messageId];
}

export function getSignup(messageId) {
  return readAll()[messageId] || null;
}

/** Every sign-up sheet ever created, oldest and newest alike. */
export function listAll() {
  return Object.values(readAll());
}

/**
 * Insert a fully-formed sign-up record (e.g. hydrated from the Worker relay for
 * a sheet posted while the bot was offline). No-op if the message id is already
 * tracked, so the locally-maintained copy always wins. Preserves the record's
 * own `num`/`seq` (the Worker is the slot-number allocator at post time).
 */
export function importSignup(record) {
  const store = readAll();
  if (store[record.messageId]) return store[record.messageId];
  store[record.messageId] = record;
  writeAll(store);
  return record;
}

/** Most recently created OPEN sign-up, used as the default target for admin edits. */
export function latestOpenSignup() {
  const all = Object.values(readAll());
  const open = all.filter((s) => s.status === "open");
  open.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return open[0] || null;
}

function mutate(messageId, fn) {
  const store = readAll();
  const s = store[messageId];
  if (!s) return null;
  fn(s);
  store[messageId] = s;
  writeAll(store);
  return s;
}

/**
 * Set a member's attendance / role / class. A new member gets the next slot
 * number. Pass `status: null` to remove them. Any field left `undefined` is
 * preserved; a brand-new entry defaults to status "in".
 */
export function setEntry(messageId, userId, { status, role, cls, name } = {}) {
  return mutate(messageId, (s) => {
    if (status === null) {
      delete s.entries[userId];
      return;
    }
    const existing = s.entries[userId];
    if (!existing) {
      s.seq = (s.seq || 0) + 1;
      s.entries[userId] = {
        num: s.seq,
        name: name || "Unknown",
        status: status ?? "in",
        role: role ?? null,
        cls: cls ?? null,
        at: new Date().toISOString(),
      };
      return;
    }
    if (status !== undefined) existing.status = status;
    if (role !== undefined) existing.role = role;
    if (cls !== undefined) existing.cls = cls;
    if (name) existing.name = name;
    existing.at = new Date().toISOString();
  });
}

/** How many members are actively filling a role (in-game + late count). */
export function roleFill(signup, roleId) {
  return Object.values(signup.entries).filter(
    (e) => e.role === roleId && (e.status === "in" || e.status === "late")
  ).length;
}

export function removeEntry(messageId, userId) {
  return mutate(messageId, (s) => {
    delete s.entries[userId];
  });
}

export function closeSignup(messageId) {
  return mutate(messageId, (s) => {
    s.status = "closed";
  });
}

export function reopenSignup(messageId) {
  return mutate(messageId, (s) => {
    s.status = "open";
  });
}

/** Replace the per-sheet role capacity overrides ({ roleId: number }). */
export function setCaps(messageId, caps) {
  return mutate(messageId, (s) => {
    s.caps = caps && typeof caps === "object" ? caps : {};
  });
}

/** Flag a sign-up's Discord message as auto-deleted (post-war cleanup). The
 *  record itself is kept forever — attendance history reads it. */
export function markAutoDeleted(messageId) {
  return mutate(messageId, (s) => {
    s.autoDeletedAt = new Date().toISOString();
  });
}

export function updateDetails(messageId, { date, time, location, notes }) {
  return mutate(messageId, (s) => {
    if (date !== undefined) s.date = date;
    if (time !== undefined) s.time = time;
    if (location !== undefined) s.location = location;
    if (notes !== undefined) s.notes = notes;
  });
}
