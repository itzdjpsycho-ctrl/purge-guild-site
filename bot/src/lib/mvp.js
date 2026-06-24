import { MVP_WEIGHTS } from "../config.js";
import { extendedFor, rowToObj } from "./data.js";

/**
 * Compute the single overall MVP for a war.
 *
 * Each scored stat is normalized to its max across all players IN THIS WAR
 * (0..1), then combined with the configured weights. This keeps scoring fair
 * between high-kill open wars and grindy defensive holds.
 *
 * Returns { ranked: [{ name, score, stats, contributions }], mvp } or null if
 * the war has no extended stats to score on.
 */
export function computeMVP(war) {
  const rows = extendedFor(war.date);
  if (!rows.length) return null;

  const players = rows.map((r) => {
    const o = rowToObj(r);
    return {
      name: o.name,
      stats: o,
      metrics: {
        kills: o.kills,
        kd: o.kills / Math.max(o.deaths, 1),
        dmgDone: o.dmgDone,
        cc: o.cc,
        fortDmg: o.fortDmg,
        allyHpHealed: o.allyHpHealed,
        objDestroyed: o.objDestroyed,
        cannonsLanded: o.cannonsLanded,
        deaths: o.deaths,
      },
    };
  });

  // Max per metric across the war (avoid divide-by-zero).
  const maxes = {};
  for (const key of Object.keys(MVP_WEIGHTS)) {
    maxes[key] = Math.max(1, ...players.map((p) => p.metrics[key] || 0));
  }

  for (const p of players) {
    let score = 0;
    p.contributions = {};
    for (const [key, weight] of Object.entries(MVP_WEIGHTS)) {
      const norm = (p.metrics[key] || 0) / maxes[key];
      const contrib = weight * norm;
      p.contributions[key] = contrib;
      score += contrib;
    }
    p.score = score;
  }

  const ranked = players.sort((a, b) => b.score - a.score);
  return { ranked, mvp: ranked[0] };
}

/**
 * Produce the top few stat reasons a player won MVP, highest positive
 * contribution first. Returns e.g. ["Kills", "Damage Done", "Fort Damage"].
 */
const REASON_LABELS = {
  kills: "Kills",
  kd: "K/D Ratio",
  dmgDone: "Damage Done",
  cc: "Crowd Control",
  fortDmg: "Fort Damage",
  allyHpHealed: "Ally Healing",
  objDestroyed: "Objects Destroyed",
  cannonsLanded: "Cannons Landed",
};

export function topReasons(player, count = 3) {
  return Object.entries(player.contributions)
    .filter(([key, v]) => v > 0 && REASON_LABELS[key])
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([key]) => REASON_LABELS[key]);
}
