import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} from "discord.js";
import { SIGNUP_ROLES, SIGNUP_STATUSES, BDO_CLASSES, ROLE_CLASSES, SITE_URL } from "../config.js";
import { fmtNum, fmtKD, fmtTime, fmtDate } from "./data.js";
import { topReasons } from "./mvp.js";
import { roleFill } from "./signups.js";
import { parseWarStart } from "./wartime.js";

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

const ROLE_BY_ID = Object.fromEntries(SIGNUP_ROLES.map((r) => [r.id, r]));
const STATUS_BY_ID = Object.fromEntries(SIGNUP_STATUSES.map((s) => [s.id, s]));
const BUTTON_STYLE = {
  Primary: ButtonStyle.Primary,
  Secondary: ButtonStyle.Secondary,
  Success: ButtonStyle.Success,
  Danger: ButtonStyle.Danger,
};

/**
 * One roster line: `42` Name (struck through when benched, ⏰ when late,
 * struck through + ⏳ when waitlisted for a full role).
 */
function memberLine(e, waitlisted = false) {
  const tag = `\`${String(e.num).padStart(2, " ")}\` `;
  if (e.status === "bench") return `${tag}~~${e.name}~~`;
  if (waitlisted) return `${tag}~~${e.name}~~ ⏳`;
  if (e.status === "late") return `${tag}${e.name} ⏰`;
  return `${tag}${e.name}`;
}

/** Bucket every entry into its role column / the unassigned + bottom lists. */
function arrange(signup) {
  const byRole = Object.fromEntries(SIGNUP_ROLES.map((r) => [r.id, []]));
  const unassigned = []; // in/late, no role yet — leadership needs to place
  const benchNoRole = []; // benched and not slotted into a role
  const tentative = [];
  const absence = [];

  const entries = Object.entries(signup.entries)
    .map(([userId, e]) => ({ userId, ...e }))
    .sort((a, b) => a.num - b.num);

  for (const e of entries) {
    if (e.status === "tentative") tentative.push(e);
    else if (e.status === "absence") absence.push(e);
    else if (e.role && byRole[e.role]) byRole[e.role].push(e);
    else if (e.status === "bench") benchNoRole.push(e);
    else unassigned.push(e);
  }
  return { byRole, unassigned, benchNoRole, tentative, absence };
}

const clip = (s) => (s.length > 1024 ? s.slice(0, 1021) + "…" : s);

export function signupEmbed(signup) {
  const closed = signup.status === "closed";
  const g = arrange(signup);
  const caps = signup.caps || {};
  const capOf = (r) => (caps[r.id] != null ? caps[r.id] : r.cap);

  const attending = SIGNUP_ROLES.reduce((n, r) => n + roleFill(signup, r.id), 0) + g.unassigned.length;

  const weekday = (() => {
    const d = new Date(`${signup.date}T00:00:00`);
    return Number.isNaN(d.getTime())
      ? ""
      : d.toLocaleDateString("en-US", { weekday: "long" }).toUpperCase();
  })();

  const embed = new EmbedBuilder()
    .setColor(closed ? 0x555160 : PURPLE)
    .setTitle(`⚔️ NODE WAR${weekday ? ` · ${weekday}` : ""}${closed ? " (CLOSED)" : ""}`);

  if (signup.notes) embed.setDescription(signup.notes);

  // Discord's <t:seconds:F/R> renders in each viewer's own timezone/locale.
  // Falls back to plain text if the free-text time field can't be parsed.
  const start = parseWarStart(signup.date, signup.time);
  const startsValue = start
    ? `<t:${Math.floor(start.getTime() / 1000)}:F>  ·  <t:${Math.floor(start.getTime() / 1000)}:R>`
    : `${signup.date ? fmtDate(signup.date) : "TBD"}${signup.time ? ` · ${signup.time}` : ""}`;

  // Header info row (inline → sits in columns like the reference sheet).
  embed.addFields(
    { name: "📍 Node", value: signup.location || "TBD", inline: true },
    { name: "🕐 Starts", value: startsValue, inline: true }
  );

  // Role columns. Beyond capacity, "in"/"late" members are still added (never
  // turned away) but rendered struck-through as waitlisted — first-signed-up,
  // first-slotted. Purely computed from sign-up order at render time, so a
  // withdrawal elsewhere instantly un-strikes the next person in line.
  for (const r of SIGNUP_ROLES) {
    const list = g.byRole[r.id];
    const fill = roleFill(signup, r.id);
    const cap = capOf(r);
    let activeSeen = 0;
    const lines = list.map((e) => {
      let waitlisted = false;
      if (e.status === "in" || e.status === "late") {
        activeSeen++;
        if (cap && activeSeen > cap) waitlisted = true;
      }
      return memberLine(e, waitlisted);
    });
    embed.addFields({
      name: `${r.emoji} ${r.label} (${fill}/${cap})`,
      value: lines.length ? clip(lines.join("\n")) : "—",
      inline: true,
    });
  }

  // Unassigned / bench / tentative / absence (full-width lists).
  if (g.unassigned.length) {
    embed.addFields({
      name: `🎯 Needs a role (${g.unassigned.length})`,
      value: clip(g.unassigned.map(memberLine).join("\n")),
    });
  }
  if (g.benchNoRole.length) {
    embed.addFields({
      name: `🪑 Bench (${g.benchNoRole.length})`,
      value: clip(g.benchNoRole.map(memberLine).join("\n")),
    });
  }
  if (g.tentative.length) {
    embed.addFields({
      name: `⚖️ Tentative (${g.tentative.length})`,
      value: clip(g.tentative.map((e) => `\`${e.num}\` ${e.name}`).join(", ")),
    });
  }
  if (g.absence.length) {
    embed.addFields({
      name: `🚫 Absence (${g.absence.length})`,
      value: clip(g.absence.map((e) => `\`${e.num}\` ~~${e.name}~~`).join(", ")),
    });
  }

  embed.setFooter({
    text: closed
      ? "Sign-ups are closed."
      : `${attending} in · Pick a role + class below, then set your availability.`,
  });
  return embed;
}

// The 31 BDO classes won't fit one 25-option select, so split alphabetically.
const SORTED_CLASSES = [...BDO_CLASSES].sort((a, b) => a.localeCompare(b));
const CLASS_SPLIT = Math.ceil(SORTED_CLASSES.length / 2);
const CLASS_GROUPS = [
  SORTED_CLASSES.slice(0, CLASS_SPLIT),
  SORTED_CLASSES.slice(CLASS_SPLIT),
];

export function signupComponents(signup) {
  const disabled = signup.status === "closed";

  const roleRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("signup:role")
      .setPlaceholder("Pick your role")
      .setDisabled(disabled)
      .addOptions(
        SIGNUP_ROLES.map((r) => ({ label: r.label, value: r.id, emoji: r.emoji }))
      )
  );

  const statusRow = new ActionRowBuilder().addComponents(
    SIGNUP_STATUSES.map((s) =>
      new ButtonBuilder()
        .setCustomId(`signup:st:${s.id}`)
        .setLabel(s.label)
        .setEmoji(s.emoji)
        .setStyle(BUTTON_STYLE[s.style] || ButtonStyle.Secondary)
        .setDisabled(disabled)
    )
  );

  const withdrawRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("signup:withdraw")
      .setLabel("Withdraw")
      .setEmoji("🗑️")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setLabel("Web View")
      .setEmoji("🌐")
      .setStyle(ButtonStyle.Link)
      .setURL(`${SITE_URL}/signups.html`)
  );

  // Class is no longer picked on the sheet — picking a role pops up an ephemeral
  // class picker (see classPickerComponents), so each member only sees their
  // own role's classes.
  return [roleRow, statusRow, withdrawRow];
}

/**
 * Ephemeral "Pick your class" components shown after a member selects a role.
 * Restricted roles get class BUTTONS (≤5 per row); "any class" roles fall back
 * to the two A–N / O–Z dropdowns. Every customId carries the sheet's messageId
 * so the click (which arrives on the ephemeral message) can find its sheet.
 */
export function classPickerComponents(roleId, messageId) {
  const list = ROLE_CLASSES[roleId];
  if (list && list.length) {
    const rows = [];
    for (let i = 0; i < list.length; i += 5) {
      rows.push(
        new ActionRowBuilder().addComponents(
          list.slice(i, i + 5).map((c) =>
            new ButtonBuilder()
              .setCustomId(`signup:setcls:${messageId}:${c}`)
              .setLabel(c)
              .setStyle(ButtonStyle.Secondary)
          )
        )
      );
    }
    return rows;
  }
  return CLASS_GROUPS.map(
    (group, i) =>
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`signup:setclsdd:${messageId}:${i}`)
          .setPlaceholder(`Select your class · ${group[0]}–${group[group.length - 1]}`)
          .addOptions(group.map((c) => ({ label: c, value: c })))
      )
  );
}

export { ROLE_BY_ID, STATUS_BY_ID };
