import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { BDO_CLASSES, SITE_URL } from "../config.js";
import { knownNames, canonicalName, getProfile, setClass, setImage, setGear, SLOT_KEYS } from "../lib/profiles.js";
import { nameForUser, link, unlink, allLinks } from "../lib/links.js";
import { pushLinks } from "../lib/worker.js";
import { saveAttachment } from "../lib/images.js";
import { readGearStats, gearScore } from "../lib/gear.js";
import { publish } from "../lib/git.js";
import { PURPLE } from "../lib/embeds.js";

const SLOT_CHOICES = [
  { name: "Gear", value: "gear" },
  { name: "Crystals", value: "crystals" },
  { name: "Skill-Addons", value: "addons" },
];

export const data = new SlashCommandBuilder()
  .setName("profile")
  .setDescription("Register your family name and manage your gear screenshots.")
  .addSubcommand((s) =>
    s
      .setName("register")
      .setDescription("Link your Discord account to your in-game family name.")
      .addStringOption((o) =>
        o.setName("family").setDescription("Your family name (from the roster)").setRequired(true).setAutocomplete(true)
      )
  )
  .addSubcommand((s) =>
    s
      .setName("upload")
      .setDescription("Upload a Gear / Crystals / Skill-Addons screenshot.")
      .addStringOption((o) =>
        o.setName("slot").setDescription("Which screenshot").setRequired(true).addChoices(...SLOT_CHOICES)
      )
      .addAttachmentOption((o) =>
        o.setName("image").setDescription("PNG/JPG/WebP image").setRequired(true)
      )
  )
  .addSubcommand((s) =>
    s
      .setName("class")
      .setDescription("Set your BDO class.")
      .addStringOption((o) =>
        o.setName("class").setDescription("Your class").setRequired(true).setAutocomplete(true)
      )
  )
  .addSubcommand((s) =>
    s
      .setName("view")
      .setDescription("View a player's profile.")
      .addUserOption((o) => o.setName("member").setDescription("Defaults to you"))
  )
  .addSubcommand((s) => s.setName("unlink").setDescription("Unlink your family name."));

export async function autocomplete(interaction) {
  const focused = interaction.options.getFocused(true);
  const value = focused.value.toLowerCase();

  if (focused.name === "family") {
    const names = [...knownNames().values()].sort((a, b) => a.localeCompare(b));
    return interaction.respond(
      names.filter((n) => n.toLowerCase().includes(value)).slice(0, 25).map((n) => ({ name: n, value: n }))
    );
  }
  if (focused.name === "class") {
    return interaction.respond(
      BDO_CLASSES.filter((c) => c.toLowerCase().includes(value)).slice(0, 25).map((c) => ({ name: c, value: c }))
    );
  }
}

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub === "register") return register(interaction);
  if (sub === "upload") return upload(interaction);
  if (sub === "class") return setClassCmd(interaction);
  if (sub === "view") return view(interaction);
  if (sub === "unlink") return unlinkCmd(interaction);
}

function requireLinked(interaction) {
  const name = nameForUser(interaction.user.id);
  return name;
}

async function register(interaction) {
  const input = interaction.options.getString("family");
  const name = canonicalName(input);
  if (!name) {
    return interaction.reply({
      content: `**${input}** isn't on the roster. Start typing and pick a name from the suggestions, or ask an admin to add you.`,
      ephemeral: true,
    });
  }

  const res = link(interaction.user.id, name);
  if (!res.ok) {
    return interaction.reply({ content: `🚫 ${res.error}`, ephemeral: true });
  }
  pushLinks(allLinks()).catch(() => {});
  return interaction.reply({
    content: `✅ You're linked to **${name}**. Now use \`/profile upload\` to add your Gear, Crystals, and Skill-Addons screenshots.`,
    ephemeral: true,
  });
}

async function setClassCmd(interaction) {
  const name = requireLinked(interaction);
  if (!name) return notLinked(interaction);
  const className = interaction.options.getString("class");
  setClass(name, className);

  await interaction.reply({ content: `⏳ Saving class **${className}** for **${name}** and publishing…`, ephemeral: true });
  const pub = await publish(["profiles.js"], `profile: ${name} class -> ${className}`);
  await interaction.editReply(publishLine(`Class set to **${className}** for **${name}**.`, pub));
}

async function upload(interaction) {
  const name = requireLinked(interaction);
  if (!name) return notLinked(interaction);

  const slot = interaction.options.getString("slot"); // gear | crystals | addons
  const slotKey = SLOT_KEYS[slot];
  const attachment = interaction.options.getAttachment("image");

  await interaction.deferReply({ ephemeral: true });

  const prev = getProfile(name)?.[slotKey] || null;
  const saved = await saveAttachment(attachment, name, slot, prev);
  if (!saved.ok) {
    return interaction.editReply(`🚫 ${saved.error}`);
  }

  setImage(name, slotKey, saved.relativePath);

  // For a Gear screenshot, also read AP / Awakening AP / DP off the image and
  // store them so the player's Gear Score shows on the roster — same commit.
  let gearNote = "";
  if (slot === "gear") {
    const read = await readGearStats(saved.buffer.toString("base64"), saved.mediaType);
    if (read.ok) {
      const prof = setGear(name, read);
      const gs = gearScore(prof);
      gearNote =
        gs != null
          ? `\n📈 Gear Score **${gs}** (AP ${prof.ap} · Awk ${prof.aap} · DP ${prof.dp}).`
          : `\n⚠️ Couldn't read all three stats from the image — set any missing ones on your profile page.`;
    } else if (read.error === "no-key") {
      gearNote = `\nℹ️ Auto Gear Score read is off (no \`ANTHROPIC_API_KEY\` set on the bot host).`;
    } else {
      gearNote = `\n⚠️ Couldn't auto-read Gear Score: ${read.error}`;
    }
  }

  const pub = await publish(
    ["profiles.js", saved.relativePath],
    `profile: ${name} ${slot} screenshot`
  );

  const label = SLOT_CHOICES.find((c) => c.value === slot).name;
  await interaction.editReply(
    publishLine(`📸 **${label}** screenshot saved for **${name}**.${gearNote}`, pub, name)
  );
}

async function view(interaction) {
  const target = interaction.options.getUser("member") || interaction.user;
  const name = nameForUser(target.id);
  if (!name) {
    const who = target.id === interaction.user.id ? "You haven't" : `<@${target.id}> hasn't`;
    return interaction.reply({ content: `${who} registered a family name yet (\`/profile register\`).`, ephemeral: true });
  }

  const p = getProfile(name) || {};
  const slots = [
    ["Gear", p.gearImg],
    ["Crystals", p.crystalsImg],
    ["Skill-Addons", p.addonsImg],
  ];
  const have = slots.filter(([, v]) => v).map(([k]) => k);
  const missing = slots.filter(([, v]) => !v).map(([k]) => k);

  const embed = new EmbedBuilder()
    .setColor(PURPLE)
    .setTitle(`👤 ${name}`)
    .setURL(`${SITE_URL}/player.html?name=${encodeURIComponent(name)}`)
    .addFields(
      { name: "Class", value: p.class || "—", inline: true },
      { name: "Linked to", value: `<@${target.id}>`, inline: true },
      { name: "Screenshots", value: have.length ? have.join(", ") : "none yet", inline: false }
    );
  if (missing.length) embed.addFields({ name: "Still missing", value: missing.join(", ") });

  const firstImg = p.gearImg || p.crystalsImg || p.addonsImg;
  if (firstImg) embed.setImage(`${SITE_URL}/${firstImg}`);
  embed.setFooter({ text: "View full profile on the site →" });

  return interaction.reply({ embeds: [embed] });
}

async function unlinkCmd(interaction) {
  const removed = unlink(interaction.user.id);
  if (!removed) {
    return interaction.reply({ content: "You weren't linked to a family name.", ephemeral: true });
  }
  pushLinks(allLinks()).catch(() => {});
  return interaction.reply({
    content: `🔓 Unlinked you from **${removed}**. Your uploaded screenshots stay on the site; re-register anytime.`,
    ephemeral: true,
  });
}

// ---- helpers ----

function notLinked(interaction) {
  return interaction.reply({
    content: "You need to link your family name first: `/profile register family:<your name>`.",
    ephemeral: true,
  });
}

function publishLine(success, pub, name) {
  let tail;
  if (pub.pushed) tail = "🚀 Pushed — it'll be live on the site in ~1–2 minutes.";
  else if (pub.error) tail = `⚠️ Saved, but auto-publish failed: ${pub.error}`;
  else tail = "ℹ️ Saved (no site change needed).";
  const link = name ? `\n${SITE_URL}/player.html?name=${encodeURIComponent(name)}` : "";
  return `✅ ${success}\n${tail}${link}`;
}
