# Purge Guild Discord Bot

Discord bot for the **Purge** BDO Node War guild. Three features:

| Command | Who | What |
|---------|-----|------|
| `/mvp [date]` | everyone | Posts the **MVP** of a war — one overall winner from a weighted, per-war-normalized score. Defaults to the most recent war. |
| `/stats <player> [date]` | everyone | Full **extended stats** for a player. No date = career summary; with a date = that war's 16-column breakdown. |
| `/signup …` | admins post · everyone signs | Posts an **editable Node War sign-up sheet** with role columns (Frontliner, Ranged, Skirmisher, Caster, Shai, Trooper, Defense, Flex, Scout, Elephant, Shotcaller — each with a capacity), numbered slots, class picker, and Tentative/Absence lists. Members self-pick a role + class and set availability; admins can place/override/bench. |
| `/balance` | everyone | **Balanced War Builder.** Opens a panel: tap **➕ Add Guilds** to paste guilds one per line as `Name seed` (seed **1 = strongest … 10 = weakest**), then **🎲 Balance Teams** to split them into two skill-even sides. Re-roll for a different equally-balanced split. |

Both data commands read the shared **`../data.json`** at the repo root — the same source the website uses, so the bot is always in sync.

---

## One-time setup

### 1. Create the Discord application + bot
1. Go to <https://discord.com/developers/applications> → **New Application**.
2. **Bot** tab → **Reset Token** → copy the token (this is your `DISCORD_TOKEN`).
3. **General Information** → copy **Application ID** (this is your `CLIENT_ID`).
4. **Installation** (or **OAuth2 → URL Generator**): scopes `bot` + `applications.commands`,
   bot permissions: **Send Messages**, **Embed Links**, **Use Slash Commands**. Open the
   generated URL and invite the bot to your server.

### 2. Get your server + role IDs
In Discord, **User Settings → Advanced → Developer Mode = ON**, then:
- Right-click your **server** → *Copy Server ID* → `GUILD_ID`.
- Right-click any **admin role** → *Copy Role ID* → add to `ADMIN_ROLE_IDS` (comma-separated).
  Leave blank to instead allow anyone with the **Manage Server** permission.

### 3. Configure env
```powershell
cd bot
copy .env.example .env
notepad .env      # paste your token / IDs
```

### 4. Install + register commands
```powershell
npm install
npm run deploy    # registers /mvp, /stats, /signup to your server (instant)
```

### 5. Run the bot
```powershell
npm start
```
You should see `✅ Logged in as <bot>#0000`. Leave this window open — the bot is online only
while this is running (you chose to host on your own PC).

---

## Usage notes

**MVP scoring** — each stat (kills, K/D, damage, CC, fort damage, healing, objects, cannons,
minus a deaths penalty) is normalized to the war's max, then weighted. Tune the weights in
[`src/config.js`](src/config.js) → `MVP_WEIGHTS`. A war with no extended stats can't be scored.

**Sign-up sheet** — `/signup create date:2026-06-26 time:"11:00 AM" location:Niella notes:"FFA at xx:45"`
posts the sheet. The embed shows each **role group** as a column with its `filled/cap` count and
numbered members (late tagged ⏰, benched names struck through), plus **Needs a role / Tentative /
Absence** lists. Members use the components to:
- **Pick your role** dropdown — joins that role column if it isn't full.
- **Select your class** dropdown — 31 BDO classes, split across two menus (alphabetical).
- **In-game / Bench / Late / Tentative / Absence** buttons — set availability.
- **Withdraw** — remove yourself.

Admin edits all target the *latest open* sign-up (capacity is **not** enforced for admins, so you
can override / slot people in):
- `/signup add member:@X role:Frontliner status:in class:Warrior` — place / move / bench / set class
- `/signup remove member:@X`
- `/signup edit date:… time:… location:… notes:…`
- `/signup close` / `/signup reopen`

Role groups and their capacities live in [`src/config.js`](src/config.js) → `SIGNUP_ROLES`;
availability states in `SIGNUP_STATUSES`. Sign-up state is saved to `data/signups.json`
(git-ignored), so it survives bot restarts.

**Balanced War Builder** — `/balance` posts a panel. **➕ Add Guilds** opens a box; type one guild
per line as `Name seed` (e.g. `Purge 1`), seed **1 = strongest … 10 = weakest** (you can run it
again to add more or correct a seed). **🎲 Balance Teams** splits everyone into two teams whose
total skill is as even as possible — the skill gap shows in the footer, and **🎲** again re-rolls
for another equally-balanced split. Builder sessions live in memory only, so re-run `/balance` if
the bot restarts.

## Adding new wars
Add the war to the root **`data.json`** (`matches` + `extendedStats`). The bot reads the file
fresh on every command, so new wars appear immediately — no restart needed.
