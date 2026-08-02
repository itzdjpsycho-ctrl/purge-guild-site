// FROZEN pre-D1-migration snapshot (2026-08-02) — NOT read by the site or
// written by the bot anymore. Canonical profiles now live in Cloudflare D1
// (worker/schema.sql), served live via the Worker's GET /profiles.js. This
// file is kept only as a manual point-in-time fallback; editing it has no
// effect on the live site. See CLAUDE.md's "Canonical guild data moved to
// Cloudflare D1" hosting note.
// Contains NO Discord IDs — the name<->Discord link is kept privately on the
// bot host (bot/data/links.json), never published here.
window.GUILD_PROFILES = {
  "HaterApproved": {
    "updatedAt": "2026-08-01T12:23:02.876Z",
    "ap": 381,
    "aap": 387,
    "dp": 453,
    "class": "Sage"
  },
  "HoneyBadger": {
    "gearImg": "assets/profiles/honeybadger-gear.png",
    "updatedAt": "2026-08-01T14:57:11.632Z",
    "ap": 384,
    "aap": 390,
    "dp": 456
  }
};
