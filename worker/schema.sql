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
