import { ANTHROPIC_API_KEY, VISION_MODEL } from "../config.js";

// Same extraction prompt the website used (war-scores.html) so the bot and site read
// war result screens identically.
const PROMPT = `You are extracting Node War result data from screenshots of Black Desert Online.

Look at the screenshot(s) carefully and extract ALL of the following:

1. DATE — shown in top-left like "26-6-19" = 2026-06-19 (year is always 2026, format as YYYY-MM-DD)
2. DAY — the day name shown e.g. "Monday", "Tuesday" etc.
3. LOCATION — the node name shown in the centre top e.g. "Calpheon", "Ulukita", "Serendia"
4. RESULT — either "Victory" or "Defeat" (Occupation Success = Victory, Occupation Failed = Defeat)
5. PLAYERS — every row in the table. The columns are always:
   Family Name, Kills, Deaths, Streaks, Damage Done, Damage Taken, CC's, HP Healed, Ally HP Healed, Fort Damage, Cannons Landed, Objects Destroyed, Cannon Distance, Traps Triggered, Time Dead, Time Alive
   - Numbers like "1.3M" = 1300000, "471.9K" = 471900, "62672" = 62672
   - Times like "04:35" = 275 seconds, "34:33" = 2073 seconds (MM:SS to total seconds)
   - Extract ALL players visible across all screenshots provided

Respond with ONLY valid JSON — no markdown fences, no explanation — in exactly this format:
{
  "date": "2026-06-19",
  "day": "Friday",
  "location": "Ulukita",
  "result": "Victory",
  "type": "extended",
  "players": [
    {"name":"PlayerName","kills":17,"deaths":12,"streak":3,"dmgDone":471900,"dmgTaken":434700,"cc":60,"hpHealed":255500,"allyHpHealed":32633,"fortDmg":282500,"cannonsLanded":0,"objDestroyed":0,"cannonDist":0,"traps":0,"timeDead":275,"timeAlive":2073}
  ]
}

Always set "type" to "extended". Every player must include all stat fields — use 0 if a value is genuinely zero in the screenshot.`;

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
