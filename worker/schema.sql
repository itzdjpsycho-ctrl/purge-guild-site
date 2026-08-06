-- D1 schema for the canonical guild data (formerly data.js/profiles.js/attendance.js).
-- Deliberately denormalized (JSON blob per row) — the site already does all
-- aggregation client-side over the whole object, and write volume is a
-- handful of officer edits a week, so there's no query-performance case for
-- normalizing further. See worker/src/data.js for the shape reconstruction.

CREATE TABLE IF NOT EXISTS matches (
  date TEXT PRIMARY KEY,       -- "YYYY-MM-DD"
  day TEXT NOT NULL,
  location TEXT NOT NULL,
  result TEXT NOT NULL,        -- "Victory" | "Defeat"
  players_json TEXT NOT NULL   -- [[name, kills, deaths], ...]
);

CREATE TABLE IF NOT EXISTS extended_stats (
  date TEXT PRIMARY KEY,       -- joins to matches.date
  rows_json TEXT NOT NULL      -- [[name, kills, deaths, streak, ...], ...] per extendedColumns order
);

CREATE TABLE IF NOT EXISTS roster_members (
  name TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS profiles (
  name TEXT PRIMARY KEY,
  json TEXT NOT NULL           -- {class, gearImg, crystalsImg, addonsImg, ap, aap, dp, vacation, exception, updatedAt}
);

CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY CHECK (id = 1),  -- singleton row
  json TEXT NOT NULL,          -- {players: {...}, byWar: {...}}
  updated_at TEXT NOT NULL
);

-- VOD Review: members post a YouTube link, then leave timestamped notes on it
-- (optionally with a freehand drawing attached) for teaching/coaching. See
-- vod-review.html + the /vods routes in worker/src/worker.js.
CREATE TABLE IF NOT EXISTS vods (
  id TEXT PRIMARY KEY,             -- crypto.randomUUID()
  title TEXT NOT NULL,
  youtube_id TEXT NOT NULL,        -- 11-char YouTube video id, extracted server-side from the pasted URL
  class TEXT,                      -- nullable: one of worker/src/constants.js BDO_CLASSES, or NULL for "General"
  added_by_name TEXT NOT NULL,     -- family name (or Discord username fallback) at post time
  added_by_discord_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vod_notes (
  id TEXT PRIMARY KEY,
  vod_id TEXT NOT NULL,
  timestamp_seconds INTEGER NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  drawing_json TEXT,               -- nullable: [{color,width,points:[[x,y],...]}, ...] in 0-1 normalized coords
  author_name TEXT NOT NULL,
  author_discord_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vod_notes_vod_id ON vod_notes(vod_id);

-- One row per (vod, member) who liked it — PRIMARY KEY doubles as the
-- uniqueness constraint that makes the like a toggle. See toggleVodLike()
-- in worker/src/data.js.
CREATE TABLE IF NOT EXISTS vod_likes (
  vod_id TEXT NOT NULL,
  discord_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (vod_id, discord_id)
);

-- Clips: a lighter-weight board than VOD Review — just a video link + a
-- single class tag, no timestamped notes/drawings. Members post highlight/fail
-- clips here for browsing by class. Two sources: a YouTube link (embedded via
-- iframe, youtube_id set) or a direct Discord CDN attachment link (played
-- back with <video>, video_url set) — see clips.html + the /clips routes.
CREATE TABLE IF NOT EXISTS clips (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'youtube',  -- "youtube" | "discord"
  youtube_id TEXT,                 -- set when source = "youtube"
  video_url TEXT,                  -- set when source = "discord" (full CDN URL incl. signature params)
  class TEXT,                      -- nullable: one of worker/src/constants.js BDO_CLASSES, or NULL for "General"
  added_by_name TEXT NOT NULL,
  added_by_discord_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Combat Log: a member can save a parsed/deduped log upload to the site so
-- it's browsable later without re-uploading the file, optionally linked to
-- a war (matches.date) so it surfaces alongside that war's record. Stores
-- the PARSED events (not the raw .log text) — combat-log.html never
-- renders anything else, and it's far smaller than the raw export. See
-- combat-log.html + the /combat-logs routes in worker/src/worker.js.
CREATE TABLE IF NOT EXISTS combat_logs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  war_date TEXT,                   -- nullable: matches.date this log is linked to
  events_json TEXT NOT NULL,       -- [{time,killer,victim,killerChar,victimChar,guild,isKillPhrasing}, ...]
  event_count INTEGER NOT NULL,    -- denormalized so the list view doesn't need to parse events_json
  added_by_name TEXT NOT NULL,
  added_by_discord_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_combat_logs_war_date ON combat_logs(war_date);
