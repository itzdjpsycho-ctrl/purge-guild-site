import "dotenv/config";

export const TOKEN = process.env.DISCORD_TOKEN;
export const CLIENT_ID = process.env.CLIENT_ID;
export const GUILD_ID = process.env.GUILD_ID;

export const ADMIN_ROLE_IDS = (process.env.ADMIN_ROLE_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * MVP scoring weights.
 *
 * Each stat is normalized to its maximum value WITHIN a single war (0..1),
 * so a quiet defensive war and a bloodbath are scored on the same scale.
 * The weighted sum of those normalized stats is the player's MVP score.
 * Tune these freely — higher weight = matters more for MVP.
 */
export const MVP_WEIGHTS = {
  kills: 1.0,
  kd: 0.6, // kills / max(deaths, 1)
  dmgDone: 0.8,
  cc: 0.5,
  fortDmg: 0.7,
  allyHpHealed: 0.5,
  objDestroyed: 0.4,
  cannonsLanded: 0.4,
  deaths: -0.3, // penalty (more deaths lowers score)
};

/** Public site base URL — used to link/preview uploaded screenshots. */
export const SITE_URL = process.env.SITE_URL || "https://itzdjpsycho-ctrl.github.io/purge-guild-site";

/**
 * Anthropic API key for screenshot OCR — reading Gear Score off a gear shot
 * (`/profile upload slot:Gear`) and extracting war results (`/addwar`).
 * OPTIONAL — if unset, gear uploads still save the image (just no auto score)
 * and `/addwar` reports that OCR is off.
 */
export const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
/** Vision model used for screenshot OCR (gear + war). Matches the website. */
export const VISION_MODEL = process.env.VISION_MODEL || "claude-sonnet-4-6";

/** 31 BDO classes (verified NA/EU), used for /profile class autocomplete. */
export const BDO_CLASSES = [
  "Warrior", "Ranger", "Sorceress", "Berserker", "Tamer", "Musa", "Maehwa",
  "Valkyrie", "Kunoichi", "Ninja", "Wizard", "Witch", "Dark Knight", "Striker",
  "Mystic", "Lahn", "Archer", "Shai", "Guardian", "Nova", "Sage", "Corsair",
  "Hashashin", "Drakania", "Woosa", "Maegu", "Scholar", "Dosa", "Deadeye",
  "Wukong", "Seraph",
];

/**
 * Node War role groups shown on the sign-up sheet, in display order.
 * `cap` is the capacity (filled/cap shown on the sheet); members can't
 * self-pick a role that's full, but admins can override via `/signup add`.
 * Tune names / caps / emoji freely.
 */
export const SIGNUP_ROLES = [
  { id: "frontliner", label: "Frontliner", emoji: "⚔️", cap: 5 },
  { id: "ranged", label: "Ranged", emoji: "🏹", cap: 4 },
  { id: "skirmisher", label: "Skirmisher", emoji: "🗡️", cap: 6 },
  { id: "caster", label: "Caster", emoji: "🔮", cap: 3 },
  { id: "shai", label: "Shai", emoji: "🎶", cap: 2 },
  { id: "trooper", label: "Trooper", emoji: "🐎", cap: 3 },
  { id: "defense", label: "Defense", emoji: "🛡️", cap: 3 },
  { id: "flex", label: "Flex", emoji: "🔀", cap: 1 },
  { id: "scout", label: "Scout", emoji: "🔭", cap: 1 },
  { id: "elephant", label: "Elephant", emoji: "🐘", cap: 1 },
  { id: "shotcaller", label: "Shotcaller", emoji: "📣", cap: 1 },
];

/**
 * Availability states. `in`/`late` count toward a role's filled capacity and
 * show in their role column (late tagged with ⏰); `bench` shows struck-through
 * in its column; `tentative`/`absence` are listed separately at the bottom.
 * `style` maps to a discord.js ButtonStyle.
 */
export const SIGNUP_STATUSES = [
  { id: "in", label: "In-game", emoji: "🟢", style: "Success" },
  { id: "bench", label: "Bench", emoji: "🪑", style: "Secondary" },
  { id: "late", label: "Late", emoji: "🕐", style: "Secondary" },
  { id: "tentative", label: "Tentative", emoji: "⚖️", style: "Secondary" },
  { id: "absence", label: "Absence", emoji: "🚫", style: "Danger" },
];

export function assertConfig() {
  const missing = [];
  if (!TOKEN) missing.push("DISCORD_TOKEN");
  if (!CLIENT_ID) missing.push("CLIENT_ID");
  if (!GUILD_ID) missing.push("GUILD_ID");
  if (missing.length) {
    throw new Error(
      `Missing required env vars: ${missing.join(", ")}. ` +
        `Copy .env.example to .env and fill them in.`
    );
  }
}
