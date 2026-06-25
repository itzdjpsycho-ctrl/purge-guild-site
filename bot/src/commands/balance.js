import {
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} from "discord.js";
import {
  parseGuilds,
  balanceTeams,
  balanceEmbed,
  balanceComponents,
  MAX_GUILDS,
} from "../lib/balance.js";

// In-memory builder sessions keyed by the panel message id. The bot runs on a
// single host and a balancing session is throwaway, so there's no need to
// persist it to disk — if the bot restarts, just run /balance again.
const sessions = new Map();

export const data = new SlashCommandBuilder()
  .setName("balance")
  .setDescription("Build two skill-balanced teams from guilds + seeds (1 = strongest … 10 = weakest).");

export async function execute(interaction) {
  const session = { guilds: [], result: null };
  const msg = await interaction.reply({
    embeds: [balanceEmbed(session)],
    components: balanceComponents(session),
    fetchReply: true,
  });
  sessions.set(msg.id, session);
}

const EXPIRED = {
  content: "This builder has expired (the bot may have restarted). Run `/balance` again.",
  ephemeral: true,
};

export async function handleComponent(interaction) {
  // Modal submit — the typed-in guilds. The modal was shown from the panel
  // message, so interaction.message is that panel.
  if (interaction.isModalSubmit()) {
    const session = sessions.get(interaction.message?.id);
    if (!session) return interaction.reply(EXPIRED);

    const { guilds, errors } = parseGuilds(interaction.fields.getTextInputValue("guilds"));
    for (const g of guilds) {
      const i = session.guilds.findIndex((x) => x.name.toLowerCase() === g.name.toLowerCase());
      if (i >= 0) session.guilds[i] = g; // update an existing guild's seed
      else if (session.guilds.length < MAX_GUILDS) session.guilds.push(g);
    }
    session.result = null; // roster changed → any previous split is stale

    await interaction.update({
      embeds: [balanceEmbed(session)],
      components: balanceComponents(session),
    });
    if (errors.length) {
      await interaction.followUp({
        content:
          `⚠️ Skipped ${errors.length} line(s) I couldn't read ` +
          "(each needs `Name seed`, seed 1–10):\n" +
          errors.map((e) => `• \`${e}\``).join("\n").slice(0, 1500),
        ephemeral: true,
      });
    }
    return;
  }

  // Buttons.
  const session = sessions.get(interaction.message.id);
  if (!session) return interaction.reply(EXPIRED);

  const action = interaction.customId.split(":")[1];

  if (action === "add") {
    const modal = new ModalBuilder()
      .setCustomId("balance:addmodal")
      .setTitle("Add guilds");
    const input = new TextInputBuilder()
      .setCustomId("guilds")
      .setLabel("One per line: Name then seed (1–10)")
      .setPlaceholder("Purge 1\nObscure 4\nMisfits 7")
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(2000);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return interaction.showModal(modal);
  }

  if (action === "clear") {
    session.guilds = [];
    session.result = null;
    return interaction.update({
      embeds: [balanceEmbed(session)],
      components: balanceComponents(session),
    });
  }

  if (action === "roll") {
    session.result = balanceTeams(session.guilds);
    return interaction.update({
      embeds: [balanceEmbed(session)],
      components: balanceComponents(session),
    });
  }
}
