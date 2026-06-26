import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "..", "data");
const CONFIG_PATH = join(DATA_DIR, "config.json");

/**
 * Private (git-ignored) bot config — currently just the designated channel that
 * website-posted sign-up sheets go to. Set in Discord via `/signup channel set`
 * and mirrored to the Cloudflare Worker so it can post even when this PC is off.
 */
function readAll() {
  if (!existsSync(CONFIG_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return {};
  }
}

function writeAll(cfg) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n");
}

/** The Discord channel id sign-up sheets are posted to, or null. */
export function getSignupChannelId() {
  return readAll().signupChannelId || null;
}

export function setSignupChannelId(channelId) {
  const cfg = readAll();
  cfg.signupChannelId = channelId;
  cfg.updatedAt = new Date().toISOString();
  writeAll(cfg);
  return cfg;
}
