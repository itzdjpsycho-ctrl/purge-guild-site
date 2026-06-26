import { SlashCommandBuilder } from "discord.js";
import {
  createSignup,
  getSignup,
  latestOpenSignup,
  setEntry,
  removeEntry,
  roleFill,
  closeSignup,
  reopenSignup,
  updateDetails,
} from "../lib/signups.js";
import { signupEmbed, signupComponents, classPickerComponents, ROLE_BY_ID, STATUS_BY_ID } from "../lib/embeds.js";
import { isAdmin, refreshSignupMessage } from "../lib/signup-message.js";
import { SIGNUP_ROLES, SIGNUP_STATUSES, BDO_CLASSES, roleAllowsClass } from "../config.js";
import { getSignupChannelId, setSignupChannelId } from "../lib/bot-config.js";
import { pushConfig, pushState, workerEnabled } from "../lib/worker.js";
import { hydrateSignup } from "../lib/worker-sync.js";

const ROLE_CHOICES = SIGNUP_ROLES.map((r) => ({ name: r.label, value: r.id }));
const STATUS_CHOICES = SIGNUP_STATUSES.map((s) => ({ name: s.label, value: s.id }));

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
        o.setName("time").setDescription("Start time, e.g. 11:00 AM").setRequired(false)
      )
      .addStringOption((o) =>
        o.setName("location").setDescription("Node / location").setRequired(false)
      )
      .addStringOption((o) =>
        o.setName("notes").setDescription("Extra notes (rules, requirements, etc.)").setRequired(false)
      )
  )
  .addSubcommand((s) =>
    s
      .setName("add")
      .setDescription("Place / override a member on the sign-up (bypasses role capacity).")
      .addUserOption((o) => o.setName("member").setDescription("Member").setRequired(true))
      .addStringOption((o) =>
        o.setName("status").setDescription("Availability").addChoices(...STATUS_CHOICES)
      )
      .addStringOption((o) =>
        o.setName("role").setDescription("Role group").addChoices(...ROLE_CHOICES)
      )
      .addStringOption((o) =>
        o.setName("class").setDescription("BDO class").setAutocomplete(true)
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
      .setDescription("Edit the sign-up's date / time / location / notes.")
      .addStringOption((o) => o.setName("date").setDescription("New date"))
      .addStringOption((o) => o.setName("time").setDescription("New time"))
      .addStringOption((o) => o.setName("location").setDescription("New location"))
      .addStringOption((o) => o.setName("notes").setDescription("New notes"))
  )
  .addSubcommand((s) => s.setName("close").setDescription("Close the sign-up (locks buttons)."))
  .addSubcommand((s) => s.setName("reopen").setDescription("Reopen a closed sign-up."))
  .addSubcommandGroup((g) =>
    g
      .setName("channel")
      .setDescription("Where the website's Sign Ups page posts sheets.")
      .addSubcommand((s) =>
        s
          .setName("set")
          .setDescription("Set the channel website-posted sign-up sheets go to.")
          .addChannelOption((o) =>
            o.setName("channel").setDescription("Target channel").setRequired(true)
          )
      )
      .addSubcommand((s) =>
        s.setName("show").setDescription("Show the currently designated sign-up channel.")
      )
  );

export async function autocomplete(interaction) {
  const focused = interaction.options.getFocused().toLowerCase();
  const choices = BDO_CLASSES.filter((c) => c.toLowerCase().includes(focused))
    .slice(0, 25)
    .map((c) => ({ name: c, value: c }));
  await interaction.respond(choices);
}

/** Resolve which sign-up an admin command targets: the latest open one. */
function targetSignup() {
  return latestOpenSignup();
}

/** Best display name we can get for a target user (admin actions). */
function targetName(interaction) {
  const member = interaction.options.getMember("member");
  const user = interaction.options.getUser("member");
  return member?.displayName || user?.globalName || user?.username || "Unknown";
}

export async function execute(interaction) {
  if (!isAdmin(interaction)) {
    return interaction.reply({
      content: "🚫 You need an admin role (or Manage Server) to use sign-up commands.",
      ephemeral: true,
    });
  }

  const group = interaction.options.getSubcommandGroup(false);
  const sub = interaction.options.getSubcommand();

  if (group === "channel") {
    if (sub === "set") {
      const channel = interaction.options.getChannel("channel");
      setSignupChannelId(channel.id);
      let note = `✅ Sign-up sheets from the website will post to <#${channel.id}>.`;
      if (workerEnabled()) {
        const r = await pushConfig(channel.id);
        if (!r.ok) note += `\n⚠️ Couldn't reach the Worker to save it remotely (${r.error || r.status || "no response"}). It's stored locally; try again when the relay is up.`;
      } else {
        note += `\n⚠️ \`WORKER_URL\` isn't set, so website posting is off until the relay is configured.`;
      }
      return interaction.reply({ content: note, ephemeral: true });
    }
    if (sub === "show") {
      const id = getSignupChannelId();
      return interaction.reply({
        content: id ? `Current sign-up channel: <#${id}>.` : "No sign-up channel set yet. Use `/signup channel set`.",
        ephemeral: true,
      });
    }
  }

  if (sub === "create") {
    const date = interaction.options.getString("date");
    const time = interaction.options.getString("time") || "";
    const location = interaction.options.getString("location") || "";
    const notes = interaction.options.getString("notes") || "";

    const placeholder = { date, time, location, notes, status: "open", seq: 0, entries: {} };
    const msg = await interaction.reply({
      embeds: [signupEmbed(placeholder)],
      components: signupComponents(placeholder),
      fetchReply: true,
    });

    createSignup({
      messageId: msg.id,
      channelId: msg.channelId,
      date,
      time,
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
    const status = interaction.options.getString("status") ?? undefined;
    const role = interaction.options.getString("role") ?? undefined;
    const cls = interaction.options.getString("class") ?? undefined;
    // Admin override: capacity is intentionally NOT enforced here.
    updated = setEntry(signup.messageId, member.id, {
      status: status ?? signup.entries[member.id]?.status ?? "in",
      role,
      cls,
      name: targetName(interaction),
    });
    const bits = [
      status && STATUS_BY_ID[status]?.label,
      role && ROLE_BY_ID[role]?.label,
      cls,
    ].filter(Boolean);
    note = `Updated <@${member.id}>${bits.length ? ` → ${bits.join(" · ")}` : ""}.`;
  } else if (sub === "remove") {
    const member = interaction.options.getUser("member");
    updated = removeEntry(signup.messageId, member.id);
    note = `Removed <@${member.id}> from the sign-up.`;
  } else if (sub === "edit") {
    const date = interaction.options.getString("date") ?? undefined;
    const time = interaction.options.getString("time") ?? undefined;
    const location = interaction.options.getString("location") ?? undefined;
    const notes = interaction.options.getString("notes") ?? undefined;
    updated = updateDetails(signup.messageId, { date, time, location, notes });
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

// ---- component handlers (self-service for any member) ----

export async function handleComponent(interaction) {
  // A class chosen from the ephemeral "Pick your class" picker — the click
  // arrives on the ephemeral message, so the sheet id is carried in the customId.
  if (
    interaction.customId.startsWith("signup:setcls:") ||
    interaction.customId.startsWith("signup:setclsdd:")
  ) {
    return handleClassPick(interaction);
  }

  // The sheet may have been posted by the website via the Worker since our last
  // sync — try a one-shot hydrate before giving up on it.
  let signup = getSignup(interaction.message.id) || (await hydrateSignup(interaction.message.id));
  if (!signup) {
    return interaction.reply({ content: "This sign-up is no longer tracked.", ephemeral: true });
  }
  if (signup.status === "closed") {
    return interaction.reply({ content: "Sign-ups are closed.", ephemeral: true });
  }

  const userId = interaction.user.id;
  const name = interaction.member?.displayName || interaction.user.globalName || interaction.user.username;
  const existing = signup.entries[userId];
  let ack = "";
  let pickClassFor = null; // role id → show the class picker after updating

  if (interaction.isButton()) {
    const [, kind, statusId] = interaction.customId.split(":"); // signup:withdraw | signup:st:<id>
    if (kind === "withdraw") {
      removeEntry(signup.messageId, userId);
      ack = "You've withdrawn from the sign-up.";
    } else if (kind === "st") {
      setEntry(signup.messageId, userId, { status: statusId, name });
      ack = `Marked you **${STATUS_BY_ID[statusId]?.label || statusId}**.`;
    }
  } else if (interaction.isStringSelectMenu()) {
    const [, kind] = interaction.customId.split(":"); // signup:role
    if (kind === "role") {
      const role = interaction.values[0];
      const cap = signup.caps?.[role] ?? ROLE_BY_ID[role]?.cap;
      const alreadyHere = existing?.role === role;
      if (!alreadyHere && cap && roleFill(signup, role) >= cap) {
        return interaction.reply({
          content: `🚫 **${ROLE_BY_ID[role]?.label || role}** is full (${cap}/${cap}). Pick another role, or ask leadership to slot you in.`,
          ephemeral: true,
        });
      }
      // Picking a role signs you in if you hadn't set an active status.
      const status = existing && existing.status !== "absence" ? existing.status : "in";
      const opts = { role, status, name };
      // Strict: drop a previously-set class that doesn't fit the new role.
      if (existing?.cls && !roleAllowsClass(role, existing.cls)) opts.cls = null;
      setEntry(signup.messageId, userId, opts);
      ack = `Role set to **${ROLE_BY_ID[role]?.label || role}**.`;
      pickClassFor = role;
    }
  }

  const updated = getSignup(signup.messageId);
  await interaction.update({
    embeds: [signupEmbed(updated)],
    components: signupComponents(updated),
  });
  // Mirror the change to the website's live view (fire-and-forget).
  pushState(updated).catch(() => {});

  if (pickClassFor) {
    await interaction.followUp({
      ephemeral: true,
      content: `Now pick your class for **${ROLE_BY_ID[pickClassFor]?.label || pickClassFor}**:`,
      components: classPickerComponents(pickClassFor, signup.messageId),
    });
  } else {
    await interaction.followUp({ content: `✅ ${ack}`, ephemeral: true });
  }
}

/** Handle a class chosen from the ephemeral picker (button or any-class dropdown). */
async function handleClassPick(interaction) {
  const parts = interaction.customId.split(":");
  // signup:setcls:<messageId>:<class>   (button) | signup:setclsdd:<messageId>:<group> (select)
  const messageId = parts[2];
  const signup = getSignup(messageId) || (await hydrateSignup(messageId));
  if (!signup) {
    return interaction.update({ content: "This sign-up is no longer tracked.", components: [] });
  }
  if (signup.status === "closed") {
    return interaction.update({ content: "Sign-ups are closed.", components: [] });
  }

  const userId = interaction.user.id;
  const name = interaction.member?.displayName || interaction.user.globalName || interaction.user.username;
  const existing = signup.entries[userId];
  const cls = interaction.isButton() ? parts.slice(3).join(":") : interaction.values[0];

  // Strict: the class must belong to the member's current role.
  const role = existing?.role ?? null;
  if (role && !roleAllowsClass(role, cls)) {
    return interaction.update({
      content: `🚫 **${cls}** isn't a valid class for **${ROLE_BY_ID[role]?.label || role}**. Pick a role first, then a class.`,
      components: [],
    });
  }

  setEntry(messageId, userId, { cls, status: existing?.status ?? "in", name });
  const updated = getSignup(messageId);
  await refreshSignupMessage(interaction.client, updated); // edits the sheet + pushes live state
  await interaction.update({ content: `✅ Class set to **${cls}**.`, components: [] });
}
