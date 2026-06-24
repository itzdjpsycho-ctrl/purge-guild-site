import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} from "discord.js";
import { SIGNUP_ROLES } from "../config.js";
import { fmtNum, fmtKD, fmtTime, fmtDate } from "./data.js";
import { topReasons } from "./mvp.js";
import { groupEntries } from "./signups.js";

export const PURPLE = 0x8b2fd9;
const GOLD = 0xc49a30;
const GREEN = 0x5bc976;
const RED = 0xd65a45;

function resultColor(result) {
  return result === "Victory" ? GOLD : RED;
}

// ---------- MVP ----------

export function mvpEmbed(war, mvpResult) {
  const { mvp, ranked } = mvpResult;
  const s = mvp.stats;
  const reasons = topReasons(mvp);

  const embed = new EmbedBuilder()
    .setColor(PURPLE)
    .setTitle(`🏆 War MVP — ${war.location}`)
    .setDescription(
      `**${mvp.name}** is the MVP of the ${fmtDate(war.date)} war ` +
        `(${war.result}).\n*Top contributions: ${reasons.join(" · ") || "—"}*`
    )
    .addFields(
      { name: "Kills / Deaths", value: `${s.kills} / ${s.deaths}`, inline: true },
      { name: "K/D", value: fmtKD(s.kills, s.deaths), inline: true },
      { name: "MVP Score", value: mvp.score.toFixed(2), inline: true },
      { name: "Damage Done", value: fmtNum(s.dmgDone), inline: true },
      { name: "Crowd Control", value: String(s.cc), inline: true },
      { name: "Fort Damage", value: fmtNum(s.fortDmg), inline: true },
      { name: "Ally Healing", value: fmtNum(s.allyHpHealed), inline: true },
      { name: "Best Streak", value: String(s.streak), inline: true },
      { name: "Time Alive", value: fmtTime(s.timeAlive), inline: true }
    );

  const runnersUp = ranked
    .slice(1, 4)
    .map(
      (p, i) =>
        `**${i + 2}.** ${p.name} — ${p.score.toFixed(2)} ` +
        `(${p.stats.kills}/${p.stats.deaths})`
    )
    .join("\n");
  if (runnersUp) embed.addFields({ name: "Runners-up", value: runnersUp });

  embed.setFooter({ text: `${war.day} · ${war.result}` });
  return embed;
}

// ---------- Player stats ----------

export function statsEmbed(history, war) {
  const w = war; // a single war entry from playerHistory
  const embed = new EmbedBuilder()
    .setColor(w.ext ? PURPLE : resultColor(w.result))
    .setTitle(`📊 ${history.name} — ${w.location}`)
    .setDescription(`${fmtDate(w.date)} · **${w.result}**`);

  if (!w.ext) {
    embed.addFields(
      { name: "Kills", value: String(w.kills), inline: true },
      { name: "Deaths", value: String(w.deaths), inline: true },
      { name: "K/D", value: fmtKD(w.kills, w.deaths), inline: true },
      { name: "Extended stats", value: "Not recorded for this war.", inline: false }
    );
    return embed;
  }

  const e = w.ext;
  embed.addFields(
    { name: "Kills", value: String(e.kills), inline: true },
    { name: "Deaths", value: String(e.deaths), inline: true },
    { name: "K/D", value: fmtKD(e.kills, e.deaths), inline: true },
    { name: "Best Streak", value: String(e.streak), inline: true },
    { name: "Crowd Control", value: String(e.cc), inline: true },
    { name: "Traps Triggered", value: String(e.traps), inline: true },
    { name: "Damage Done", value: fmtNum(e.dmgDone), inline: true },
    { name: "Damage Taken", value: fmtNum(e.dmgTaken), inline: true },
    { name: "Fort Damage", value: fmtNum(e.fortDmg), inline: true },
    { name: "HP Healed", value: fmtNum(e.hpHealed), inline: true },
    { name: "Ally HP Healed", value: fmtNum(e.allyHpHealed), inline: true },
    { name: "Objects Destroyed", value: String(e.objDestroyed), inline: true },
    { name: "Cannons Landed", value: String(e.cannonsLanded), inline: true },
    { name: "Time Alive", value: fmtTime(e.timeAlive), inline: true },
    { name: "Time Dead", value: fmtTime(e.timeDead), inline: true }
  );
  return embed;
}

/** Compact career-summary embed across all of a player's wars. */
export function statsSummaryEmbed(history) {
  const totals = history.wars.reduce(
    (t, w) => {
      t.kills += w.kills;
      t.deaths += w.deaths;
      return t;
    },
    { kills: 0, deaths: 0 }
  );
  const wins = history.wars.filter((w) => w.result === "Victory").length;

  const lines = history.wars
    .map(
      (w) =>
        `\`${w.date}\` ${w.location} — ${w.kills}/${w.deaths} ` +
        `(${fmtKD(w.kills, w.deaths)}) ${w.result === "Victory" ? "✅" : "❌"}`
    )
    .join("\n");

  return new EmbedBuilder()
    .setColor(PURPLE)
    .setTitle(`📊 ${history.name} — Career`)
    .setDescription(
      `**${history.wars.length}** wars · **${wins}W** · ` +
        `Total **${totals.kills}/${totals.deaths}** ` +
        `(${fmtKD(totals.kills, totals.deaths)} K/D)`
    )
    .addFields({ name: "War History", value: lines || "—" })
    .setFooter({ text: "Use /stats player:<name> date:<YYYY-MM-DD> for a single war's full stats." });
}

// ---------- Sign-up sheet ----------

const ROLE_LABEL = Object.fromEntries(
  SIGNUP_ROLES.map((r) => [r.id, `${r.emoji} ${r.label}`])
);

export function signupEmbed(signup) {
  const groups = groupEntries(signup);
  const closed = signup.status === "closed";

  const fmtList = (arr) =>
    arr.length
      ? arr
          .map(
            (e) =>
              `<@${e.userId}>${e.role ? ` — ${ROLE_LABEL[e.role] || e.role}` : ""}`
          )
          .join("\n")
      : "*nobody yet*";

  const embed = new EmbedBuilder()
    .setColor(closed ? 0x555160 : PURPLE)
    .setTitle(`🗓️ Node War Sign-Up${closed ? " (CLOSED)" : ""}`)
    .setDescription(
      [
        signup.date ? `**Date:** ${fmtDate(signup.date)}` : null,
        signup.location ? `**Node:** ${signup.location}` : null,
        signup.notes ? `\n${signup.notes}` : null,
      ]
        .filter(Boolean)
        .join("\n")
    )
    .addFields(
      { name: `✅ Attending (${groups.in.length})`, value: fmtList(groups.in) },
      { name: `❔ Maybe (${groups.maybe.length})`, value: fmtList(groups.maybe) },
      { name: `❌ Can't make it (${groups.out.length})`, value: fmtList(groups.out) }
    )
    .setFooter({
      text: closed
        ? "Sign-ups are closed."
        : "Tap a button below to sign up, then pick your squad role.",
    });
  return embed;
}

export function signupComponents(signup) {
  const disabled = signup.status === "closed";

  const attendance = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("signup:in")
      .setLabel("Attending")
      .setEmoji("✅")
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId("signup:maybe")
      .setLabel("Maybe")
      .setEmoji("❔")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId("signup:out")
      .setLabel("Can't make it")
      .setEmoji("❌")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId("signup:clear")
      .setLabel("Withdraw")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled)
  );

  const roleMenu = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("signup:role")
      .setPlaceholder("Pick your squad role (optional)")
      .setDisabled(disabled)
      .addOptions(
        SIGNUP_ROLES.map((r) => ({
          label: r.label,
          value: r.id,
          emoji: r.emoji,
        }))
      )
  );

  return [attendance, roleMenu];
}
