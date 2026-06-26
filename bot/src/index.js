import { Client, GatewayIntentBits, Events, Collection } from "discord.js";
import { TOKEN, assertConfig } from "./config.js";
import * as mvp from "./commands/mvp.js";
import * as stats from "./commands/stats.js";
import * as signup from "./commands/signup.js";
import * as profile from "./commands/profile.js";
import * as addwar from "./commands/addwar.js";
import * as balance from "./commands/balance.js";
import { syncFromWorker, applyOps } from "./lib/worker-sync.js";
import { applyProfileOps } from "./lib/profile-sync.js";
import { workerEnabled } from "./lib/worker.js";

assertConfig();

const commands = new Collection();
for (const cmd of [mvp, stats, signup, profile, addwar, balance]) commands.set(cmd.data.name, cmd);

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, async (c) => {
  console.log(`✅ Logged in as ${c.user.tag}. Serving ${commands.size} commands.`);
  if (workerEnabled()) {
    // Adopt any sheets the website posted via the Worker (e.g. while we were
    // offline) so their buttons work, then keep checking on an interval.
    const n = await syncFromWorker(c);
    if (n) console.log(`🔗 Hydrated ${n} sign-up(s) from the Worker relay.`);
    setInterval(() => syncFromWorker(c), 60_000);
    // Apply website board edits (add/move/remove) to posted sheets promptly.
    setInterval(() => applyOps(c), 5_000);
    // Apply website profile-ops (e.g. remove a published screenshot for everyone).
    setInterval(() => applyProfileOps(), 10_000);
  }
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

    // Balanced War Builder: buttons + the "add guilds" modal submit.
    if (
      (interaction.isButton() || interaction.isModalSubmit()) &&
      interaction.customId.startsWith("balance:")
    ) {
      return await balance.handleComponent(interaction);
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
