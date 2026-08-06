import { REST, Routes } from "discord.js";
import { TOKEN, CLIENT_ID, GUILD_ID, assertConfig } from "./config.js";
import * as mvp from "./commands/mvp.js";
import * as stats from "./commands/stats.js";
import * as signup from "./commands/signup.js";
import * as profile from "./commands/profile.js";
import * as addwar from "./commands/addwar.js";
import * as removewar from "./commands/removewar.js";
import * as balance from "./commands/balance.js";
import * as roster from "./commands/roster.js";
import { info, ok, fail } from "./lib/console-ui.js";

assertConfig();

const body = [mvp, stats, signup, profile, addwar, removewar, balance, roster].map((c) => c.data.toJSON());
const rest = new REST().setToken(TOKEN);

try {
  info(`Registering ${body.length} guild commands to ${GUILD_ID}...`);
  const result = await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body }
  );
  ok(`Registered ${result.length} commands: ${result.map((c) => "/" + c.name).join(", ")}`);
} catch (err) {
  fail(`Failed to register commands: ${err.message}`);
  console.error(err);
  process.exit(1);
}
