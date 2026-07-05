import {
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
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
      .setDescription("Post a new sign-up sheet (pick date/time from dropdowns).")
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

// ---- /signup create: date/time picked from dropdowns, then confirmed ----
// A throwaway in-memory session (keyed by the setup message id) holds the
// picks until "Post Sign-Up" is clicked. If the bot restarts mid-setup, the
// admin just runs /signup create again — nothing durable is at stake yet.
const createSessions = new Map(); // messageId -> { location, notes, date, time }

function dateOptions() {
  const opts = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = 0; i < 14; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    // Build the value from local Y/M/D (not toISOString, which is UTC and can
    // land on a different calendar day than the local label near midnight).
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    opts.push({
      label: d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }),
      value: iso,
    });
  }
  return opts;
}

function timeOptions() {
  // Discord select menus cap at 25 options, so the full 24-hour day only fits
  // at hourly granularity (30-min steps would need 48 slots).
  const opts = [];
  for (let h24 = 0; h24 < 24; h24++) {
    const label = new Date(2000, 0, 1, h24, 0).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
    const value = `${String(h24).padStart(2, "0")}:00`;
    opts.push({ label, value });
  }
  return opts;
}

const DATE_OPTIONS = dateOptions();
const TIME_OPTIONS = timeOptions();

function createSetupComponents(session) {
  const dateSelect = new StringSelectMenuBuilder()
    .setCustomId("signup:csetup:date")
    .setPlaceholder(session.date ? DATE_OPTIONS.find((o) => o.value === session.date)?.label : "Pick a date…")
    .addOptions(DATE_OPTIONS);
  const timeSelect = new StringSelectMenuBuilder()
    .setCustomId("signup:csetup:time")
    .setPlaceholder(session.time ? TIME_OPTIONS.find((o) => o.value === session.time)?.label : "Pick a time…")
    .addOptions(TIME_OPTIONS);
  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("signup:csetup:post")
      .setLabel("Post Sign-Up")
      .setEmoji("✅")
      .setStyle(ButtonStyle.Success)
      .setDisabled(!session.date),
    new ButtonBuilder()
      .setCustomId("signup:csetup:cancel")
      .setLabel("Cancel")
      .setEmoji("✖️")
      .setStyle(ButtonStyle.Secondary)
  );
  return [
    new ActionRowBuilder().addComponents(dateSelect),
    new ActionRowBuilder().addComponents(timeSelect),
    buttons,
  ];
}

function createSetupContent(session) {
  const dateLabel = session.date ? DATE_OPTIONS.find((o) => o.value === session.date)?.label : "*(not picked)*";
  const timeLabel = session.time ? TIME_OPTIONS.find((o) => o.value === session.time)?.label : "*(not picked)*";
  return (
    `**Setting up a Node War sign-up**\n` +
    `📍 ${session.location || "TBD"}   📅 ${dateLabel}   🕐 ${timeLabel}\n` +
    `Pick a date and time below, then **Post Sign-Up**.`
  );
}

async function handleCreateSetup(interaction, action) {
  if (!isAdmin(interaction)) {
    return interaction.reply({
      content: "🚫 You need an admin role (or Manage Server) to use sign-up commands.",
      ephemeral: true,
    });
  }

  const session = createSessions.get(interaction.message.id);
  if (!session) {
    return interaction.update({
      content: "⌛ This setup expired (the bot may have restarted). Run `/signup create` again.",
      components: [],
    });
  }

  if (action === "date") {
    session.date = interaction.values[0];
    return interaction.update({ content: createSetupContent(session), components: createSetupComponents(session) });
  }
  if (action === "time") {
    session.time = interaction.values[0];
    return interaction.update({ content: createSetupContent(session), components: createSetupComponents(session) });
  }
  if (action === "cancel") {
    createSessions.delete(interaction.message.id);
    return interaction.update({ content: "❌ Cancelled — no sign-up was posted.", components: [] });
  }

  // post
  if (!session.date) {
    return interaction.reply({ content: "🚫 Pick a date first.", ephemeral: true });
  }
  createSessions.delete(interaction.message.id);

  const { location, notes, date, time } = session;
  const placeholder = { date, time, location, notes, status: "open", seq: 0, entries: {} };
  await interaction.update({ content: "", embeds: [signupEmbed(placeholder)], components: signupComponents(placeholder) });

  createSignup({
    messageId: interaction.message.id,
    channelId: interaction.message.channelId,
    date,
    time,
    location,
    notes,
    createdBy: interaction.user.id,
  });
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
    const session = {
      location: interaction.options.getString("location") || "",
      notes: interaction.options.getString("notes") || "",
      date: null,
      time: null,
    };
    const msg = await interaction.reply({
      content: createSetupContent(session),
      components: createSetupComponents(session),
      fetchReply: true,
    });
    createSessions.set(msg.id, session);
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
  // The /signup create dropdown/button setup flow.
  if (interaction.customId.startsWith("signup:csetup:")) {
    return handleCreateSetup(interaction, interaction.customId.split(":")[2]);
  }

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
      const isFull = !alreadyHere && cap && roleFill(signup, role) >= cap;

      // Picking a role signs you in if you hadn't set an active status.
      const status = existing && existing.status !== "absence" ? existing.status : "in";
      const opts = { role, status, name };
      // Strict: drop a previously-set class that doesn't fit the new role.
      if (existing?.cls && !roleAllowsClass(role, existing.cls)) opts.cls = null;
      setEntry(signup.messageId, userId, opts);
      ack = isFull
        ? `**${ROLE_BY_ID[role]?.label || role}** is full — you've been added on the waitlist (shown struck-through) and will move up automatically if a spot opens.`
        : `Role set to **${ROLE_BY_ID[role]?.label || role}**.`;
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
