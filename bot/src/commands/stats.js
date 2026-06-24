import { SlashCommandBuilder } from "discord.js";
import { playerHistory, allPlayerNames, listWars } from "../lib/data.js";
import { statsEmbed, statsSummaryEmbed } from "../lib/embeds.js";

export const data = new SlashCommandBuilder()
  .setName("stats")
  .setDescription("Look up a player's full extended war stats.")
  .addStringOption((o) =>
    o
      .setName("player")
      .setDescription("In-game family name")
      .setRequired(true)
      .setAutocomplete(true)
  )
  .addStringOption((o) =>
    o
      .setName("date")
      .setDescription("Single war date (YYYY-MM-DD). Blank = career summary.")
      .setAutocomplete(true)
  );

export async function autocomplete(interaction) {
  const focusedOpt = interaction.options.getFocused(true);
  const value = focusedOpt.value.toLowerCase();

  if (focusedOpt.name === "player") {
    const choices = allPlayerNames()
      .filter((n) => n.toLowerCase().includes(value))
      .slice(0, 25)
      .map((n) => ({ name: n, value: n }));
    return interaction.respond(choices);
  }

  // date option — scope to the chosen player's wars when possible
  const player = interaction.options.getString("player");
  const hist = player ? playerHistory(player) : null;
  const wars = hist ? hist.wars : listWars();
  const choices = wars
    .filter((w) => w.date.includes(value) || w.location.toLowerCase().includes(value))
    .slice(0, 25)
    .map((w) => ({ name: `${w.date} — ${w.location}`, value: w.date }));
  return interaction.respond(choices);
}

export async function execute(interaction) {
  const playerName = interaction.options.getString("player");
  const date = interaction.options.getString("date");

  const history = playerHistory(playerName);
  if (!history) {
    return interaction.reply({
      content: `No war records found for **${playerName}**. Check the spelling or use autocomplete.`,
      ephemeral: true,
    });
  }

  if (!date) {
    return interaction.reply({ embeds: [statsSummaryEmbed(history)] });
  }

  const war = history.wars.find((w) => w.date === date);
  if (!war) {
    return interaction.reply({
      content: `**${history.name}** didn't play in the ${date} war (or no such war exists).`,
      ephemeral: true,
    });
  }

  await interaction.reply({ embeds: [statsEmbed(history, war)] });
}
