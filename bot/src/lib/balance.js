// Balanced War Builder — pure logic + Discord UI for /balance.
//
// You enter guilds with a "seed" (1 = strongest … 10 = weakest) and the bot
// splits them into two teams whose total skill is as even as possible, with a
// dash of randomness so you can re-roll for different equally-balanced splits.
import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";

export const PURPLE = 0x8b2fd9;
export const MAX_GUILDS = 24;

/**
 * Convert a seed to a strength weight.
 * Seed 1 (strongest) → 10, seed 10 (weakest) → 1, so a bigger weight = better.
 */
export function strength(seed) {
  return 11 - seed;
}

/**
 * Parse a textarea of guild lines. Each non-blank line is "Name <seed>" or
 * "Name, <seed>" where the trailing number (1–10) is the seed and everything
 * before it is the guild name. Lines we can't read are returned in `errors`.
 */
export function parseGuilds(text) {
  const guilds = [];
  const errors = [];
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(.*?)[\s,]+(\d{1,2})$/);
    if (!m) {
      errors.push(line);
      continue;
    }
    const name = m[1].replace(/,+$/, "").trim();
    const seed = Number(m[2]);
    if (!name || seed < 1 || seed > 10) {
      errors.push(line);
      continue;
    }
    guilds.push({ name, seed });
  }
  return { guilds, errors };
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Split guilds into two teams of near-equal total strength.
 *
 * Runs many randomized greedy passes (shuffle the order, drop each guild onto
 * the currently-lighter team), keeps every distinct split that ties for the
 * best score, then returns one at random — so re-rolls surface different but
 * equally-balanced fights. Skill gap dominates; team-size difference is the
 * tie-breaker so the two sides also end up roughly the same headcount.
 */
export function balanceTeams(guilds, { trials = 3000 } = {}) {
  if (!guilds || guilds.length < 2) return null;

  let bestScore = Infinity;
  const candidates = new Map(); // signature → split

  for (let t = 0; t < trials; t++) {
    const order = shuffle(guilds.slice());
    const a = [];
    const b = [];
    let sa = 0;
    let sb = 0;
    for (const g of order) {
      const w = strength(g.seed);
      const toA =
        sa < sb
          ? true
          : sb < sa
            ? false
            : a.length !== b.length
              ? a.length < b.length
              : Math.random() < 0.5;
      if (toA) {
        a.push(g);
        sa += w;
      } else {
        b.push(g);
        sb += w;
      }
    }

    const diff = Math.abs(sa - sb);
    const sizeDiff = Math.abs(a.length - b.length);
    const score = diff * 1000 + sizeDiff;

    if (score < bestScore) {
      bestScore = score;
      candidates.clear();
    }
    if (score === bestScore) {
      const namesA = a.map((g) => g.name).sort();
      const namesB = b.map((g) => g.name).sort();
      const sig = [namesA.join("|"), namesB.join("|")].sort().join("##");
      if (!candidates.has(sig)) candidates.set(sig, { a, b, sa, sb, diff });
    }
  }

  const list = [...candidates.values()];
  const pick = list[Math.floor(Math.random() * list.length)];

  // Randomize which side is labelled "A" so re-rolls don't always look the same.
  const flip = Math.random() < 0.5;
  const first = flip ? { team: pick.b, total: pick.sb } : { team: pick.a, total: pick.sa };
  const second = flip ? { team: pick.a, total: pick.sa } : { team: pick.b, total: pick.sb };
  return {
    teamA: first.team,
    teamB: second.team,
    totalA: first.total,
    totalB: second.total,
    diff: pick.diff,
  };
}

const seedTag = (g) => `\`${String(g.seed).padStart(2)}\` ${g.name}`;

/** The builder panel embed; pass a `result` to also show the two teams. */
export function balanceEmbed(session, result = session.result) {
  const { guilds } = session;
  const embed = new EmbedBuilder().setColor(PURPLE).setTitle("⚖️ Balanced War Builder");

  if (!guilds.length) {
    embed.setDescription(
      "No guilds added yet. Tap **➕ Add Guilds** and enter one per line as " +
        "`Name seed` — seed **1 = strongest … 10 = weakest**."
    );
    return embed;
  }

  const roster = guilds
    .slice()
    .sort((x, y) => x.seed - y.seed || x.name.localeCompare(y.name))
    .map(seedTag)
    .join("\n");
  embed.addFields({
    name: `Entered guilds (${guilds.length})`,
    value: roster.slice(0, 1024),
  });

  if (result) {
    const fmt = (team) =>
      (team.length ? team.slice().sort((x, y) => x.seed - y.seed).map(seedTag).join("\n") : "—").slice(0, 1024);
    embed.addFields(
      {
        name: `🟣 Team A — strength ${result.totalA} (${result.teamA.length})`,
        value: fmt(result.teamA),
        inline: true,
      },
      {
        name: `🔵 Team B — strength ${result.totalB} (${result.teamB.length})`,
        value: fmt(result.teamB),
        inline: true,
      }
    );
    embed.setFooter({
      text:
        result.diff === 0
          ? "Perfectly balanced. 🎲 Re-roll for another even split."
          : `Skill gap: ${result.diff}. 🎲 Re-roll to try for a closer split.`,
    });
  } else {
    embed.setFooter({ text: "Tap 🎲 Balance Teams when everyone's in. Seed 1 = strongest." });
  }
  return embed;
}

export function balanceComponents(session) {
  const hasGuilds = session.guilds.length > 0;
  const canRoll = session.guilds.length >= 2;
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("balance:add")
      .setLabel("Add Guilds")
      .setEmoji("➕")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("balance:roll")
      .setLabel("Balance Teams")
      .setEmoji("🎲")
      .setStyle(ButtonStyle.Success)
      .setDisabled(!canRoll),
    new ButtonBuilder()
      .setCustomId("balance:clear")
      .setLabel("Clear")
      .setEmoji("🗑️")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!hasGuilds)
  );
  return [row];
}
