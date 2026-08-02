import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import { randomUUID } from "node:crypto";
import { SITE_URL, GUILD_PROFILE_URL } from "../config.js";
import { loadData, setRosterMembers } from "../lib/data.js";
import { isAdmin } from "../lib/signup-message.js";
import { fetchOfficialRoster } from "../lib/roster-scrape.js";

// Pending syncs awaiting a Confirm/Cancel, keyed by a one-time token.
const pending = new Map(); // token -> { members, added, removed, userId, createdAt }
const TTL_MS = 10 * 60 * 1000;

function sweep() {
  const now = Date.now();
  for (const [token, p] of pending) if (now - p.createdAt > TTL_MS) pending.delete(token);
}

export const data = new SlashCommandBuilder()
  .setName("roster")
  .setDescription("Sync the guild roster from the official Black Desert guild page (admin only).")
  .addSubcommand((sc) => sc.setName("sync").setDescription("Fetch the live member list and preview changes"));

function previewEmbed({ added, removed, total, guildMaster }) {
  let description = `Pulled **${total}** members from the [official guild page](${GUILD_PROFILE_URL}).`;
  if (!added.length && !removed.length) description += "\n\nNo changes — roster already matches.";

  const e = new EmbedBuilder()
    .setColor(0x5fdcf5)
    .setTitle("🔄 Roster Sync Preview")
    .setDescription(description)
    .setFooter({ text: "This replaces the roster on the site — war history is untouched. Confirm within 10 min." });

  if (guildMaster) e.addFields({ name: "Guild Master", value: guildMaster, inline: false });
  e.addFields(
    { name: `➕ Joining (${added.length})`, value: added.length ? added.slice(0, 25).join(", ") : "—", inline: false },
    { name: `➖ Leaving (${removed.length})`, value: removed.length ? removed.slice(0, 25).join(", ") : "—", inline: false }
  );
  return e;
}

function buttons(token, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`roster:confirm:${token}`)
      .setLabel("Confirm sync")
      .setEmoji("✅")
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`roster:cancel:${token}`)
      .setLabel("Cancel")
      .setEmoji("✖️")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled)
  );
}

export async function execute(interaction) {
  if (!isAdmin(interaction)) {
    return interaction.reply({ content: "🚫 Only admins can sync the roster.", ephemeral: true });
  }
  if (interaction.options.getSubcommand() !== "sync") return;

  await interaction.deferReply({ ephemeral: true });

  let live;
  try {
    live = await fetchOfficialRoster();
  } catch (e) {
    return interaction.editReply(`🚫 Couldn't fetch the guild page: ${e.message}`);
  }

  // Dry-run the diff without writing yet, so Cancel is a true no-op.
  const before = new Set((await loadData()).rosterMembers);
  const afterSet = new Set(live.members);
  const added = live.members.filter((n) => !before.has(n));
  const removed = [...before].filter((n) => !afterSet.has(n)).sort((a, b) => a.localeCompare(b));

  sweep();
  const token = randomUUID();
  pending.set(token, { members: live.members, guildMaster: live.guildMaster, userId: interaction.user.id, createdAt: Date.now() });

  await interaction.editReply({
    content: "Review the sync below, then confirm to publish:",
    embeds: [previewEmbed({ added, removed, total: live.members.length, guildMaster: live.guildMaster })],
    components: [buttons(token)],
  });
}

export async function handleComponent(interaction) {
  const [, action, token] = interaction.customId.split(":");
  const entry = pending.get(token);

  if (!entry) {
    return interaction.update({
      content: "⌛ This review expired or was already handled. Run `/roster sync` again.",
      embeds: [],
      components: [],
    });
  }
  if (interaction.user.id !== entry.userId) {
    return interaction.reply({
      content: "Only the admin who started this `/roster sync` can confirm it.",
      ephemeral: true,
    });
  }

  if (action === "cancel") {
    pending.delete(token);
    return interaction.update({
      content: "❌ Cancelled — nothing was changed.",
      embeds: [],
      components: [],
    });
  }

  // confirm
  pending.delete(token);
  await interaction.update({ content: "⏳ Syncing to the site…", embeds: [], components: [] });

  let diff;
  try {
    diff = await setRosterMembers(entry.members);
  } catch (e) {
    return interaction.editReply(`🚫 Failed to update the roster: ${e.message}`);
  }

  await interaction.editReply(
    `✅ **Synced** — ${entry.members.length} members (+${diff.added.length} / −${diff.removed.length}) — live now.\n${SITE_URL}/players.html`
  );
}
