// Canonical guild ATTENDANCE — per-player sign-up vs. actual-war-result
// counts, computed by the Discord bot after every /addwar from bot/data/
// signups.json + data.js. The website reads this via
// <script src="attendance.js"> for the Dashboard attendance panel.
// Contains NO Discord IDs — the name<->Discord link is kept privately on
// the bot host (bot/data/links.json), never published here.
window.GUILD_ATTENDANCE = {};
