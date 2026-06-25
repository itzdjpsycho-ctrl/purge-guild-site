import { Client, GatewayIntentBits, Events, Collection } from "discord.js";
import { TOKEN, assertConfig } from "./config.js";
import * as mvp from "./commands/mvp.js";
import * as stats from "./commands/stats.js";
import * as signup from "./commands/signup.js";
import * as profile from "./commands/profile.js";
import * as addwar from "./commands/addwar.js";

assertConfig();

const commands = new Collection();
for (const cmd of [mvp, stats, signup, profile, addwar]) commands.set(cmd.data.name, cmd);

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, (c) => {
  console.log(`✅ Logged in as ${c.user.tag}. Serving ${commands.size} commands.`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // Sign-up buttons & role select are routed by their custom id prefix.
    if (
      (interaction.isButton() || interaction.isStringSelectMenu()) &&
      interaction.customId.startsWith("signup:")
    ) {
      return await signup.handleComponent(interaction);
    }

    if (interaction.isButton() && interaction.customId.startsWith("addwar:")) {
      return await addwar.handleComponent(interaction);
    }

    if (interaction.isAutocomplete()) {
      const cmd = commands.get(interaction.commandName);
      if (cmd?.autocomplete) return await cmd.autocomplete(interaction);
      return;
    }

    if (interaction.isChatInputCommand()) {
      const cmd = commands.get(interaction.commandName);
      if (!cmd) return;
      return await cmd.execute(interaction);
    }
  } catch (err) {
    console.error("Interaction error:", err);
    const payload = { content: "⚠️ Something went wrong handling that.", ephemeral: true };
    if (interaction.isRepliable()) {
      if (interaction.replied || interaction.deferred) {
        interaction.followUp(payload).catch(() => {});
      } else {
        interaction.reply(payload).catch(() => {});
      }
    }
  }
});

client.login(TOKEN);
