// Canonical guild ATTENDANCE — sign-up vs. actual-war-result data,
// computed by the Discord bot after every /addwar from bot/data/
// signups.json + data.js. Shape: { players: {<name>: {signups, attended,
// noShows, rate, updatedAt, noShowWars: [{date, location}]}}, byWar:
// {<date>: {location, noShows: [{name, status}]}} } — byWar only has an
// entry for dates with matching sign-up data; its absence means no
// sign-up data exists for that war, distinct from zero no-shows. Read by
// dashboard.html (Attendance panel) and war-scores.html (per-war panel)
// via <script src="attendance.js">.
// Contains NO Discord IDs — the name<->Discord link is kept privately on
// the bot host (bot/data/links.json), never published here.
window.GUILD_ATTENDANCE = {
  "players": {
    "HaterApproved": {
      "signups": 4,
      "attended": 4,
      "noShows": 0,
      "rate": 1,
      "updatedAt": "2026-08-01T13:38:22.174Z",
      "noShowWars": []
    },
    "EXTRA_LARGE": {
      "signups": 2,
      "attended": 2,
      "noShows": 0,
      "rate": 1,
      "updatedAt": "2026-08-01T13:38:22.174Z",
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
      "updatedAt": "2026-08-01T13:38:22.174Z"
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
      "updatedAt": "2026-08-01T13:38:22.174Z"
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
      "updatedAt": "2026-08-01T13:38:22.174Z"
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
      "updatedAt": "2026-08-01T13:38:22.174Z"
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
