import { ANTHROPIC_API_KEY, GEAR_MODEL } from "../config.js";

// Same prompt the website uses (player.html) so the bot and site read screenshots
// identically.
const PROMPT = `From this Black Desert Online character/gear screenshot, read the three combat stats:
- "AP" (Attack Power — the non-awakening AP)
- "Awakening AP"
- "DP" (Defense Power)
They are usually shown together near the character, sometimes formatted like "269 / 287 / 401" meaning AP / Awakening AP / DP.
Respond with ONLY valid JSON — no markdown, no explanation — exactly:
{"ap":269,"aap":287,"dp":401}
Use whole numbers. If a value is genuinely not visible, use null for it.`;

const toInt = (v) => (v == null || isNaN(Number(v)) ? null : Math.round(Number(v)));

/**
 * Read AP / Awakening AP / DP from a gear screenshot using Claude vision.
 * @param {string} base64 - raw base64 image data (no data: prefix)
 * @param {string} mediaType - e.g. "image/png"
 * @returns {Promise<{ok:true, ap:?number, aap:?number, dp:?number} | {ok:false, error:string}>}
 *          error === "no-key" means no ANTHROPIC_API_KEY is configured.
 */
export async function readGearStats(base64, mediaType) {
  if (!ANTHROPIC_API_KEY) return { ok: false, error: "no-key" };
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: GEAR_MODEL,
        max_tokens: 300,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
              { type: "text", text: PROMPT },
            ],
          },
        ],
      }),
    });

    const data = await res.json();
    if (!res.ok || data.error) {
      throw new Error(data.error?.message || data.error || `HTTP ${res.status}`);
    }

    const raw = (data.content || []).map((c) => c.text || "").join("");
    const jm = raw.match(/\{[\s\S]*\}/);
    if (!jm) throw new Error("No data found in the response.");
    const parsed = JSON.parse(jm[0]);

    return { ok: true, ap: toInt(parsed.ap), aap: toInt(parsed.aap), dp: toInt(parsed.dp) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** Gear Score from the three stats — only when all three are present (matches the site). */
export function gearScore({ ap, aap, dp } = {}) {
  if (ap == null || aap == null || dp == null) return null;
  return Math.round((Number(ap) + Number(aap)) / 2 + Number(dp));
}
