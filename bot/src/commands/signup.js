import { SlashCommandBuilder } from "discord.js";
import {
  createSignup,
  getSignup,
  latestOpenSignup,
  setEntry,
  removeEntry,
  closeSignup,
  reopenSignup,
  updateDetails,
} from "../lib/signups.js";
import { signupEmbed, signupComponents } from "../lib/embeds.js";
import { isAdmin, refreshSignupMessage } from "../lib/signup-message.js";

export const data = new SlashCommandBuilder()
  .setName("signup")
  .setDescription("Node War sign-up sheet (admin tools).")
  .addSubcommand((s) =>
    s
      .setName("create")
      .setDescription("Post a new sign-up sheet.")
      .addStringOption((o) =>
        o.setName("date").setDescription("War date, e.g. 2026-06-26").setRequired(true)
      )
      .addStringOption((o) =>
        o.setName("location").setDescription("Node / location").setRequired(false)
      )
      .addStringOption((o) =>
        o.setName("notes").setDescription("Extra notes (time, requirements, etc.)").setRequired(false)
      )
  )
  .addSubcommand((s) =>
    s
      .setName("add")
      .setDescription("Add or set a member's attendance on the sign-up.")
      .addUserOption((o) => o.setName("member").setDescription("Member").setRequired(true))
      .addStringOption((o) =>
        o
          .setName("status")
          .setDescription("Attendance")
          .addChoices(
            { name: "Attending", value: "in" },
            { name: "Maybe", value: "maybe" },
            { name: "Can't make it", value: "out" }
          )
      )
      .addStringOption((o) =>
        o
          .setName("role")
          .setDescription("Squad role")
          .addChoices(
            { name: "Mainball", value: "mainball" },
            { name: "Shotcaller", value: "shotcaller" },
            { name: "Defensive", value: "defensive" },
            { name: "Flex Squad", value: "flex" }
          )
      )
  )
  .addSubcommand((s) =>
    s
      .setName("remove")
      .setDescription("Remove a member from the sign-up.")
      .addUserOption((o) => o.setName("member").setDescription("Member").setRequired(true))
  )
  .addSubcommand((s) =>
    s
      .setName("edit")
      .setDescription("Edit the sign-up's date / location / notes.")
      .addStringOption((o) => o.setName("date").setDescription("New date"))
      .addStringOption((o) => o.setName("location").setDescription("New location"))
      .addStringOption((o) => o.setName("notes").setDescription("New notes"))
  )
  .addSubcommand((s) => s.setName("close").setDescription("Close the sign-up (locks buttons)."))
  .addSubcommand((s) => s.setName("reopen").setDescription("Reopen a closed sign-up."));

/** Resolve which sign-up an admin command targets: the latest open one. */
function targetSignup() {
  return latestOpenSignup();
}

export async function execute(interaction) {
  if (!isAdmin(interaction)) {
    return interaction.reply({
      content: "🚫 You need an admin role (or Manage Server) to use sign-up commands.",
      ephemeral: true,
    });
  }

  const sub = interaction.options.getSubcommand();

  if (sub === "create") {
    const date = interaction.options.getString("date");
    const location = interaction.options.getString("location") || "";
    const notes = interaction.options.getString("notes") || "";

    // Post a placeholder, then persist keyed by the resulting message id.
    const placeholder = { date, location, notes, status: "open", entries: {} };
    const msg = await interaction.reply({
      embeds: [signupEmbed(placeholder)],
      components: signupComponents(placeholder),
      fetchReply: true,
    });

    createSignup({
      messageId: msg.id,
      channelId: msg.channelId,
      date,
      location,
      notes,
      createdBy: interaction.user.id,
    });
    return;
  }

  // All remaining subcommands act on the latest open sign-up.
  const signup = targetSignup();
  if (!signup) {
    return interaction.reply({
      content: "No open sign-up found. Create one with `/signup create` first.",
      ephemeral: true,
    });
  }

  let updated = signup;
  let note = "";

  if (sub === "add") {
    const member = interaction.options.getUser("member");
    const status = interaction.options.getString("status") || "in";
    const role = interaction.options.getString("role") ?? undefined;
    updated = setEntry(signup.messageId, member.id, { status, role });
    note = `Set <@${member.id}> to **${status}**${role ? ` (${role})` : ""}.`;
  } else if (sub === "remove") {
    const member = interaction.options.getUser("member");
    updated = removeEntry(signup.messageId, member.id);
    note = `Removed <@${member.id}> from the sign-up.`;
  } else if (sub === "edit") {
    const date = interaction.options.getString("date") ?? undefined;
    const location = interaction.options.getString("location") ?? undefined;
    const notes = interaction.options.getString("notes") ?? undefined;
    updated = updateDetails(signup.messageId, { date, location, notes });
    note = "Updated sign-up details.";
  } else if (sub === "close") {
    updated = closeSignup(signup.messageId);
    note = "Sign-up closed.";
  } else if (sub === "reopen") {
    updated = reopenSignup(signup.messageId);
    note = "Sign-up reopened.";
  }

  await refreshSignupMessage(interaction.client, updated);
  await interaction.reply({ content: `✅ ${note}`, ephemeral: true });
}

// ---- button + select handlers (self-service for any member) ----

export async function handleComponent(interaction) {
  const signup = getSignup(interaction.message.id);
  if (!signup) {
    return interaction.reply({
      content: "This sign-up is no longer tracked.",
      ephemeral: true,
    });
  }
  if (signup.status === "closed") {
    return interaction.reply({ content: "Sign-ups are closed.", ephemeral: true });
  }

  const userId = interaction.user.id;
  let updated = signup;
  let ack = "";

  if (interaction.isButton()) {
    const action = interaction.customId.split(":")[1]; // in | maybe | out | clear
    if (action === "clear") {
      updated = removeEntry(signup.messageId, userId);
      ack = "You've withdrawn from the sign-up.";
    } else {
      updated = setEntry(signup.messageId, userId, { status: action });
      const label = { in: "Attending", maybe: "Maybe", out: "Can't make it" }[action];
      ack = `Marked you as **${label}**.`;
    }
  } else if (interaction.isStringSelectMenu()) {
    const role = interaction.values[0];
    // Picking a role also signs you in if you weren't already.
    updated = setEntry(signup.messageId, userId, {
      status: signup.entries[userId]?.status ?? "in",
      role,
    });
    ack = `Role set to **${role}**.`;
  }

  // Update the shared sheet, then privately acknowledge the clicker.
  await interaction.update({
    embeds: [signupEmbed(updated)],
    components: signupComponents(updated),
  });
  await interaction.followUp({ content: `✅ ${ack}`, ephemeral: true });
}
