import { SlashCommandBuilder } from "discord.js";
import { listWars, getWar, latestWar } from "../lib/data.js";
import { computeMVP } from "../lib/mvp.js";
import { mvpEmbed } from "../lib/embeds.js";

export const data = new SlashCommandBuilder()
  .setName("mvp")
  .setDescription("Post the MVP of a Node War (defaults to the most recent war).")
  .addStringOption((o) =>
    o
      .setName("date")
      .setDescription("War date (YYYY-MM-DD). Leave blank for the latest war.")
      .setAutocomplete(true)
  );

export async function autocomplete(interaction) {
  const focused = interaction.options.getFocused().toLowerCase();
  const choices = listWars()
    .filter((w) => w.date.includes(focused) || w.location.toLowerCase().includes(focused))
    .slice(0, 25)
    .map((w) => ({ name: `${w.date} — ${w.location} (${w.result})`, value: w.date }));
  await interaction.respond(choices);
}

export async function execute(interaction) {
  const date = interaction.options.getString("date");
  const war = date ? getWar(date) : latestWar();

  if (!war) {
    return interaction.reply({
      content: date
        ? `No war found on **${date}**. Use the autocomplete to pick a valid date.`
        : "No wars are recorded yet.",
      ephemeral: true,
    });
  }

  const result = computeMVP(war);
  if (!result) {
    return interaction.reply({
      content: `The ${war.date} war (${war.location}) has no extended stats recorded, so an MVP can't be scored.`,
      ephemeral: true,
    });
  }

  await interaction.reply({ embeds: [mvpEmbed(war, result)] });
}
