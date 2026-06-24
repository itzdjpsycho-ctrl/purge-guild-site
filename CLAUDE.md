# Purge Guild Website — CLAUDE.md

## Project Overview

Dark-themed static HTML guild management site for a Black Desert Online (BDO) Node War guild called **Purge**. No backend, no build tools — pure HTML/CSS/JS. Auto-deploys to Netlify on every git push.

- **Live site:** https://cheery-puppy-6057d8.netlify.app
- **GitHub:** https://github.com/itzdjpsycho-ctrl/purge-guild-site
- **Local folder:** D:\Website Building

---

## Files

| File | Purpose |
|------|---------|
| `home.html` | Landing page. Crimson dark theme, logo placeholder, live stats strip, quick-link cards, most recent war panel. |
| `index.html` | **War Scores page (main page).** Match tabs grouped by week (collapsible). Squad Roles panel with drag-and-drop (Mainball / Shotcaller / Defensive / Flex Squad). + Add War button with screenshot upload → Claude API extraction (up to 4 screenshots). Player name search. Class column. "Clear Added Wars" double-tap button inside the match panel. |
| `players.html` | Roster page. Grid of 76 player cards. Export/Import JSON. |
| `player.html` | Individual player profile (`player.html?name=Popspolar`). Class dropdown (34 BDO classes), 3 screenshot slots (Gear / Crystals / Skill-Addons), war history table. |
| `dashboard.html` | Guild stats. Win rate ring, streak badge, node location breakdown, top 10 performers (K/D / Kills / Deaths tabs), per-player trend charts (line + bar, pure canvas). |
| `push.bat` | Double-click to commit and push to GitHub. |

---

## Theme — Purge Crimson Dark (all pages)

```
Background:    #080608 with crimson radial glow atmosphere
Panels:        #120D0F / #1A1215
Hairlines:     #2E1F22 / #1E1517
UI accent:     crimson #8B1A1A / #B32020 / #D63030
Data colours:  gold #C49A30 / #E8BC55 (K/D, victories)
               green #5BC976 (kills)
               red #D65A45 (deaths/defeats)
Fonts:         Fraunces (display), IBM Plex Mono (mono), Inter (UI)
Nav active:    crimson (not gold)
```

---

## Data Architecture

- `MATCHES` array — hardcoded in every file, must stay in sync across all pages
- `ROSTER_MEMBERS` array — 52 members not yet in a war, also in every file
- `localStorage["nodeWarDynamicMatches"]` — uploaded wars
- `localStorage["nodeWarDynamicExtended"]` — extended stats from uploads
- `localStorage["nodeWarPlayerProfiles"]` — class + gear screenshots per player
- `localStorage["nodeWarSquadRoles"]` — role assignments
- Export/Import JSON on roster page saves everything to `guild-data.json`

**Function order matters:** `applyDynamicMatches()` must run before `buildOverall()` and `applyMainballDefaults()`.

---

## Current Hardcoded MATCHES (1 war)

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
}
```

76 total members = 24 from match data + 52 `ROSTER_MEMBERS`.

---

## Key Rules & Decisions

- **Desktop only** — no mobile layout, do not adjust for mobile
- War Scores page is `index.html`, not `war-scores.html`
- New players auto-assigned **Mainball** role until manually changed
- Screenshot extraction: kills from **score/flag icon column**, NOT fox/wolf icon
- Class icons rejected — plain mono text used instead
- **Nav on all pages:** Home · War Scores · Roster · Dashboard (Guild & Community removed)
- All 5 pages share identical nav — keep in sync when adding pages

---

## BDO Classes (31)

Warrior, Ranger, Sorceress, Berserker, Tamer, Musa, Maehwa, Valkyrie, Kunoichi, Ninja, Wizard, Witch, Dark Knight, Striker, Mystic, Lahn, Archer, Shai, Guardian, Nova, Sage, Corsair, Hashashin, Drakania, Woosa, Maegu, Scholar, Dosa, Deadeye, Wukong, Seraph

---

## Git Workflow (PowerShell — no && chaining)

```powershell
git add .
git commit -m "your message"
git push
```

Or double-click `push.bat`.
