import { PermissionFlagsBits } from "discord.js";
import { ADMIN_ROLE_IDS } from "../config.js";
import { signupEmbed, signupComponents } from "./embeds.js";

/** True if the member may run admin sign-up actions. */
export function isAdmin(interaction) {
  if (ADMIN_ROLE_IDS.length) {
    const roles = interaction.member?.roles;
    // roles is a GuildMemberRoleManager (cache) for real members
    if (roles?.cache) return ADMIN_ROLE_IDS.some((id) => roles.cache.has(id));
  }
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;
}

/**
 * Re-render a sign-up's original message in place after its state changes.
 * Looks the message up by the channelId/messageId stored on the sign-up.
 */
export async function refreshSignupMessage(client, signup) {
  try {
    const channel = await client.channels.fetch(signup.channelId);
    const message = await channel.messages.fetch(signup.messageId);
    await message.edit({
      embeds: [signupEmbed(signup)],
      components: signupComponents(signup),
    });
    return true;
  } catch (err) {
    console.error("Failed to refresh sign-up message:", err.message);
    return false;
  }
}
