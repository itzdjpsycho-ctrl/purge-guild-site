import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import { randomUUID } from "node:crypto";
import { SITE_URL } from "../config.js";
import { readWar } from "../lib/war.js";
import { addWar, getWar, fmtDate } from "../lib/data.js";
import { isAdmin } from "../lib/signup-message.js";
import { publish } from "../lib/git.js";
import { PURPLE } from "../lib/embeds.js";

const ALLOWED = ["image/png", "image/jpeg", "image/webp"];
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB per screenshot

// Pending extractions awaiting a Confirm/Cancel, keyed by a one-time token.
const pending = new Map(); // token -> { war, userId, createdAt }
const TTL_MS = 10 * 60 * 1000;

function sweep() {
  const now = Date.now();
  for (const [token, p] of pending) if (now - p.createdAt > TTL_MS) pending.delete(token);
}

const SHOTS = ["shot1", "shot2", "shot3", "shot4", "shot5"];

export const data = (() => {
  const b = new SlashCommandBuilder()
    .setName("addwar")
    .setDescription("Add a Node War from result screenshots (admin only).");
  SHOTS.forEach((name, i) =>
    b.addAttachmentOption((o) =>
      o
        .setName(name)
        .setDescription(
          i === 0
            ? "War result screenshot (required)"
            : `Additional screenshot ${i + 1} (optional)`
        )
        .setRequired(i === 0)
    )
  );
  return b;
})();

async function fetchImage(att) {
  const mt = att.contentType?.split(";")[0];
  if (!ALLOWED.includes(mt)) return { ok: false, error: `${att.name} isn't a PNG/JPG/WebP.` };
  if (att.size > MAX_BYTES) return { ok: false, error: `${att.name} is over 8 MB.` };
  try {
    const res = await fetch(att.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    return { ok: true, image: { base64: buf.toString("base64"), mediaType: mt } };
  } catch (e) {
    return { ok: false, error: `Couldn't download ${att.name} (${e.message}).` };
  }
}

function previewEmbed(war, replaced) {
  const top = [...war.players]
    .sort((a, b) => (b.kills || 0) - (a.kills || 0))
    .slice(0, 5)
    .map((p) => `**${p.name}** — ${p.kills || 0}K / ${p.deaths || 0}D`)
    .join("\n");

  const embed = new EmbedBuilder()
    .setColor(war.result === "Victory" ? 0xc49a30 : 0xd65a45)
    .setTitle(`🗒️ Review War — ${war.location || "Unknown node"}`)
    .setDescription(`${fmtDate(war.date)} · **${war.result}**`)
    .addFields(
      { name: "Day", value: war.day || "—", inline: true },
      { name: "Players", value: String(war.players.length), inline: true },
      { name: "Top fraggers", value: top || "—", inline: false }
    )
    .setFooter({ text: "Confirm within 10 min to publish to the site. Double-check the numbers first." });

  if (replaced) {
    embed.addFields({
      name: "⚠️ Replaces existing war",
      value: `A war already exists for ${war.date} — confirming will **overwrite** it.`,
    });
  }
  return embed;
}

function buttons(token, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`addwar:confirm:${token}`)
      .setLabel("Confirm & publish")
      .setEmoji("✅")
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`addwar:cancel:${token}`)
      .setLabel("Cancel")
      .setEmoji("✖️")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled)
  );
}

export async function execute(interaction) {
  if (!isAdmin(interaction)) {
    return interaction.reply({ content: "🚫 Only admins can add wars.", ephemeral: true });
  }

  const attachments = SHOTS.map((n) => interaction.options.getAttachment(n)).filter(Boolean);

  await interaction.deferReply({ ephemeral: true });

  const images = [];
  for (const att of attachments) {
    const r = await fetchImage(att);
    if (!r.ok) return interaction.editReply(`🚫 ${r.error}`);
    images.push(r.image);
  }

  await interaction.editReply(
    `⏳ Reading ${images.length} screenshot${images.length > 1 ? "s" : ""} with Claude…`
  );

  const result = await readWar(images);
  if (!result.ok) {
    if (result.error === "no-key") {
      return interaction.editReply(
        "🚫 War OCR is off — no `ANTHROPIC_API_KEY` is set on the bot host. Add it to `bot/.env` and restart."
      );
    }
    return interaction.editReply(`🚫 Couldn't read the war: ${result.error}`);
  }

  sweep();
  const war = result.war;
  const token = randomUUID();
  pending.set(token, { war, userId: interaction.user.id, createdAt: Date.now() });

  const replaced = !!getWar(war.date);

  await interaction.editReply({
    content: "Review the extracted war below, then confirm to publish:",
    embeds: [previewEmbed(war, replaced)],
    components: [buttons(token)],
  });
}

export async function handleComponent(interaction) {
  const [, action, token] = interaction.customId.split(":");
  const entry = pending.get(token);

  if (!entry) {
    return interaction.update({
      content: "⌛ This review expired or was already handled. Run `/addwar` again.",
      embeds: [],
      components: [],
    });
  }
  if (interaction.user.id !== entry.userId) {
    return interaction.reply({
      content: "Only the admin who started this `/addwar` can confirm it.",
      ephemeral: true,
    });
  }

  if (action === "cancel") {
    pending.delete(token);
    return interaction.update({
      content: "❌ Cancelled — nothing was published.",
      embeds: [],
      components: [],
    });
  }

  // confirm
  pending.delete(token);
  await interaction.update({
    content: "⏳ Saving and publishing to the site…",
    embeds: [previewEmbed(entry.war, false)],
    components: [buttons(token, true)],
  });

  let saved;
  try {
    saved = addWar(entry.war);
  } catch (e) {
    return interaction.editReply(`🚫 Failed to write the war: ${e.message}`);
  }

  const pub = await publish(
    ["data.js"],
    `war: ${entry.war.location} ${entry.war.date} (${entry.war.result})`
  );

  let tail;
  if (pub.pushed) tail = "🚀 Pushed — live on the site in ~1–2 minutes.";
  else if (pub.error) tail = `⚠️ Saved locally, but auto-publish failed: ${pub.error}`;
  else tail = "ℹ️ Saved (no change to publish).";

  const verb = saved.replaced ? "Replaced" : "Added";
  await interaction.editReply({
    content:
      `✅ **${verb}** the ${fmtDate(entry.war.date)} war at **${entry.war.location}** ` +
      `(${entry.war.result}, ${saved.players} players).\n${tail}\n${SITE_URL}/`,
    embeds: [],
    components: [],
  });
}
