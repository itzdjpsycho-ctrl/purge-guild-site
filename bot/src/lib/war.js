import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, basename, extname } from "node:path";
import { PNG } from "pngjs";
import { ANTHROPIC_API_KEY, VISION_MODEL } from "../config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLASS_ICONS_DIR = join(__dirname, "..", "..", "..", "assets", "classes");

// Slug -> display name (mirrors the site's class-icons.js slug convention:
// lowercase, non a-z0-9 stripped). Only needed for the handful of multi-word
// classes — everything else is just its own slug capitalized.
const SLUG_TO_NAME = {
  darkknight: "Dark Knight",
};
function displayName(slug) {
  return SLUG_TO_NAME[slug] || slug[0].toUpperCase() + slug.slice(1);
}

// The source icons are white glyphs on a TRANSPARENT background. Sending
// them to the vision API as-is renders them flattened onto white by
// default — i.e. a white glyph on white, essentially invisible. Composite
// each one onto solid black first so the glyph is actually legible.
function flattenOnBlack(buffer) {
  const png = PNG.sync.read(buffer);
  const { data } = png;
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3] / 255;
    data[i] = Math.round(data[i] * alpha);       // R over black
    data[i + 1] = Math.round(data[i + 1] * alpha); // G over black
    data[i + 2] = Math.round(data[i + 2] * alpha); // B over black
    data[i + 3] = 255;                             // now fully opaque
  }
  // Write back the SAME png object (data was mutated in place) — constructing
  // a fresh `new PNG({width,height,data})` here silently drops the pixels.
  return PNG.sync.write(png);
}

// Reference icon images (class glyph, flattened onto black), loaded once and
// reused across calls — these get attached to every /addwar vision request
// so the model matches against the ACTUAL icon art instead of relying purely
// on trained memory of what each class looks like. Missing entirely if
// assets/classes/ doesn't exist yet — readWar() just skips the legend then.
let classIconCache = null;
function loadClassIcons() {
  if (classIconCache) return classIconCache;
  try {
    classIconCache = readdirSync(CLASS_ICONS_DIR)
      .filter((f) => f.toLowerCase().endsWith(".png"))
      .map((f) => ({
        name: displayName(basename(f, extname(f))),
        base64: flattenOnBlack(readFileSync(join(CLASS_ICONS_DIR, f))).toString("base64"),
      }));
  } catch {
    classIconCache = [];
  }
  return classIconCache;
}

// Same extraction prompt the website used (war-scores.html) so the bot and site read
// war result screens identically.
const PROMPT = `You are extracting Node War result data from screenshots of Black Desert Online.

Look at the screenshot(s) carefully and extract ALL of the following:

1. DATE — shown in top-left like "26-6-19" = 2026-06-19 (year is always 2026, format as YYYY-MM-DD)
2. DAY — the day name shown e.g. "Monday", "Tuesday" etc.
3. LOCATION — the node name shown in the centre top e.g. "Calpheon", "Ulukita", "Serendia"
4. RESULT — either "Victory" or "Defeat" (Occupation Success = Victory, Occupation Failed = Defeat)
5. PLAYERS — every row in the table. The columns are always:
   Family Name, Class icon, Kills, Deaths, Streaks, Damage Done, Damage Taken, CC's, HP Healed, Ally HP Healed, Fort Damage, Cannons Landed, Objects Destroyed, Cannon Distance, Traps Triggered, Time Dead, Time Alive
   - Numbers like "1.3M" = 1300000, "471.9K" = 471900, "62672" = 62672
   - Times like "04:35" = 275 seconds, "34:33" = 2073 seconds (MM:SS to total seconds)
   - Extract ALL players visible across all screenshots provided
6. CLASS — each row has a small class glyph icon right after the Family Name. Reference images
   for every known class are attached AFTER the screenshot(s), each preceded by a text label
   naming the class — compare each row's glyph pixel-shape against those reference icons rather
   than relying on memory, and pick the one that matches. If no reference icon is a confident
   match (blurry, cut off, ambiguous, or genuinely doesn't resemble any of them), output ""
   for that player's class rather than guessing — a wrong guess is worse than a blank.
7. CLASS MODE — right next to the class glyph is a second small icon colored either BLUE
   (Succession — output "S") or RED (Awakening — output "A"). If you can't tell the color
   clearly, output "" for that player rather than guessing.

Respond with ONLY valid JSON — no markdown fences, no explanation — in exactly this format:
{
  "date": "2026-06-19",
  "day": "Friday",
  "location": "Ulukita",
  "result": "Victory",
  "type": "extended",
  "players": [
    {"name":"PlayerName","class":"Warrior","classMode":"S","kills":17,"deaths":12,"streak":3,"dmgDone":471900,"dmgTaken":434700,"cc":60,"hpHealed":255500,"allyHpHealed":32633,"fortDmg":282500,"cannonsLanded":0,"objDestroyed":0,"cannonDist":0,"traps":0,"timeDead":275,"timeAlive":2073}
  ]
}

Always set "type" to "extended". Every player must include all stat fields — use 0 if a value is genuinely zero in the screenshot. If the class glyph or mode icon isn't a confident match, use "" for that field — do not guess.`;

/**
 * Extract a war result from one or more screenshots via Claude vision.
 * @param {Array<{base64:string, mediaType:string}>} images
 * @returns {Promise<{ok:true, war:object} | {ok:false, error:string}>}
 *          error === "no-key" means no ANTHROPIC_API_KEY is configured.
 */
export async function readWar(images) {
  if (!ANTHROPIC_API_KEY) return { ok: false, error: "no-key" };
  if (!images.length) return { ok: false, error: "No images provided." };
  try {
    const content = images.map((img) => ({
      type: "image",
      source: { type: "base64", media_type: img.mediaType, data: img.base64 },
    }));

    const icons = loadClassIcons();
    if (icons.length) {
      content.push({
        type: "text",
        text: `Reference class icons follow (${icons.length} classes) — each labeled by name right before its icon:`,
      });
      for (const icon of icons) {
        content.push({ type: "text", text: `Class icon for: ${icon.name}` });
        content.push({ type: "image", source: { type: "base64", media_type: "image/png", data: icon.base64 } });
      }
    }

    content.push({ type: "text", text: PROMPT });

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: VISION_MODEL,
        max_tokens: 8000,
        messages: [{ role: "user", content }],
      }),
    });

    const data = await res.json();
    if (!res.ok || data.error) {
      throw new Error(data.error?.message || data.error || `HTTP ${res.status}`);
    }

    const raw = (data.content || []).map((c) => c.text || "").join("");
    const jm = raw.match(/\{[\s\S]*\}/);
    if (!jm) throw new Error("No JSON found in the response.");
    const war = JSON.parse(jm[0]);

    if (!war.date || !/^\d{4}-\d{2}-\d{2}$/.test(war.date)) {
      throw new Error("Couldn't read a valid date (YYYY-MM-DD) from the screenshot.");
    }
    if (!Array.isArray(war.players) || !war.players.length) {
      throw new Error("Couldn't read any player rows from the screenshot.");
    }
    war.result = war.result === "Victory" ? "Victory" : "Defeat";

    return { ok: true, war };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
