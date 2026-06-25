import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadData, allPlayerNames } from "./data.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Committed profiles file at repo root, read by the website too.
// bot/src/lib -> ../../../profiles.js
export const PROFILES_PATH = join(__dirname, "..", "..", "..", "profiles.js");

// Maps the /upload slot choice to the website's profile image key.
export const SLOT_KEYS = {
  gear: "gearImg",
  crystals: "crystalsImg",
  addons: "addonsImg",
};

/** All names the site knows about (roster + everyone who's played a war). */
export function knownNames() {
  const set = new Map(); // lowercase -> canonical
  for (const n of loadData().rosterMembers) set.set(n.toLowerCase(), n);
  for (const n of allPlayerNames()) if (!set.has(n.toLowerCase())) set.set(n.toLowerCase(), n);
  return set;
}

/** Resolve a typed name to its canonical roster casing, or null if unknown. */
export function canonicalName(query) {
  return knownNames().get(String(query).toLowerCase().trim()) || null;
}

export function loadProfiles() {
  if (!existsSync(PROFILES_PATH)) return {};
  const raw = readFileSync(PROFILES_PATH, "utf8");
  try {
    const json = raw
      .replace(/^[\s\S]*window\.GUILD_PROFILES\s*=\s*/, "")
      .replace(/;\s*$/, "");
    return JSON.parse(json);
  } catch {
    return {};
  }
}

export function writeProfiles(profiles) {
  const header =
    "// Canonical guild PROFILES — class + gear/crystal/addon screenshots per\n" +
    "// player, managed by the Discord bot (/profile commands). The website reads\n" +
    "// this via <script src=\"profiles.js\"> as the shared layer for player pages.\n" +
    "// Contains NO Discord IDs — the name<->Discord link is kept privately on the\n" +
    "// bot host (bot/data/links.json), never published here.\n";
  const body = "window.GUILD_PROFILES = " + JSON.stringify(profiles, null, 2) + ";\n";
  writeFileSync(PROFILES_PATH, header + body);
}

export function getProfile(name) {
  return loadProfiles()[name] || null;
}

export function setClass(name, className) {
  const profiles = loadProfiles();
  if (!profiles[name]) return false;
  profiles[name].class = className;
  profiles[name].updatedAt = new Date().toISOString();
  writeProfiles(profiles);
  return true;
}

/** Set an image path (relative, e.g. assets/profiles/x-gear.png) for a slot. */
export function setImage(name, slotKey, relativePath) {
  const profiles = loadProfiles();
  if (!profiles[name]) profiles[name] = {};
  const prev = profiles[name][slotKey];
  profiles[name][slotKey] = relativePath;
  profiles[name].updatedAt = new Date().toISOString();
  writeProfiles(profiles);
  return prev || null;
}

/**
 * Store gear stats (ap / aap / dp) for a player. Only non-null values are
 * written, so a stat the screenshot reader couldn't see never clobbers an
 * existing good value. The website derives Gear Score = (ap+aap)/2 + dp.
 */
export function setGear(name, { ap, aap, dp } = {}) {
  const profiles = loadProfiles();
  if (!profiles[name]) profiles[name] = {};
  if (ap != null) profiles[name].ap = ap;
  if (aap != null) profiles[name].aap = aap;
  if (dp != null) profiles[name].dp = dp;
  profiles[name].updatedAt = new Date().toISOString();
  writeProfiles(profiles);
  return profiles[name];
}

export function unlink(userId) {
  const owned = findByDiscord(userId);
  if (!owned) return null;
  const profiles = loadProfiles();
  delete profiles[owned[0]].discordId;
  writeProfiles(profiles);
  return owned[0];
}
