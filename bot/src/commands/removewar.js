import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import { randomUUID } from "node:crypto";
import { SITE_URL } from "../config.js";
import { getWar, listWars, removeWar, fmtDate } from "../lib/data.js";
import { isAdmin } from "../lib/signup-message.js";
import { computeAttendance, writeAttendance } from "../lib/attendance.js";

// Pending deletions awaiting a Confirm/Cancel, keyed by a one-time token.
const pending = new Map(); // token -> { date, userId, createdAt }
const TTL_MS = 10 * 60 * 1000;

function sweep() {
  const now = Date.now();
  for (const [token, p] of pending) if (now - p.createdAt > TTL_MS) pending.delete(token);
}

export const data = new SlashCommandBuilder()
  .setName("removewar")
  .setDescription("Permanently remove a Node War from the site (admin only).")
  .addStringOption((o) =>
    o
      .setName("date")
      .setDescription("Which war to remove")
      .setRequired(true)
      .setAutocomplete(true)
  );

export async function autocomplete(interaction) {
  const value = interaction.options.getFocused().toLowerCase();
  const wars = (await listWars()).filter(
    (m) => m.date.includes(value) || m.location.toLowerCase().includes(value)
  );
  return interaction.respond(
    wars.slice(0, 25).map((m) => ({
      name: `${m.date} — ${m.location} (${m.result})`,
      value: m.date,
    }))
  );
}

function previewEmbed(war) {
  return new EmbedBuilder()
    .setColor(0xd65a45)
    .setTitle(`🗑️ Remove War — ${war.location || "Unknown node"}`)
    .setDescription(`${fmtDate(war.date)} · **${war.result}** · ${war.players.length} players`)
    .setFooter({ text: "This permanently deletes the war and re-syncs attendance. Confirm within 10 min." });
}

function buttons(token, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`removewar:confirm:${token}`)
      .setLabel("Confirm delete")
      .setEmoji("🗑️")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`removewar:cancel:${token}`)
      .setLabel("Cancel")
      .setEmoji("✖️")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled)
  );
}

export async function execute(interaction) {
  if (!isAdmin(interaction)) {
    return interaction.reply({ content: "🚫 Only admins can remove wars.", ephemeral: true });
  }

  const date = interaction.options.getString("date");
  const war = await getWar(date);
  if (!war) {
    return interaction.reply({
      content: `🚫 No war found for \`${date}\`.`,
      ephemeral: true,
    });
  }

  sweep();
  const token = randomUUID();
  pending.set(token, { date, userId: interaction.user.id, createdAt: Date.now() });

  await interaction.reply({
    content: "Review the war below, then confirm to permanently remove it:",
    embeds: [previewEmbed(war)],
    components: [buttons(token)],
    ephemeral: true,
  });
}

export async function handleComponent(interaction) {
  const [, action, token] = interaction.customId.split(":");
  const entry = pending.get(token);

  if (!entry) {
    return interaction.update({
      content: "⌛ This review expired or was already handled. Run `/removewar` again.",
      embeds: [],
      components: [],
    });
  }
  if (interaction.user.id !== entry.userId) {
    return interaction.reply({
      content: "Only the admin who started this `/removewar` can confirm it.",
      ephemeral: true,
    });
  }

  if (action === "cancel") {
    pending.delete(token);
    return interaction.update({
      content: "❌ Cancelled — nothing was removed.",
      embeds: [],
      components: [],
    });
  }

  // confirm
  pending.delete(token);
  await interaction.update({
    content: "⏳ Removing from the site…",
    embeds: [],
    components: [],
  });

  let removed;
  try {
    removed = await removeWar(entry.date);
    if (!removed.removed) {
      return interaction.editReply(`🚫 War for \`${entry.date}\` no longer exists.`);
    }
    await writeAttendance(await computeAttendance());
  } catch (e) {
    return interaction.editReply(`🚫 Failed to remove the war: ${e.message}`);
  }

  await interaction.editReply(
    `✅ **Removed** the ${fmtDate(entry.date)} war at **${removed.location}** — live now.\n${SITE_URL}/`
  );
}
