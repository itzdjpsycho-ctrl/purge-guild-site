// MIRROR of bot/src/config.js — keep in sync. The static site + this Worker
// can't import the bot's ESM config, so the role/status/class lists are copied
// here. The load-bearing part is the IDs (frontliner, in/late/…, customIds);
// labels/emoji/caps are cosmetic and self-heal once the bot re-renders.

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

// style → Discord ButtonStyle int (Primary 1, Secondary 2, Success 3, Danger 4)
export const SIGNUP_STATUSES = [
  { id: "in", label: "In-game", emoji: "🟢", style: 3 },
  { id: "bench", label: "Bench", emoji: "🪑", style: 2 },
  { id: "late", label: "Late", emoji: "🕐", style: 2 },
  { id: "tentative", label: "Tentative", emoji: "⚖️", style: 2 },
  { id: "absence", label: "Absence", emoji: "🚫", style: 4 },
];

export const SITE_URL = "https://itzdjpsycho-ctrl.github.io/purge-guild-site";

export const BDO_CLASSES = [
  "Warrior", "Ranger", "Sorceress", "Berserker", "Tamer", "Musa", "Maehwa",
  "Valkyrie", "Kunoichi", "Ninja", "Wizard", "Witch", "Dark Knight", "Striker",
  "Mystic", "Lahn", "Archer", "Shai", "Guardian", "Nova", "Sage", "Corsair",
  "Hashashin", "Drakania", "Woosa", "Maegu", "Scholar", "Dosa", "Deadeye",
  "Wukong", "Seraph",
];
