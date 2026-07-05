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
 * Cloudflare Worker relay that bridges the website's "Sign Ups" page to Discord.
 * OPTIONAL — if `WORKER_URL` is unset, all Worker calls become no-ops, so the
 * bot runs fine standalone. `BOT_PUSH_SECRET` must match the Worker's secret of
 * the same name; it gates the bot-only endpoints (/state, /config, /posted).
 * The Worker reuses the value of DISCORD_TOKEN as its own DISCORD_BOT_TOKEN.
 */
export const WORKER_URL = (process.env.WORKER_URL || "").replace(/\/+$/, "");
export const BOT_PUSH_SECRET = process.env.BOT_PUSH_SECRET || "";

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
 * `group` ("core" damage roles vs "support") only drives the divider line
 * the embed draws between groups — purely cosmetic, safe to omit.
 * Tune names / caps / emoji freely.
 */
export const SIGNUP_ROLES = [
  { id: "frontliner", label: "Frontliner", emoji: "⚔️", cap: 5, group: "core" },
  { id: "ranged", label: "Ranged", emoji: "🏹", cap: 4, group: "core" },
  { id: "skirmisher", label: "Skirmisher", emoji: "🗡️", cap: 6, group: "core" },
  { id: "caster", label: "Caster", emoji: "🔮", cap: 3, group: "core" },
  { id: "shai", label: "Shai", emoji: "🎶", cap: 2, group: "support" },
  { id: "trooper", label: "Trooper", emoji: "🐎", cap: 3, group: "support" },
  { id: "defense", label: "Defense", emoji: "🛡️", cap: 3, group: "support" },
  { id: "flex", label: "Flex", emoji: "🔀", cap: 1, group: "support" },
  { id: "scout", label: "Scout", emoji: "🔭", cap: 1, group: "support" },
  { id: "elephant", label: "Elephant", emoji: "🐘", cap: 1, group: "support" },
  { id: "shotcaller", label: "Shotcaller", emoji: "📣", cap: 1, group: "support" },
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

/**
 * Which BDO classes belong to each sign-up role. Picking a role offers exactly
 * these classes (as buttons), and — strict — only these classes can be set for
 * that role. A role NOT listed here (Defense, Scout, Trooper, Flex, Elephant,
 * Shotcaller) is "any class": it keeps the full class dropdown and accepts any
 * class. Edit freely; a class may appear in more than one role.
 */
export const ROLE_CLASSES = {
  frontliner: ["Warrior", "Berserker", "Valkyrie", "Guardian", "Drakania", "Nova", "Striker", "Mystic", "Wukong", "Seraph", "Corsair"],
  ranged: ["Ranger", "Archer"],
  skirmisher: ["Sorceress", "Ninja", "Kunoichi", "Musa", "Maehwa", "Lahn", "Hashashin", "Dosa", "Maegu", "Corsair", "Tamer", "Dark Knight", "Deadeye", "Sage", "Woosa", "Scholar"],
  caster: ["Wizard", "Witch"],
  shai: ["Shai"],
};

/** The class list for a role, or null when the role is "any class". */
export function classesForRole(roleId) {
  const list = ROLE_CLASSES[roleId];
  return list && list.length ? list : null;
}

/** Strict check: may this class be set for this role? "Any class" roles allow all. */
export function roleAllowsClass(roleId, cls) {
  const list = classesForRole(roleId);
  return !list || list.includes(cls);
}

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
