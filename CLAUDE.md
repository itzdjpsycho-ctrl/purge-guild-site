# Purge Guild Website — CLAUDE.md

## Project Overview

Dark-themed static HTML guild management site for a Black Desert Online (BDO) Node War guild called **Purge**. No backend, no build tools — pure HTML/CSS/JS. Auto-deploys to **GitHub Pages** on every git push.

- **Live site:** https://itzdjpsycho-ctrl.github.io/purge-guild-site/ (GitHub Pages — moved off Netlify to avoid build-minute limits)
- **GitHub:** https://github.com/itzdjpsycho-ctrl/purge-guild-site
- **Local folder:** C:\Users\MyPC\src (original was D:\Website Building — force pushed to sync)

> **Hosting note:** The site is served by GitHub Pages (free, no build-minute cap) and is a **pure static site**. Secrets that the site needs now live in the **Cloudflare Worker** (`worker/`), which holds API keys safely (see the `worker/` row + the Sign Ups architecture). The old Netlify serverless function (`netlify/functions/extract-war.js`) and `netlify.toml` were **removed**. **Gear OCR is back in-page:** the player-page "Read gear" button posts the Gear screenshot to the Worker's `POST /gear` (Claude vision, `ANTHROPIC_API_KEY` Worker secret) and auto-fills AP/Awk-AP/DP. War-result OCR is still **Discord-bot-only** (`/addwar`) — the in-page 📸 War Scores extractor stays a fallback pointing to `/addwar` / Manual JSON. The bot also reads gear via `/profile upload` (key in `bot/.env`).
>
> **Canonical guild data moved to Cloudflare D1 (2026-08, migration completed).** `data.js`/`profiles.js`/`attendance.js` at the repo root are no longer read by the site or written by the bot — they're a **frozen pre-migration snapshot**, deliberately kept in the repo as a manual point-in-time fallback (each file's own header says so too). The Worker's `purge-guild-db` D1 database (`worker/schema.sql`, read/write logic in `worker/src/data.js`) is the single source of truth for wars/roster/profiles/attendance, for **both** the site and the bot — the old KV-queue-and-poll plumbing (`/war-op`, `/profile-op`, `/merge-op`) was removed once this proved out with a real war added end-to-end through `/addwar`. Officer actions that used to require "the bot running + wait ~1–2 min for a git push + GitHub Pages redeploy" (deleting a war, editing a profile, merging a renamed player, syncing the roster) now take effect **immediately** — the Worker mutates D1 directly, officer-session-gated, no bot involved. `assets/profiles/*` screenshot **files** are the one exception — they're still git-committed static assets (D1 only stores their *path*), so a freshly-uploaded screenshot still takes the usual ~1–2 min to actually render even though its path is live right away.

---

## Files

| File | Purpose |
|------|---------|
| `index.html` | **Landing page (site root — GitHub Pages serves this at the bare domain URL).** Crimson dark theme, logo placeholder, live stats strip, an "Explore by Category" section (four tiles — Overview/Warfare/Media/Tools, mirroring the sidebar's groups — replaced the old flat 3-card quick-link grid, see "Sidebar nav" below), most recent war panel. Formerly `home.html` — renamed to `index.html` so the root URL lands on Home instead of War Scores. |
| `home.html` | **Redirect shim only** — `<meta http-equiv="refresh">` to `index.html`, kept so old bookmarks/links to `home.html` (pre-rename) don't 404. Not a real page. |
| `war-scores.html` | **War Scores page.** Match tabs grouped by week (collapsible) — only the **Overall** tab shows until a week is picked from the dropdown; picking one reveals that week's individual war tabs, and clearing back to "All weeks" resets to Overall. Squad Roles panel with drag-and-drop — scrollable when overflow. + Add War button: 📸 Screenshot mode (inactive on Pages — shows a "use the Discord bot / Manual JSON" message) OR { } Manual JSON paste mode. Player name search. Class column. "Clear Added Wars" double-tap button (overall view; wipes locally-pasted wars only). Per-war "Remove This War" double-tap button (single-match view) — deletes it instantly if it's a locally-pasted war; otherwise (a committed war living in D1) calls the Worker's `DELETE /matches/:date` (officer-gated) directly — takes effect immediately, no bot required. **Guild-Master-only "Clear ALL Wars"** double-tap button (overall view, next to "Clear Added Wars") — permanently deletes **every** war for the whole guild (committed D1 history + local test data), calling the Worker's `DELETE /matches` (guildmaster-rank-gated, stricter than the general officer gate) — irreversible, no undo, affects every visitor immediately. |
| `players.html` | Roster page. Grid of player cards. Each card has a role dropdown that saves to localStorage instantly and syncs with War Scores. Export/Import JSON. **Officer-only 🔀 Merge Stats button** — combines two names' entire history (a character rename) into one: picks "old name" + "keep this name" from a datalist of every known name, shows a client-side preview (war counts for each), then double-tap-confirms and calls the Worker's `POST /merge` (officer-gated) directly — merges D1's war history + profile gear/class/screenshots + the private Discord link (bot-side `renameLink()`, still needs the bot for that one piece), takes effect immediately for the war/profile data. **Officer-only 📊 View My Stats button** on each card — links to `my-stats.html?name=<player>` (see below). |
| `player.html` | Individual player profile (`player.html?name=Popspolar`). Class dropdown (31 BDO classes), 3 screenshot slots (Gear / Crystals / Skill-Addons), AP/Awk-AP/DP fields + Gear Score, war history table — **click a war row to pop up that war's full scoreboard** (extended stats when available, sortable columns, current player's row highlighted, link to open the same war on War Scores). **"Read from gear screenshot"** posts the Gear slot image to the Worker's `POST /gear` (Claude vision) and auto-fills AP/Awk-AP/DP → roster Gear Score. Loads `WORKER_URL` (same constant as `signups.html`). |
| `my-stats.html` | **My Stats page** — a personal dashboard for the signed-in Discord user (`PurgeAuth.state.familyName`). Self-only for regular members; an **officer** may pass `?name=<player>` (e.g. Roster's "View My Stats" button) to inspect anyone's dashboard — a banner ("Viewing X's dashboard as an officer") makes this obvious, and a non-officer's `?name=` is silently ignored (falls back to their own). The page is read-only either way (no write/fetch calls), so viewing someone else is inherently safe. **Composed Identity** (top of page, full-width) — an 8-spoke SVG "playstyle wheel" (Damage/Control/Siege/Tanked/Healing/Uptime as S–D letter grades, Streaks/Burst as "+N" chips) percentile-graded per category against roster-mates with ≥3 appearances (`IDENTITY_ROSTER_MIN_APPEARANCES`), gated behind 5 detailed wars like Lifetime Attendance below; a headline persona (e.g. "Sapper" / Siegebreaking) named after whichever of the 6 core categories the player ranks highest in (`IDENTITY_PERSONAS`); and a v1 catalog of 12 independently-unlockable trait badges (`IDENTITY_TRAIT_DEFS`) — deliberately smaller than a reference tool's 26-trait catalog, meant to grow once real war data shows which patterns are worth adding. Burst has no raw stat backing it (approximated as damage-per-time-alive); cannons-landed/objectives-destroyed are excluded from Siege entirely since they're populated on ~0% of real rows (OCR rarely catches them) — Siege is fortDmg alone. Below that: Performance Trend (canvas line chart, You vs. Guild Avg vs. Guild Median, metric cycle K/D → Kills → Damage → CC → Healing, Last-10/All range toggle), War Record card, Trophy Case (career bests), Lifetime Attendance gauge (gated behind 5 wars), Weekly Roundup, Guild Standards checklist (config: K/D ≥ 1.0, Attendance ≥ 70%), Coaching (templated insight text, no AI call), an attendance calendar (current + previous month), and Recent Wars. Still deliberately excludes Class Matchups/Know Your Enemy (no opponent-identity data exists to support it) — that part of the original exclusion note stands; Composed Identity itself turned out not to need opponent data and got built. |
| `dashboard.html` | Guild stats. Banner: "Purge Statistics". **Weekly Update** section (top of page, under the summary stats) — 5 cards for the most recent logged war week (Monday-start, same grouping as `war-scores.html`): Top K/D, Top Kills, Highest CC, Fort Damage (all from that week's `data.js`/`extendedStats`), and Attendance (ranked by War Scores appearances across **all** logged wars — not sign-up data, since `attendance.js` sign-up history is separate and often empty). Cards are config-driven (`WEEKLY_CATEGORIES` array in the inline script) — add/remove/reorder by editing that array; the grid reflows automatically. Below that: win rate ring, streak badge, node location breakdown, top 10 performers (K/D / Kills / Deaths tabs), per-player trend charts, sign-up Attendance panel (Most Reliable / Frequent No-Shows, from `attendance.js`, min. 3 sign-ups to qualify — this one *is* sign-up-based, unlike the Weekly Update card). |
| `signups.html` | **Sign Ups page.** Editable Node War sign-up board: war details (date/time/location/notes/open-closed), drag-and-drop columns (Unassigned + the 11 `SIGNUP_ROLES` w/ caps + Bench/Tentative/Absence), per-chip status + class selectors, add roster members or guests. **"Post to Discord"** sends the sheet to the **Cloudflare Worker relay** (`worker/`), which posts it to the admin-designated channel **as the bot** (so it works from any computer, even when the bot PC is off). A read-only "live view" polls the Worker's `GET /state` to show the current Discord sign-ups (no Discord IDs). Roles/statuses/classes are a **MIRROR of `bot/src/config.js`** — keep in sync. Set `WORKER_URL` near the top of the file. |
| `combat-log.html` | **Combat Log page.** Drop an Ikusa or CoGM Logger `.log` export (third-party BDO network-sniffing loggers, not an official game feature) and it's parsed **entirely client-side** — nothing uploaded just from opening a file. Recognizes both loggers' shared line grammar (`PlayerOne has killed/died to PlayerTwo from GuildName`, CoGM adds in-game character names in parens); a dedup pass collapses same-matchup rebroadcasts within a ~15s window (a known packet-logger artifact). Renders a **Guild Breakdown** (hero "OUR GUILD" card — big K/D, kills/deaths with per-minute rate, top-3 killers/most-deaths from our own roster with class icons via `profiles.js` — followed by a card per enemy guild with just K/D + a kill:death split-bar; enemy cards **can't** show class composition since BDO combat-logger exports never carry class info for anyone outside our own roster, only names + guild tags — a hard data limitation, not a styling gap), a per-player table, and a live-feed-style **Combat Log** (tight, timestamped, newest-first). **"Save to Website"** (any signed-in member) persists the parsed+deduped events to D1 (`combat_logs` table, via the Worker's `/combat-logs` routes) with a title and an optional **link to a war** (validated against `matches`) — the **Saved Combat Logs** panel above the upload zone lists every saved log (linked war shown as a `war-scores.html?war=...` link) with View (reloads it into the same display, no re-upload) and Delete (officer or original uploader, double-tap-confirmed) actions. |
| `vod-review.html` | **VOD Review page.** Any signed-in member can post a YouTube link (title + URL — the Worker extracts the video id server-side) to a shared board (D1 `vods`/`vod_notes` tables, via the Worker's `/vods` routes), optionally tagging it with one of the 31 BDO classes (`class` column, nullable = "General") so class-specific teaching VODs can be filtered — a **Filter by class** dropdown above the grid does client-side filtering over the fetched list. Opening a VOD embeds it via the **YouTube IFrame API** alongside a notes panel: type a timestamped note (auto-fills from the player's current time), optionally toggle **✏️ Draw** first to freehand-sketch over the paused frame (colored pen, undo, clear — a lightweight telestrator, not a full editor) and check "Attach drawing" to save that sketch on the note. Clicking a note seeks the player to its timestamp and redraws its attached sketch (if any) read-only. Adding/deleting a note re-fetches just the notes/metadata (`refreshNotes()`) rather than reloading the whole VOD, so the video doesn't restart mid-playback. The video box (`.video-stage`) sits full-width above the notes row and has a native CSS `resize:both` drag handle on its bottom-right corner. Deleting a VOD or a note is double-tap-confirmed and gated to an officer or the original poster/author (`addedByDiscordId`/`authorDiscordId` checked against the signed-in session). Class list is a **MIRROR of `worker/src/constants.js` `BDO_CLASSES`** (same pattern as `player.html`) — keep in sync. |
| `clips.html` | **Clips page.** A lighter-weight sibling of VOD Review, for quick highlight/fail clips rather than full teaching sessions — no timestamped notes or drawing. Any signed-in member posts a video link + title + one class tag (D1 `clips` table via the Worker's `/clips` routes). **Two link sources**, auto-detected server-side: a YouTube URL (`source:"youtube"`, embedded via `<iframe>`) or a direct Discord CDN attachment link — `cdn.discordapp.com`/`media.discordapp.net` `/attachments/.../clip.mp4` (`source:"discord"`, played back with a plain `<video>` tag; card thumbnail falls back to a generic "🎮 Discord Clip" placeholder since there's no thumbnail API for it). The grid has a text search box (title substring) plus the same **Filter by class** dropdown pattern as VOD Review, both client-side over the fetched list. Clicking a card opens a lightbox modal and a double-tap-confirmed Delete gated to an officer or the original poster (`addedByDiscordId`, included directly in the public `GET /clips` list response since — unlike VOD Review — there's no separate per-item detail fetch to carry it). |
| `tachyon-tracker.html` | **Tachyon Puzzle Tracker page.** A reference/checklist page for BDO's "Tachyon" world-event markers — **not guild data**, no Worker/D1 involvement. Two tabs: **Tachyon Traces** (the puzzle layer) and **Tachyon Legacy** (a parallel combat layer), 100 markers each, grouped into 7 zone accordions (`Onslaught I–VII` / `Supremacy I–VII`). The `TACHYON_TRACES`/`TACHYON_LEGACY` arrays are a **static snapshot pulled from bdoworkshop.com/map's Inertia page-props JSON** (`markers[]`, keyed by `layer: "trace"`/`"legacy"`) on 2026-08-15 — re-pull from the source (view `data-page` attribute on that URL, or the `props.markers` it decodes to) if it goes stale; a page banner links back to the live version. That source is itself a **crowdsourced tracker still being filled in by players** — roughly 40% of Traces coordinates/rewards and a handful of Legacy ones aren't reported yet, encoded as `c:null, x:0, z:0` and rendered as "Not yet reported" rather than a fake location. Found/not-found checkboxes save to `localStorage` per layer (`tachyonTrackerFound_trace`/`_legacy`) — **personal to each visitor's browser, not shared with the guild**, same pattern as Squad Roles. Search, Hide Found, Expand/Collapse All, and a double-tap-confirmed per-layer Reset Progress round out the controls; each coordinate row has a Copy button for the raw in-game world X/Z. |
| `worker/` | **Cloudflare Worker relay** (free tier, `workers.dev` + a KV namespace + a D1 database). Bridges the static site to the bot for sign-ups, AND holds the canonical guild data in D1 (`purge-guild-db`, schema in `worker/schema.sql`, read/write logic in `worker/src/data.js`). Holds `DISCORD_BOT_TOKEN` as a secret and posts/edits the sheet via the Discord REST API, emitting the **same `signup:*` component customIds** the bot routes on (`src/discord.js` mirrors `bot/src/lib/embeds.js`). Endpoints: `GET /data.js` & `/profiles.js` & `/attendance.js` (public — D1-backed, served as literal JS, drop-in replacement for the old committed files), `DELETE /matches/:date` & `POST /matches` & `POST /profiles/:name` & `POST /merge` (officer-session gated, or `x-bot-secret` for the Discord-initiated equivalents — direct D1 writes, take effect immediately, no bot poll required), `POST /post` & `/edit` & `/op` (officer-session gated, sign-ups), `GET /state` (public, sanitized), `POST /state` & `/config` & `/roster` & `/attendance` & `GET /posted` & `GET /ops` (gated by `BOT_PUSH_SECRET`, bot-only), `POST /gear` & `/war` (public, origin-locked + size-capped — Claude vision OCR, `ANTHROPIC_API_KEY` secret), `GET /vods` & `GET /vods/:id` (public) & `POST /vods` & `POST /vods/:id/notes` (any signed-in member) & `DELETE /vods/:id` & `DELETE /vods/:id/notes/:noteId` (officer or the poster/author — VOD Review, D1 `vods`/`vod_notes` tables), `GET /clips` (public) & `POST /clips` (any signed-in member) & `DELETE /clips/:id` (officer or poster — Clips, D1 `clips` table), `GET /nav-order` (public) & `POST /nav-order` (**guildmaster rank only**, stricter than the general officer gate — sidebar link order, KV key `navOrder`), `DELETE /matches` (**guildmaster rank only**, same bar as `/nav-order` — wipes every war + extended-stats row from D1 in one shot, War Scores' "Clear ALL Wars" button, irreversible), `GET /combat-logs` (public) & `POST /combat-logs` (any signed-in member) & `GET /combat-logs/:id` (public) & `DELETE /combat-logs/:id` (officer or uploader — Combat Log, D1 `combat_logs` table), and `GET /merge-ops` (`x-bot-secret`) — drains "renameLink" ops `POST /merge` queues onto KV so the bot's `link-sync.js` can keep the private Discord-link map in sync after a character-rename merge (the one piece a merge can't do entirely in the Worker). The old `/war-op`/`/profile-op`/`/merge-op` queue-and-poll endpoints from the pre-D1 architecture were removed (2026-08) once the direct D1 endpoints above proved out with a real war cycle. Setup in `worker/README.md`. Deployed separately (`wrangler deploy`) — NOT served by GitHub Pages. |
| `push.bat` | Double-click to commit and push to GitHub. |
| `data.js` | **Legacy — no longer read by the site or written by the bot.** Canonical guild data (`window.GUILD_DATA = { guildName, rosterMembers, matches, extendedStats }`) now lives in the Worker's D1 database (see the `worker/` row); every page loads it via `<script src="https://purge-signups.itzdjpsycho.workers.dev/data.js">` instead. This file is a frozen pre-migration snapshot, kept as a fallback until a soak period passes. |
| `profiles.js` | **Legacy — no longer read by the site or written by the bot.** Canonical per-player profiles (class, gear/crystals/skill-addons screenshot paths, gear stats) now live in D1; pages load `.../profiles.js` from the Worker instead. `ap`/`aap`/`dp` still drive the roster Gear Score = `round((ap+aap)/2 + dp)`. This file is a frozen pre-migration snapshot. |
| `assets/profiles/` | Uploaded gear/crystals/addon screenshots, still committed to the repo (D1 only stores their *path*, not the image bytes — this part of the migration is unchanged). Filenames are `<slug>-<slot>.<ext>` (e.g. `haterapproved-gear.webp`). Written by the bot's `/profile upload`. |
| `attendance.js` | **Legacy — no longer read by the site or written by the bot.** Canonical per-player attendance summary now lives in D1 as a bot-computed blob; pages load `.../attendance.js` from the Worker instead. Still computed the same way — `bot/src/lib/attendance.js`'s `computeAttendance()` cross-references every historical sign-up sheet (`bot/data/signups.json`, git-ignored) against D1's matches — only `writeAttendance()` now pushes the result to the Worker's `POST /attendance` instead of writing this file. This file is a frozen pre-migration snapshot. |
| `bot/` | **Discord bot** (Node.js / discord.js v14). `/mvp` (weighted single-MVP per war), `/stats` (player extended stats), `/signup` (Node War sign-up sheet — role-group columns with `filled/cap` capacities, numbered slots, class picker, ⏰-late / struck-through-bench, Tentative/Absence lists; members self-pick role + class and set availability, admins place/override/bench via `/signup add`; `/signup channel set #chan` designates where the website's Sign Ups page posts sheets — stored in git-ignored `bot/data/config.json` and pushed to the Worker; roles + caps in `config.js` `SIGNUP_ROLES`, states in `SIGNUP_STATUSES`. When `WORKER_URL` is set the bot also pushes live state to the Worker after every change and, on startup + every 60s, hydrates sheets the website posted while it was offline so their buttons work), `/profile` (self-serve family-name registration + class/gear-screenshot upload — class/gear-stat writes go straight to D1 via the Worker; only the screenshot *file* is still git-committed), `/addwar` (admin-only — upload war result screenshots, Claude vision extracts the table, Confirm/Cancel review, then writes the war directly into D1 via the Worker and recomputes+pushes attendance — no git commit for this data anymore), `/removewar` (admin-only — pick a war by date via autocomplete, Confirm/Cancel review, then deletes it from D1 via the Worker and recomputes+pushes attendance), `/balance` (Balanced War Builder — add guilds with a 1–10 skill seed via a modal, bot splits them into two skill-even teams with a re-rollable randomizer), `/roster sync` (admin-only — pulls the current member list off the **official Pearl Abyss guild page** via a headless browser (Playwright, needed since the page is JS-rendered and sits behind bot-protection), previews the +joining/−leaving diff, then on Confirm replaces the roster in D1 via the Worker — war history/stats are untouched, so ex-members who played wars still show up; `GUILD_PROFILE_URL` in `bot/src/config.js`). `bot/src/lib/data.js`/`profiles.js`/`attendance.js` are now thin HTTP clients for the Worker's D1 endpoints (same function signatures, now `async`) — **`WORKER_URL`/`BOT_PUSH_SECRET` are effectively required** for these core commands to work at all (they're still optional for the sign-up-board features only). Setup in `bot/README.md`. Runs on the user's PC (`npm start`). |

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

- `MATCHES`, `EXTENDED_STATS`, `ROSTER_MEMBERS` — live in Cloudflare D1 (`worker/schema.sql`'s `matches`/`extended_stats`/`roster_members` tables). Every page loads `window.GUILD_DATA` via `<script src="https://purge-signups.itzdjpsycho.workers.dev/data.js">` (a plain, static-looking script tag — NOT `document.write`, see below) and reads `const MATCHES = window.GUILD_DATA.matches;` etc. exactly as before. Both the site and the bot (`bot/src/lib/data.js`, now an async HTTP client) read/write the same D1 data via the Worker.
- **Not `document.write`:** the old cache-busting `document.write('<scr'+'ipt src="data.js?v='+Date.now()...')` trick is gone for these three files — Chrome's document.write cross-origin-script intervention silently blocks/aborts scripts injected that way, which broke `profiles.js`/`attendance.js` loading on several pages during the D1 migration. Plain `<script src="https://.../data.js">` tags don't have this problem and don't need cache-busting since the Worker sends `Cache-Control: no-cache`. (`assets/auth.js` still loads via `document.write` — that's same-origin, unaffected.)
- `localStorage["nodeWarDynamicMatches"]` — uploaded wars (client-side overlay on top of the D1-backed `MATCHES`, unaffected by the D1 migration)
- `localStorage["nodeWarDynamicExtended"]` — extended stats from uploads
- `profiles.js`'s data (`window.GUILD_PROFILES`) — canonical class + gear/crystals/addon screenshot paths per player, now in D1's `profiles` table, written via the Worker's `/profiles/:name` by the bot's `/profile` commands (see below) or directly by the website (officer edits, self-service flag toggles).
- `localStorage["nodeWarPlayerProfiles"]` — local/legacy class + gear screenshots per player (browser-side, pre-`profiles.js`)
- `localStorage["nodeWarSquadRoles"]` — role assignments (shared: war-scores.html + players.html)
- Export/Import JSON on roster page saves everything to `guild-data.json`

**Function order matters:** `applyDynamicMatches()` must run before `buildOverall()` and `applyMainballDefaults()`.

---

## Player Profiles (`/profile` Discord command → D1 via the Worker)

Players self-serve their own profile in Discord. Class + gear stats + screenshot *path* go straight to D1 via the Worker's `POST /profiles/:name` (bot-secret gated) — live immediately. The screenshot *file itself* still gets git-committed + pushed (still ~1–2 min for GitHub Pages to actually serve it), since images stay out of D1 — see the Hosting note.

**Slash commands** (`bot/src/commands/profile.js`):

| Subcommand | What it does |
|------------|--------------|
| `/profile register family:<name>` | Links the caller's Discord ID to a canonical family name (autocompletes from roster + anyone who's played a war). One name per user, one user per name. |
| `/profile class class:<class>` | Sets the player's BDO class (autocompletes from the 31 classes). |
| `/profile upload slot:<Gear\|Crystals\|Skill-Addons> image:<file>` | Downloads the attachment, saves it to `assets/profiles/<slug>-<slot>.<ext>`, records the path. Validates type (PNG/JPG/WebP) and ≤ 8 MB; deletes the prior file if the extension changed. **For the Gear slot**, also reads AP / Awakening AP / DP off the screenshot (Claude vision) and stores `ap`/`aap`/`dp` so the player's **Gear Score** appears on the roster — all in the same commit. |
| `/profile view [member]` | Embeds a player's class, linked Discord user, and which screenshots exist, with a link to `player.html?name=…`. |
| `/profile unlink` | Removes the caller's name↔Discord link (uploaded screenshots stay on the site). |

**Supporting libs** (`bot/src/lib/`):

- `profiles.js` (lib) — now an HTTP client for the Worker's D1-backed `/profiles.js` (read) and `/profiles/:name` (write), same function signatures as the old file-based version but `async`; `knownNames()` / `canonicalName()` resolve typed names against roster + war participants (also now `async`, since they read D1 via the Worker). `SLOT_KEYS` maps slot → `gearImg`/`crystalsImg`/`addonsImg`.
- `images.js` — downloads & saves attachments under `assets/profiles/`; `slug()`, type/size validation, stale-file cleanup. Returns the image `buffer` + `mediaType` so the gear reader can run without re-reading from disk. Unaffected by the D1 migration — screenshot files are still git-committed.
- `gear.js` — `readGearStats(base64, mediaType)` calls the Anthropic Messages API (`claude-sonnet-4-6`, vision) to OCR AP/AwkAP/DP — same prompt the website uses; `gearScore()` computes `round((ap+aap)/2 + dp)`. Needs `ANTHROPIC_API_KEY` in the bot's `.env` (**optional** — without it, gear images still upload, the Gear Score read is just skipped). This runs on the bot host — the key lives only in `bot/.env` (git-ignored), never in the site or the repo.
- `links.js` — private Discord-ID ↔ family-name map at `bot/data/links.json` (**git-ignored** — never published; `data/` is in `bot/.gitignore`). `renameLink()` is now driven by `link-sync.js` (below) instead of the old `merge-sync.js`.
- `link-sync.js` — `applyLinkRenameOps()`, polled every 10s: drains "renameLink" ops the Worker's `POST /merge` queues right after a website-initiated Roster "Merge Stats" (character rename) merges D1's war/profile data — the private link map only exists on the bot host, so this is the one piece of a merge the Worker can't do itself.
- `git.js` — `publish(paths, message)`: stages **only** the given paths (never `git add -A`), commits, pushes `HEAD:main`, and auto-rebases (`pull --rebase --autostash`) on a rejected push so concurrent pushes and unrelated working-tree files are left untouched. Since the D1 migration, only used for `assets/profiles/*` screenshot files — `data.js`/`profiles.js`/`attendance.js` are no longer written by the bot at all.

**Privacy rule:** profile data and `assets/profiles/` are public (D1 + committed screenshot files); Discord IDs live only in `bot/data/links.json` on the bot host and must never be committed.

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

1. **`/addwar` Discord command (admin-only).** Upload 1–5 war result screenshots → Claude vision (bot's `ANTHROPIC_API_KEY`) extracts date/day/location/result + every player's full stats → admin reviews a preview embed → **Confirm** writes the war directly into D1 via the Worker's `POST /matches` (bot-secret) and recomputes+pushes attendance — live immediately, no git commit. Lib: `bot/src/lib/war.js` (OCR, same prompt the site used) + `addWar()` in `bot/src/lib/data.js` (now a thin HTTP client). Replaces an existing war if the date matches.
2. **Paste war screenshots in chat → Claude** reads them, extracts all stats — ask it to call the Worker's `POST /matches` (or edit `data.js` if you're intentionally updating the legacy fallback snapshot).
3. **War Scores → + Add War → { } Manual JSON** — paste data directly, no API needed (still queues through the site's existing manual-entry flow).

*(Both the site and the bot pick up new/removed wars immediately — the bot reads D1 fresh via the Worker on every command, no restart needed for data changes. A bot **code** change, like this migration itself, does need a restart.)*

> The site's old **📸 Screenshot** mode (War Scores) ran on a Netlify serverless function that was **removed**; it now shows a fallback pointing to `/addwar` / Manual JSON. (Gear OCR, by contrast, *is* re-enabled in-page via the Worker's `POST /gear` — see the Hosting note.)

---

## Key Rules & Decisions

- **Desktop only** — no mobile layout, do not adjust for mobile
- War Scores page is `war-scores.html`, not `index.html` — `index.html` is the Home/landing page so the bare site URL lands there
- New players auto-assigned **Mainball** role until manually changed
- Screenshot extraction: kills from **score/flag icon column**, NOT fox/wolf icon
- Class icons (`assets/classes/<slug>.png`, looked up via `class-icons.js`) ARE used now — the old "plain mono text only" decision was reversed once real icon art was provided (see `players.html` roster cards, `player.html` class picker, `war-scores.html` Class column). War Scores' Class column always shows the player's **persistent `profiles.js` class** (self-set via `/profile class`), not something read off the war screenshot.
- **Tried and reverted:** per-war class + Succession/Awakening extraction via screenshot OCR (`class`/`classMode` on `extendedStats` rows). Accuracy was too unreliable even after fixes (allowing blank instead of a forced guess, attaching reference icon images to the vision request) — don't re-add without a materially better approach.
- **Nav on all pages:** Home · War Scores · Roster · My Stats · Dashboard · Sign Ups · Combat Log · VOD Review · Clips
- All pages share identical nav — keep in sync when adding pages
- **Sidebar nav is grouped into fixed categories** (2026-08 redesign): **Overview** (Home, Dashboard, My Stats), **Warfare** (War Scores, Combat Log, Sign Ups), **Media** (VOD Review, Clips), **Tools** (Roster, Tachyon Tracker). Each category header is a collapse/expand toggle — `assets/sidebar-nav.js` (included on every page right after `assets/auth.js`, no auth dependency) wires the chevrons and persists collapsed state per visitor in `localStorage["sidebarCollapsedCats"]`, same personal/browser-local pattern as Squad Roles and the Tachyon Tracker's found-state — **not** shared guild data. Nav panels use rounded corners (`border-radius`) rather than the angular clipped-corner notch — a deliberate departure from `--panel-clip` for the sidebar + `index.html` specifically; other pages' panels still use the notch and haven't been migrated. **The old Guild-Master drag-to-reorder feature (`assets/nav-order.js` / `PurgeNavOrder`) was removed** when categories were introduced — the category order above is fixed for everyone now, no per-officer customization. The Worker's `GET`/`POST /nav-order` endpoints (KV key `navOrder`) are no longer called by the site and are effectively dead code, left in place rather than pulled since removing them needs a separate `wrangler deploy` the site change doesn't require.
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
