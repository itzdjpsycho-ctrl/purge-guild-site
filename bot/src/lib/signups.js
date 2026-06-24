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
 *     id, channelId, messageId, date, location, notes, status: "open"|"closed",
 *     createdBy, createdAt,
 *     entries: { "<userId>": { status: "in"|"maybe"|"out", role: "mainball"|..|null, at } }
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

export function createSignup({ messageId, channelId, date, location, notes, createdBy }) {
  const store = readAll();
  store[messageId] = {
    id: messageId,
    messageId,
    channelId,
    date,
    location: location || "",
    notes: notes || "",
    status: "open",
    createdBy,
    createdAt: new Date().toISOString(),
    entries: {},
  };
  writeAll(store);
  return store[messageId];
}

export function getSignup(messageId) {
  return readAll()[messageId] || null;
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

/** Set a member's attendance + optional role. status null removes them. */
export function setEntry(messageId, userId, { status, role } = {}) {
  return mutate(messageId, (s) => {
    if (status === null) {
      delete s.entries[userId];
      return;
    }
    const existing = s.entries[userId] || {};
    s.entries[userId] = {
      status: status ?? existing.status ?? "in",
      role: role !== undefined ? role : existing.role ?? null,
      at: new Date().toISOString(),
    };
  });
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

export function updateDetails(messageId, { date, location, notes }) {
  return mutate(messageId, (s) => {
    if (date !== undefined) s.date = date;
    if (location !== undefined) s.location = location;
    if (notes !== undefined) s.notes = notes;
  });
}

/** Group entries by attendance status, each as [{ userId, role }]. */
export function groupEntries(signup) {
  const groups = { in: [], maybe: [], out: [] };
  for (const [userId, e] of Object.entries(signup.entries)) {
    (groups[e.status] || (groups[e.status] = [])).push({ userId, role: e.role });
  }
  return groups;
}
