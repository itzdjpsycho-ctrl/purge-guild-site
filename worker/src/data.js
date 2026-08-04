// D1-backed guild data: matches / extendedStats / rosterMembers / profiles /
// attendance — formerly data.js / profiles.js / attendance.js, committed to
// git and only writable by the bot (see worker.js's header comment for why).
//
// Read side reconstructs the EXACT same shapes those files used to export as
// window.GUILD_DATA / GUILD_PROFILES / GUILD_ATTENDANCE, so the site's
// existing render code needs no changes — see worker.js's /data.js,
// /profiles.js, /attendance.js endpoints.
//
// Write side ports the pure mutator logic that used to live in
// bot/src/lib/data.js and bot/src/lib/profiles.js (addWar/removeWar/
// mergeNames/setClass/setImage/setGear/setFlags/mergeProfiles) — only the
// load/save I/O changed, from `readFileSync`+`writeFileSync` on a git file to
// reading/writing individual D1 rows. Comments on the *why* of each mutator's
// behavior live with the original bot code; this file only re-explains D1-
// specific mechanics (e.g. why merges use env.DB.batch()).

export const GUILD_NAME = "Purge";

// Mirrors bot/src/lib/data.js's EXT map / data.js's extendedColumns — the
// column order inside each extended_stats row.
export const EXTENDED_COLUMNS = [
  "name", "kills", "deaths", "streak", "dmgDone", "dmgTaken", "cc",
  "hpHealed", "allyHpHealed", "fortDmg", "cannonsLanded", "objDestroyed",
  "cannonDist", "traps", "timeDead", "timeAlive",
];

const SLOT_KEYS = { gear: "gearImg", crystals: "crystalsImg", addons: "addonsImg" };

function num(v) {
  return Number.isFinite(Number(v)) ? Number(v) : 0;
}

// ---- read side ----

export async function buildGuildData(env) {
  const [matchRows, extRows, rosterRows] = await Promise.all([
    env.DB.prepare("SELECT date, day, location, result, players_json FROM matches").all(),
    env.DB.prepare("SELECT date, rows_json FROM extended_stats").all(),
    env.DB.prepare("SELECT name FROM roster_members ORDER BY name").all(),
  ]);

  const matches = matchRows.results
    .map((r) => ({
      date: r.date,
      day: r.day,
      location: r.location,
      result: r.result,
      players: JSON.parse(r.players_json),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const extendedStats = {};
  for (const r of extRows.results) extendedStats[r.date] = JSON.parse(r.rows_json);

  return {
    guildName: GUILD_NAME,
    extendedColumns: EXTENDED_COLUMNS,
    rosterMembers: rosterRows.results.map((r) => r.name),
    matches,
    extendedStats,
  };
}

export async function buildProfiles(env) {
  const { results } = await env.DB.prepare("SELECT name, json FROM profiles").all();
  const out = {};
  for (const r of results) out[r.name] = JSON.parse(r.json);
  return out;
}

export async function buildAttendance(env) {
  const row = await env.DB.prepare("SELECT json FROM attendance WHERE id = 1").first();
  return row ? JSON.parse(row.json) : { players: {}, byWar: {} };
}

// ---- war (matches + extended_stats) mutators ----

/**
 * Add (or replace, by date) a war. Mirrors bot/src/lib/data.js addWar().
 * @param {{date,day,location,result,players:Array<object>}} war - players carry
 *        full stat fields keyed like EXTENDED_COLUMNS (name, kills, deaths, ...).
 */
export async function addOrReplaceMatch(env, war) {
  const basicPlayers = war.players.map((p) => [p.name, num(p.kills), num(p.deaths)]);
  const extRows = war.players.map((p) =>
    EXTENDED_COLUMNS.map((c) => (c === "name" ? p.name : num(p[c])))
  );
  const result = war.result === "Victory" ? "Victory" : "Defeat";

  const existing = await env.DB.prepare("SELECT date FROM matches WHERE date = ?").bind(war.date).first();

  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO matches (date, day, location, result, players_json) VALUES (?,?,?,?,?) " +
        "ON CONFLICT(date) DO UPDATE SET day=excluded.day, location=excluded.location, result=excluded.result, players_json=excluded.players_json"
    ).bind(war.date, war.day || "", war.location || "", result, JSON.stringify(basicPlayers)),
    env.DB.prepare(
      "INSERT INTO extended_stats (date, rows_json) VALUES (?,?) " +
        "ON CONFLICT(date) DO UPDATE SET rows_json=excluded.rows_json"
    ).bind(war.date, JSON.stringify(extRows)),
  ]);

  return { replaced: Boolean(existing), players: basicPlayers.length };
}

/** Delete a war by exact YYYY-MM-DD date. Mirrors bot/src/lib/data.js removeWar(). */
export async function removeMatch(env, date) {
  const match = await env.DB.prepare("SELECT location FROM matches WHERE date = ?").bind(date).first();
  if (!match) return { removed: false, location: null };

  await env.DB.batch([
    env.DB.prepare("DELETE FROM matches WHERE date = ?").bind(date),
    env.DB.prepare("DELETE FROM extended_stats WHERE date = ?").bind(date),
  ]);
  return { removed: true, location: match.location };
}

/**
 * Combine two players' entire war history (mirrors bot/src/lib/data.js
 * mergeNames() exactly — see there for the rename-vs-merge-additive-stats
 * rationale). D1's env.DB.batch() can't interleave JS between statements, so
 * unlike a single UPDATE this reads every matches/extended_stats row up
 * front, does the rename/fold in plain JS (identical to the old in-memory
 * version), then submits one UPDATE/DELETE per changed row as a single
 * all-or-nothing batch.
 */
export async function mergeMatchNames(env, fromName, toName) {
  const [matchRows, extRowsAll] = await Promise.all([
    env.DB.prepare("SELECT date, players_json FROM matches").all(),
    env.DB.prepare("SELECT date, rows_json FROM extended_stats").all(),
  ]);
  const extByDate = new Map(extRowsAll.results.map((r) => [r.date, JSON.parse(r.rows_json)]));

  const stmts = [];
  let warsChanged = 0;

  for (const row of matchRows.results) {
    const players = JSON.parse(row.players_json);
    const idxFrom = players.findIndex((p) => p[0] === fromName);
    if (idxFrom < 0) continue;

    const idxTo = players.findIndex((p) => p[0] === toName);
    if (idxTo < 0) {
      players[idxFrom][0] = toName;
    } else {
      players[idxTo][1] += players[idxFrom][1]; // kills
      players[idxTo][2] += players[idxFrom][2]; // deaths
      players.splice(idxFrom, 1);
    }
    warsChanged++;
    stmts.push(
      env.DB.prepare("UPDATE matches SET players_json = ? WHERE date = ?").bind(JSON.stringify(players), row.date)
    );

    const extRows = extByDate.get(row.date);
    if (!extRows) continue;
    const eFrom = extRows.findIndex((r) => r[0] === fromName);
    if (eFrom < 0) continue;
    const eTo = extRows.findIndex((r) => r[0] === toName);
    if (eTo < 0) {
      extRows[eFrom][0] = toName;
    } else {
      EXTENDED_COLUMNS.forEach((c, i) => {
        if (c === "name") return;
        extRows[eTo][i] =
          c === "streak"
            ? Math.max(extRows[eTo][i] || 0, extRows[eFrom][i] || 0)
            : (extRows[eTo][i] || 0) + (extRows[eFrom][i] || 0);
      });
      extRows.splice(eFrom, 1);
    }
    stmts.push(
      env.DB.prepare("UPDATE extended_stats SET rows_json = ? WHERE date = ?").bind(JSON.stringify(extRows), row.date)
    );
  }

  // Same as the original: fromName always drops out, toName always ends up
  // in the roster even if it wasn't there before.
  stmts.push(env.DB.prepare("DELETE FROM roster_members WHERE name = ?").bind(fromName));
  stmts.push(env.DB.prepare("INSERT OR IGNORE INTO roster_members (name) VALUES (?)").bind(toName));

  if (stmts.length) await env.DB.batch(stmts);
  return { warsChanged };
}

// ---- roster ----

/** Replace roster_members wholesale (e.g. from /roster sync). Mirrors bot/src/lib/data.js setRosterMembers(). */
export async function setRosterMembers(env, names) {
  const { results } = await env.DB.prepare("SELECT name FROM roster_members").all();
  const before = new Set(results.map((r) => r.name));
  const after = [...new Set(names)].sort((a, b) => a.localeCompare(b));
  const afterSet = new Set(after);

  const added = after.filter((n) => !before.has(n));
  const removed = [...before].filter((n) => !afterSet.has(n));

  await env.DB.batch([
    env.DB.prepare("DELETE FROM roster_members"),
    ...after.map((n) => env.DB.prepare("INSERT INTO roster_members (name) VALUES (?)").bind(n)),
  ]);
  return { added, removed };
}

// ---- profiles ----

async function getProfileRow(env, name) {
  const row = await env.DB.prepare("SELECT json FROM profiles WHERE name = ?").bind(name).first();
  return row ? JSON.parse(row.json) : null;
}

async function putProfileRow(env, name, profile) {
  await env.DB.prepare(
    "INSERT INTO profiles (name, json) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET json = excluded.json"
  )
    .bind(name, JSON.stringify(profile))
    .run();
}

export async function getProfile(env, name) {
  return getProfileRow(env, name);
}

/** Mirrors bot/src/lib/profiles.js setClass() — no-ops (returns false) if the player has no profile row yet. */
export async function setProfileClass(env, name, className) {
  const profile = await getProfileRow(env, name);
  if (!profile) return false;
  profile.class = className;
  profile.updatedAt = new Date().toISOString();
  await putProfileRow(env, name, profile);
  return true;
}

/** Mirrors bot/src/lib/profiles.js setImage(). Returns the prior path (for asset cleanup) or null. */
export async function setProfileImage(env, name, slotKey, relativePath) {
  const profile = (await getProfileRow(env, name)) || {};
  const prev = profile[slotKey];
  profile[slotKey] = relativePath;
  profile.updatedAt = new Date().toISOString();
  await putProfileRow(env, name, profile);
  return prev || null;
}

/** Mirrors bot/src/lib/profiles.js removeImage(). Returns the prior path or null. */
export async function removeProfileImage(env, name, slotKey) {
  const profile = await getProfileRow(env, name);
  if (!profile || profile[slotKey] == null) return null;
  const prev = profile[slotKey];
  delete profile[slotKey];
  profile.updatedAt = new Date().toISOString();
  await putProfileRow(env, name, profile);
  return prev;
}

/** Mirrors bot/src/lib/profiles.js setGear() — only non-null values overwrite. */
export async function setProfileGear(env, name, { ap, aap, dp } = {}) {
  const profile = (await getProfileRow(env, name)) || {};
  if (ap != null) profile.ap = ap;
  if (aap != null) profile.aap = aap;
  if (dp != null) profile.dp = dp;
  profile.updatedAt = new Date().toISOString();
  await putProfileRow(env, name, profile);
  return profile;
}

/** Mirrors bot/src/lib/profiles.js setFlags(). */
export async function setProfileFlags(env, name, { vacation, exception } = {}) {
  const profile = (await getProfileRow(env, name)) || {};
  if (vacation != null) profile.vacation = vacation;
  if (exception != null) profile.exception = exception;
  profile.updatedAt = new Date().toISOString();
  await putProfileRow(env, name, profile);
  return profile;
}

/**
 * Combine two players' profiles (mirrors bot/src/lib/profiles.js mergeProfiles()
 * exactly). Does NOT recompute attendance — the Worker has no access to the
 * bot's private signups.json, so attendance for the merged name stays as-is
 * until the next /addwar or /removewar naturally recomputes it.
 */
export async function mergeProfileRows(env, fromName, toName) {
  const from = await getProfileRow(env, fromName);
  if (!from) return { merged: false, orphanedAssets: [] };
  const to = await getProfileRow(env, toName);

  const orphanedAssets = [];
  let merged;
  if (!to) {
    merged = from;
  } else {
    const fromNewer = new Date(from.updatedAt || 0) > new Date(to.updatedAt || 0);
    const primary = fromNewer ? from : to;
    const secondary = fromNewer ? to : from;
    merged = { ...secondary, ...primary };
    for (const slotKey of Object.values(SLOT_KEYS)) {
      const kept = merged[slotKey];
      for (const p of [from[slotKey], to[slotKey]]) {
        if (p && p !== kept) orphanedAssets.push(p);
      }
    }
  }
  merged.updatedAt = new Date().toISOString();

  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO profiles (name, json) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET json = excluded.json"
    ).bind(toName, JSON.stringify(merged)),
    env.DB.prepare("DELETE FROM profiles WHERE name = ?").bind(fromName),
  ]);
  return { merged: true, orphanedAssets };
}

// ---- attendance (bot-computed, wholesale-replaced singleton) ----

export async function setAttendance(env, summary) {
  await env.DB.prepare(
    "INSERT INTO attendance (id, json, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at"
  )
    .bind(JSON.stringify(summary), new Date().toISOString())
    .run();
}

// ---- VOD review (YouTube link + timestamped notes/drawings) ----

/** Pulls the 11-char video id out of any of the URL shapes YouTube hands out. */
export function youtubeIdFromUrl(url) {
  const m = String(url || "").match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
  );
  return m ? m[1] : null;
}

export async function listVods(env) {
  const { results } = await env.DB.prepare(
    `SELECT v.id, v.title, v.youtube_id, v.class, v.added_by_name, v.created_at,
            (SELECT COUNT(*) FROM vod_notes n WHERE n.vod_id = v.id) AS note_count
     FROM vods v ORDER BY v.created_at DESC`
  ).all();
  return results.map((r) => ({
    id: r.id,
    title: r.title,
    youtubeId: r.youtube_id,
    class: r.class || null,
    addedBy: r.added_by_name,
    createdAt: r.created_at,
    noteCount: r.note_count,
  }));
}

export async function getVod(env, id) {
  const row = await env.DB.prepare("SELECT * FROM vods WHERE id = ?").bind(id).first();
  if (!row) return null;
  const { results } = await env.DB.prepare(
    "SELECT * FROM vod_notes WHERE vod_id = ? ORDER BY timestamp_seconds ASC"
  ).bind(id).all();
  return {
    vod: {
      id: row.id,
      title: row.title,
      youtubeId: row.youtube_id,
      class: row.class || null,
      addedBy: row.added_by_name,
      addedByDiscordId: row.added_by_discord_id,
      createdAt: row.created_at,
    },
    notes: results.map((n) => ({
      id: n.id,
      timestampSeconds: n.timestamp_seconds,
      text: n.text,
      drawing: n.drawing_json ? JSON.parse(n.drawing_json) : null,
      author: n.author_name,
      authorDiscordId: n.author_discord_id,
      createdAt: n.created_at,
    })),
  };
}

/** Discord id of the VOD's poster, or null if the VOD doesn't exist — used for delete-permission checks before touching anything. */
export async function getVodOwner(env, id) {
  const row = await env.DB.prepare("SELECT added_by_discord_id FROM vods WHERE id = ?").bind(id).first();
  return row ? row.added_by_discord_id : null;
}

/** Discord id of the note's author, or null if the note doesn't exist. */
export async function getVodNoteOwner(env, vodId, noteId) {
  const row = await env.DB.prepare("SELECT author_discord_id FROM vod_notes WHERE id = ? AND vod_id = ?")
    .bind(noteId, vodId)
    .first();
  return row ? row.author_discord_id : null;
}

export async function createVod(env, { title, youtubeId, className, authorName, authorDiscordId }) {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO vods (id, title, youtube_id, class, added_by_name, added_by_discord_id, created_at) VALUES (?,?,?,?,?,?,?)"
  )
    .bind(id, title, youtubeId, className || null, authorName, authorDiscordId, createdAt)
    .run();
  return { id, title, youtubeId, class: className || null, addedBy: authorName, createdAt, noteCount: 0 };
}

export async function deleteVod(env, id) {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM vod_notes WHERE vod_id = ?").bind(id),
    env.DB.prepare("DELETE FROM vods WHERE id = ?").bind(id),
  ]);
  return { removed: true };
}

export async function addVodNote(env, vodId, { timestampSeconds, text, drawing, authorName, authorDiscordId }) {
  const vod = await env.DB.prepare("SELECT id FROM vods WHERE id = ?").bind(vodId).first();
  if (!vod) return null;
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const ts = Math.max(0, Math.round(timestampSeconds) || 0);
  await env.DB.prepare(
    "INSERT INTO vod_notes (id, vod_id, timestamp_seconds, text, drawing_json, author_name, author_discord_id, created_at) VALUES (?,?,?,?,?,?,?,?)"
  )
    .bind(id, vodId, ts, text || "", drawing ? JSON.stringify(drawing) : null, authorName, authorDiscordId, createdAt)
    .run();
  return { id, vodId, timestampSeconds: ts, text: text || "", drawing: drawing || null, author: authorName, createdAt };
}

export async function deleteVodNote(env, vodId, noteId) {
  await env.DB.prepare("DELETE FROM vod_notes WHERE id = ? AND vod_id = ?").bind(noteId, vodId).run();
  return { removed: true };
}

// ---- Clips (lighter-weight than VOD Review: a link + one class tag, no notes) ----

export async function listClips(env) {
  const { results } = await env.DB.prepare(
    "SELECT id, title, youtube_id, class, added_by_name, added_by_discord_id, created_at FROM clips ORDER BY created_at DESC"
  ).all();
  return results.map((r) => ({
    id: r.id,
    title: r.title,
    youtubeId: r.youtube_id,
    class: r.class || null,
    addedBy: r.added_by_name,
    addedByDiscordId: r.added_by_discord_id,
    createdAt: r.created_at,
  }));
}

/** Discord id of the clip's poster, or null if the clip doesn't exist — used for delete-permission checks before touching anything. */
export async function getClipOwner(env, id) {
  const row = await env.DB.prepare("SELECT added_by_discord_id FROM clips WHERE id = ?").bind(id).first();
  return row ? row.added_by_discord_id : null;
}

export async function createClip(env, { title, youtubeId, className, authorName, authorDiscordId }) {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO clips (id, title, youtube_id, class, added_by_name, added_by_discord_id, created_at) VALUES (?,?,?,?,?,?,?)"
  )
    .bind(id, title, youtubeId, className || null, authorName, authorDiscordId, createdAt)
    .run();
  return { id, title, youtubeId, class: className || null, addedBy: authorName, createdAt };
}

export async function deleteClip(env, id) {
  await env.DB.prepare("DELETE FROM clips WHERE id = ?").bind(id).run();
  return { removed: true };
}
