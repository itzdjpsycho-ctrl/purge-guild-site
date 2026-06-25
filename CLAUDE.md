# Purge Guild Website — CLAUDE.md

## Project Overview

Dark-themed static HTML guild management site for a Black Desert Online (BDO) Node War guild called **Purge**. No backend, no build tools — pure HTML/CSS/JS. Auto-deploys to **GitHub Pages** on every git push.

- **Live site:** https://itzdjpsycho-ctrl.github.io/purge-guild-site/ (GitHub Pages — moved off Netlify to avoid build-minute limits)
- **GitHub:** https://github.com/itzdjpsycho-ctrl/purge-guild-site
- **Local folder:** C:\Users\MyPC\src (original was D:\Website Building — force pushed to sync)

> **Hosting note:** The site is served by GitHub Pages (free, no build-minute cap). It is a **pure static site with no server-side component** — there is no place to safely hold an API key, so there is no in-page Claude/OCR feature. The old Netlify serverless function (`netlify/functions/extract-war.js`) and `netlify.toml` have been **removed** from the repo. The in-page 📸 screenshot extraction (War Scores) and the player-page "Read gear" button now simply show a fallback message pointing to the Discord bot. All OCR (war results + gear) is handled by the **Discord bot** (`/addwar`, `/profile upload`), which holds the API key in `bot/.env`; add wars by pasting screenshots to Claude → editing `data.js`, or via the War Scores **{ } Manual JSON** option.

---

## Files

| File | Purpose |
|------|---------|
| `home.html` | Landing page. Crimson dark theme, logo placeholder, live stats strip, quick-link cards, most recent war panel. |
| `index.html` | **War Scores page (main page).** Match tabs grouped by week (collapsible). Squad Roles panel with drag-and-drop — scrollable when overflow. + Add War button: 📸 Screenshot mode (inactive on Pages — shows a "use the Discord bot / Manual JSON" message) OR { } Manual JSON paste mode. Player name search. Class column. "Clear Added Wars" double-tap button. |
| `players.html` | Roster page. Grid of player cards. Each card has a role dropdown that saves to localStorage instantly and syncs with War Scores. Export/Import JSON. |
| `player.html` | Individual player profile (`player.html?name=Popspolar`). Class dropdown (31 BDO classes), 3 screenshot slots (Gear / Crystals / Skill-Addons), war history table. |
| `dashboard.html` | Guild stats. Banner: "Purge Statistics". Win rate ring, streak badge, node location breakdown, top 10 performers (K/D / Kills / Deaths tabs), per-player trend charts. |
| `push.bat` | Double-click to commit and push to GitHub. |
| `data.js` | **Canonical guild data — single source of truth for the site AND the Discord bot.** Sets `window.GUILD_DATA = { guildName, rosterMembers, matches, extendedStats }`. Every HTML page loads it via `<script src="data.js"></script>` and reads `MATCHES` / `EXTENDED_STATS` / `ROSTER_MEMBERS` from it. Edit this file to add wars or members. |
| `profiles.js` | **Canonical per-player profiles — class, gear/crystals/skill-addons screenshot paths, and gear stats.** Sets `window.GUILD_PROFILES = { "<FamilyName>": { class, gearImg, crystalsImg, addonsImg, ap, aap, dp, updatedAt } }`. `ap`/`aap`/`dp` drive the roster Gear Score = `round((ap+aap)/2 + dp)`. Read by `players.html` / `player.html`; written by the Discord bot's `/profile` commands. **Contains NO Discord IDs** — the name↔Discord link is kept privately in `bot/data/links.json` (git-ignored), never published. |
| `assets/profiles/` | Uploaded gear/crystals/addon screenshots, committed to the repo. Filenames are `<slug>-<slot>.<ext>` (e.g. `haterapproved-gear.webp`). Written by the bot's `/profile upload`. |
| `bot/` | **Discord bot** (Node.js / discord.js v14). `/mvp` (weighted single-MVP per war), `/stats` (player extended stats), `/signup` (Node War sign-up sheet — role-group columns with `filled/cap` capacities, numbered slots, class picker, ⏰-late / struck-through-bench, Tentative/Absence lists; members self-pick role + class and set availability, admins place/override/bench via `/signup add`; roles + caps in `config.js` `SIGNUP_ROLES`, states in `SIGNUP_STATUSES`), `/profile` (self-serve family-name registration + class/gear-screenshot upload), `/addwar` (admin-only — upload war result screenshots, Claude vision extracts the table, Confirm/Cancel review, then writes the war into `data.js` and auto-pushes), `/balance` (Balanced War Builder — add guilds with a 1–10 skill seed via a modal, bot splits them into two skill-even teams with a re-rollable randomizer). Reads the same `data.js` / `profiles.js`. Setup in `bot/README.md`. Runs on the user's PC (`npm start`). |

---

## Theme — Purge Neon Purple Dark (all pages)

```
Background:    #08060C with neon-purple radial glow atmosphere
Panels:        #110D18 / #181222
Hairlines:     #2A1F3A / #1A1426
UI accent:     neon purple #6E1FB8 / #8B2FD9 / #AB4DFF (glow #C77DFF)
Data colours:  gold #C49A30 / #E8BC55 (K/D, victories)
               green #5BC976 (kills)
               red #D65A45 (deaths/defeats)
Fonts:         Fraunces (display), IBM Plex Mono (mono), Inter (UI)
Nav active:    neon purple (not gold)
```

*(CSS vars are still named `--crimson*` for historical reasons — they now hold purple values.)*

---

## Data Architecture

- `MATCHES`, `EXTENDED_STATS`, `ROSTER_MEMBERS` — now live ONCE in `data.js` (`window.GUILD_DATA`). Every page reads them from there via `const MATCHES = window.GUILD_DATA.matches;` etc. No more per-file duplication. The Discord bot reads the same `data.js`.
- `localStorage["nodeWarDynamicMatches"]` — uploaded wars
- `localStorage["nodeWarDynamicExtended"]` — extended stats from uploads
- `profiles.js` (`window.GUILD_PROFILES`) — canonical class + gear/crystals/addon screenshot paths per player, written by the bot's `/profile` commands (see below).
- `localStorage["nodeWarPlayerProfiles"]` — local/legacy class + gear screenshots per player (browser-side, pre-`profiles.js`)
- `localStorage["nodeWarSquadRoles"]` — role assignments (shared: index.html + players.html)
- Export/Import JSON on roster page saves everything to `guild-data.json`

**Function order matters:** `applyDynamicMatches()` must run before `buildOverall()` and `applyMainballDefaults()`.

---

## Player Profiles (`/profile` Discord command → `profiles.js`)

Players self-serve their own profile in Discord; the bot writes `profiles.js` + image files and **auto-commits/pushes** so the site updates in ~1–2 min. No manual editing needed.

**Slash commands** (`bot/src/commands/profile.js`):

| Subcommand | What it does |
|------------|--------------|
| `/profile register family:<name>` | Links the caller's Discord ID to a canonical family name (autocompletes from roster + anyone who's played a war). One name per user, one user per name. |
| `/profile class class:<class>` | Sets the player's BDO class (autocompletes from the 31 classes). |
| `/profile upload slot:<Gear\|Crystals\|Skill-Addons> image:<file>` | Downloads the attachment, saves it to `assets/profiles/<slug>-<slot>.<ext>`, records the path. Validates type (PNG/JPG/WebP) and ≤ 8 MB; deletes the prior file if the extension changed. **For the Gear slot**, also reads AP / Awakening AP / DP off the screenshot (Claude vision) and stores `ap`/`aap`/`dp` so the player's **Gear Score** appears on the roster — all in the same commit. |
| `/profile view [member]` | Embeds a player's class, linked Discord user, and which screenshots exist, with a link to `player.html?name=…`. |
| `/profile unlink` | Removes the caller's name↔Discord link (uploaded screenshots stay on the site). |

**Supporting libs** (`bot/src/lib/`):

- `profiles.js` — read/write the repo-root `profiles.js` (`window.GUILD_PROFILES`); `knownNames()` / `canonicalName()` resolve typed names against roster + war participants. `SLOT_KEYS` maps slot → `gearImg`/`crystalsImg`/`addonsImg`.
- `images.js` — downloads & saves attachments under `assets/profiles/`; `slug()`, type/size validation, stale-file cleanup. Returns the image `buffer` + `mediaType` so the gear reader can run without re-reading from disk.
- `gear.js` — `readGearStats(base64, mediaType)` calls the Anthropic Messages API (`claude-sonnet-4-6`, vision) to OCR AP/AwkAP/DP — same prompt the website uses; `gearScore()` computes `round((ap+aap)/2 + dp)`. Needs `ANTHROPIC_API_KEY` in the bot's `.env` (**optional** — without it, gear images still upload, the Gear Score read is just skipped). This runs on the bot host — the key lives only in `bot/.env` (git-ignored), never in the site or the repo.
- `links.js` — private Discord-ID ↔ family-name map at `bot/data/links.json` (**git-ignored** — never published; `data/` is in `bot/.gitignore`).
- `git.js` — `publish(paths, message)`: stages **only** the given paths (never `git add -A`), commits, pushes `HEAD:main`, and auto-rebases (`pull --rebase --autostash`) on a rejected push so concurrent pushes and unrelated working-tree files are left untouched.

**Privacy rule:** `profiles.js` and `assets/profiles/` are public (committed); Discord IDs live only in `bot/data/links.json` on the bot host and must never be committed.

---

## Current Hardcoded MATCHES (2 wars)

```js
{ date:"2026-06-19", day:"Friday", location:"Ulukita", result:"Defeat",
  players:[
    ["Popspolar",30,14],["Milkdudh",25,14],["Aodhan",24,10],["Dreamxx",18,21],
    ["HaterApproved",17,17],["BrotherMango",17,16],["KillShotz",16,18],["Beastylirious",15,21],
    ["Rostalina",15,19],["Alancar",15,17],["ScummySteve",13,9],["Valth",12,17],
    ["Mcy",10,15],["Kraiok",10,19],["LulzCaptain",9,18],["TheWretched",9,21],
    ["Serade",7,17],["HeRoisMx",7,3],["Rozuns",6,14],["Succs",6,17],
    ["Cohrence",5,17],["Lulupeach",4,11],["SirHeathen",3,13],["XastusMK",2,21],
  ]
},
{ date:"2026-06-23", day:"Tuesday", location:"Calpheon", result:"Victory",
  players:[
    ["Seljah",15,0],["Ghond",10,0],["Pewcifer",9,0],["Menteeing",9,1],["Kraiok",9,2],
    ["ScummySteve",6,0],["BrotherMango",6,0],["Rozuns",6,0],["Pebbles",6,1],
    ["Alancar",5,0],["Rabid",5,0],["Flusha",5,0],["Rostalina",5,0],
    ["KillShotz",4,1],["Aodhan",3,0],["Dreamxx",3,1],
    ["Bossdogg",2,1],["Beastylirious",2,0],["HiiroNoAme",2,0],
    ["Mcy",1,1],["LunAqua",1,0],["SirHeathen",1,2],
    ["HaterApproved",0,1],["XastusMK",0,0],
  ]
}
```

Full extended stats exist for both wars in `EXTENDED_STATS` (keyed by date) in `data.js`.

---

## Adding New Wars

Three ways, in rough order of convenience:

1. **`/addwar` Discord command (admin-only).** Upload 1–5 war result screenshots → Claude vision (bot's `ANTHROPIC_API_KEY`) extracts date/day/location/result + every player's full stats → admin reviews a preview embed → **Confirm** writes the war into `data.js` (`matches` + `extendedStats`) and auto-pushes. Lib: `bot/src/lib/war.js` (OCR, same prompt the site used) + `addWar()`/`saveData()` in `bot/src/lib/data.js` (load → mutate → re-serialize pretty-printed JSON, so diffs stay to the one new war). Replaces an existing war if the date matches.
2. **Paste war screenshots in chat → Claude** reads them, extracts all stats, edits `data.js` directly, commits and pushes. No API key needed.
3. **War Scores → + Add War → { } Manual JSON** — paste data directly, no API needed.

*(Both the site and the bot pick up new wars automatically — the bot reads `data.js` fresh on every command, no restart needed.)*

> The site's old **📸 Screenshot** mode ran on a Netlify serverless function that has since been **removed** (see Hosting note above). On GitHub Pages it now just shows a fallback message pointing to `/addwar` / Manual JSON.

---

## Key Rules & Decisions

- **Desktop only** — no mobile layout, do not adjust for mobile
- War Scores page is `index.html`, not `war-scores.html`
- New players auto-assigned **Mainball** role until manually changed
- Screenshot extraction: kills from **score/flag icon column**, NOT fox/wolf icon
- Class icons rejected — plain mono text used instead
- **Nav on all pages:** Home · War Scores · Roster · Dashboard
- All pages share identical nav — keep in sync when adding pages
- Roles shared between pages via `localStorage["nodeWarSquadRoles"]`

---

## BDO Classes (31)

Warrior, Ranger, Sorceress, Berserker, Tamer, Musa, Maehwa, Valkyrie, Kunoichi, Ninja, Wizard, Witch, Dark Knight, Striker, Mystic, Lahn, Archer, Shai, Guardian, Nova, Sage, Corsair, Hashashin, Drakania, Woosa, Maegu, Scholar, Dosa, Deadeye, Wukong, Seraph

*(Verified against official NA/EU site. Taoist, Plum Blossom, Lancer were removed — not real classes.)*

---

## Git Workflow (PowerShell — no && chaining)

```powershell
git add .
git commit -m "your message"
git push origin main
```

Or double-click `push.bat`.
