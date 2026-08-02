// FROZEN pre-D1-migration snapshot (2026-08-02) — NOT read by the site or
// written by the bot anymore. Canonical attendance now lives in Cloudflare
// D1 (worker/schema.sql) as a bot-computed blob, served live via the
// Worker's GET /attendance.js. This file is kept only as a manual
// point-in-time fallback; editing it has no effect on the live site. See
// CLAUDE.md's "Canonical guild data moved to Cloudflare D1" hosting note.
// Shape: { players: {<name>: {signups, attended, noShows, rate, updatedAt,
// noShowWars: [{date, location}]}}, byWar: {<date>: {location, noShows:
// [{name, status}]}} } — byWar only has an entry for dates with matching
// sign-up data; its absence means no sign-up data exists for that war,
// distinct from zero no-shows.
// Contains NO Discord IDs — the name<->Discord link is kept privately on
// the bot host (bot/data/links.json), never published here.
window.GUILD_ATTENDANCE = {
  "players": {
    "HaterApproved": {
      "signups": 4,
      "attended": 4,
      "noShows": 0,
      "rate": 1,
      "updatedAt": "2026-08-01T13:52:58.742Z",
      "noShowWars": []
    },
    "EXTRA_LARGE": {
      "signups": 2,
      "attended": 2,
      "noShows": 0,
      "rate": 1,
      "updatedAt": "2026-08-01T13:52:58.742Z",
      "noShowWars": []
    },
    "Greedyboy": {
      "signups": 1,
      "attended": 0,
      "noShows": 1,
      "noShowWars": [
        {
          "date": "2026-06-27",
          "location": "Conquest War"
        }
      ],
      "rate": 0,
      "updatedAt": "2026-08-01T13:52:58.742Z"
    },
    "Ghond": {
      "signups": 1,
      "attended": 0,
      "noShows": 1,
      "noShowWars": [
        {
          "date": "2026-06-27",
          "location": "Conquest War"
        }
      ],
      "rate": 0,
      "updatedAt": "2026-08-01T13:52:58.742Z"
    },
    "NightBringers": {
      "signups": 1,
      "attended": 0,
      "noShows": 1,
      "noShowWars": [
        {
          "date": "2026-06-27",
          "location": "Conquest War"
        }
      ],
      "rate": 0,
      "updatedAt": "2026-08-01T13:52:58.742Z"
    },
    "Zebraghost": {
      "signups": 1,
      "attended": 0,
      "noShows": 1,
      "noShowWars": [
        {
          "date": "2026-06-27",
          "location": "Conquest War"
        }
      ],
      "rate": 0,
      "updatedAt": "2026-08-01T13:52:58.742Z"
    }
  },
  "byWar": {
    "2026-06-26": {
      "location": "Defeat",
      "noShows": []
    },
    "2026-06-27": {
      "location": "Conquest War",
      "noShows": [
        {
          "name": "Ghond",
          "status": "in"
        },
        {
          "name": "Greedyboy",
          "status": "in"
        },
        {
          "name": "NightBringers",
          "status": "in"
        },
        {
          "name": "Zebraghost",
          "status": "in"
        }
      ]
    }
  }
};
