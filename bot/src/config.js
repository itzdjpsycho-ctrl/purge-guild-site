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
export const SITE_URL = process.env.SITE_URL || "https://cheery-puppy-6057d8.netlify.app";

/** 31 BDO classes (verified NA/EU), used for /profile class autocomplete. */
export const BDO_CLASSES = [
  "Warrior", "Ranger", "Sorceress", "Berserker", "Tamer", "Musa", "Maehwa",
  "Valkyrie", "Kunoichi", "Ninja", "Wizard", "Witch", "Dark Knight", "Striker",
  "Mystic", "Lahn", "Archer", "Shai", "Guardian", "Nova", "Sage", "Corsair",
  "Hashashin", "Drakania", "Woosa", "Maegu", "Scholar", "Dosa", "Deadeye",
  "Wukong", "Seraph",
];

/** BDO squad roles offered on the sign-up sheet. */
export const SIGNUP_ROLES = [
  { id: "mainball", label: "Mainball", emoji: "⚔️" },
  { id: "shotcaller", label: "Shotcaller", emoji: "📣" },
  { id: "defensive", label: "Defensive", emoji: "🛡️" },
  { id: "flex", label: "Flex Squad", emoji: "🔀" },
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
