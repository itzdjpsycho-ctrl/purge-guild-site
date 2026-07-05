// Raw Discord message JSON for a sign-up sheet — a faithful mirror of
// bot/src/lib/embeds.js signupEmbed() / signupComponents(). The COMPONENT
// custom_ids must match the bot exactly (it routes interactions on
// customId.startsWith("signup:")); the embed content only needs to be close
// because the bot re-renders the message after the first interaction.

import { SIGNUP_ROLES, SIGNUP_STATUSES, SITE_URL } from "./constants.js";

const PURPLE = 0x8b2fd9;
const CLOSED_COLOR = 0x555160;

function fmtDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  if (Number.isNaN(d.getTime())) return dateStr || "TBD";
  return d.toLocaleDateString("en-US", {
    weekday: "short", day: "numeric", month: "short", year: "numeric",
  });
}

function weekday(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-US", { weekday: "long" }).toUpperCase();
}

const clip = (s) => (s.length > 1024 ? s.slice(0, 1021) + "…" : s);

function memberLine(e) {
  const tag = "`" + String(e.num).padStart(2, " ") + "` ";
  if (e.status === "bench") return `${tag}~~${e.name}~~`;
  if (e.status === "late") return `${tag}${e.name} ⏰`;
  return `${tag}${e.name}`;
}

function roleFill(entries, roleId) {
  return entries.filter(
    (e) => e.role === roleId && (e.status === "in" || e.status === "late")
  ).length;
}

function arrange(entries) {
  const byRole = Object.fromEntries(SIGNUP_ROLES.map((r) => [r.id, []]));
  const unassigned = [], benchNoRole = [], tentative = [], absence = [];
  const sorted = [...entries].sort((a, b) => a.num - b.num);
  for (const e of sorted) {
    if (e.status === "tentative") tentative.push(e);
    else if (e.status === "absence") absence.push(e);
    else if (e.role && byRole[e.role]) byRole[e.role].push(e);
    else if (e.status === "bench") benchNoRole.push(e);
    else unassigned.push(e);
  }
  return { byRole, unassigned, benchNoRole, tentative, absence };
}

export function buildSignupEmbed(state) {
  const entries = state.entries || [];
  const closed = state.status === "closed";
  const g = arrange(entries);
  const caps = state.caps || {};
  const capOf = (r) => (caps[r.id] != null ? caps[r.id] : r.cap);
  const attending =
    SIGNUP_ROLES.reduce((n, r) => n + roleFill(entries, r.id), 0) + g.unassigned.length;
  const wd = weekday(state.date);

  const fields = [
    { name: "📍 Node", value: state.location || "TBD", inline: true },
    { name: "📅 Date", value: state.date ? fmtDate(state.date) : "TBD", inline: true },
    { name: "🕐 Time", value: state.time || "TBD", inline: true },
  ];

  for (const r of SIGNUP_ROLES) {
    const list = g.byRole[r.id];
    fields.push({
      name: `${r.emoji} ${r.label} (${roleFill(entries, r.id)}/${capOf(r)})`,
      value: list.length ? clip(list.map(memberLine).join("\n")) : "—",
      inline: true,
    });
  }
  if (g.unassigned.length)
    fields.push({ name: `🎯 Needs a role (${g.unassigned.length})`, value: clip(g.unassigned.map(memberLine).join("\n")) });
  if (g.benchNoRole.length)
    fields.push({ name: `🪑 Bench (${g.benchNoRole.length})`, value: clip(g.benchNoRole.map(memberLine).join("\n")) });
  if (g.tentative.length)
    fields.push({ name: `⚖️ Tentative (${g.tentative.length})`, value: clip(g.tentative.map((e) => "`" + e.num + "` " + e.name).join(", ")) });
  if (g.absence.length)
    fields.push({ name: `🚫 Absence (${g.absence.length})`, value: clip(g.absence.map((e) => "`" + e.num + "` ~~" + e.name + "~~").join(", ")) });

  const embed = {
    color: closed ? CLOSED_COLOR : PURPLE,
    title: `⚔️ NODE WAR${wd ? ` · ${wd}` : ""}${closed ? " (CLOSED)" : ""}`,
    fields,
    footer: {
      text: closed
        ? "Sign-ups are closed."
        : `${attending} in · Pick a role + class below, then set your availability.`,
    },
    image: { url: `${SITE_URL}/assets/branding/purge-banner.png` },
  };
  if (state.notes) embed.description = state.notes;
  return embed;
}

export function buildSignupComponents(state) {
  const disabled = state.status === "closed";

  const roleRow = {
    type: 1,
    components: [
      {
        type: 3,
        custom_id: "signup:role",
        placeholder: "Pick your role",
        disabled,
        options: SIGNUP_ROLES.map((r) => ({ label: r.label, value: r.id, emoji: { name: r.emoji } })),
      },
    ],
  };

  const statusRow = {
    type: 1,
    components: SIGNUP_STATUSES.map((s) => ({
      type: 2,
      custom_id: `signup:st:${s.id}`,
      label: s.label,
      emoji: { name: s.emoji },
      style: s.style,
      disabled,
    })),
  };

  const withdrawRow = {
    type: 1,
    components: [
      { type: 2, custom_id: "signup:withdraw", label: "Withdraw", emoji: { name: "🗑️" }, style: 2, disabled },
    ],
  };

  // Class is picked via the bot's ephemeral role-class picker, not on the sheet.
  return [roleRow, statusRow, withdrawRow];
}

export function buildMessagePayload(state) {
  return { embeds: [buildSignupEmbed(state)], components: buildSignupComponents(state) };
}

const API = "https://discord.com/api/v10";

async function discordFetch(token, path, method, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  return { ok: res.ok, status: res.status, data };
}

export function postMessage(token, channelId, state) {
  return discordFetch(token, `/channels/${channelId}/messages`, "POST", buildMessagePayload(state));
}

export function patchMessage(token, channelId, messageId, state) {
  return discordFetch(token, `/channels/${channelId}/messages/${messageId}`, "PATCH", buildMessagePayload(state));
}
