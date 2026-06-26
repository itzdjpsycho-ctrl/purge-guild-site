// Reads AP / Awakening AP / DP off a BDO gear screenshot via Claude vision.
// Mirror of bot/src/lib/gear.js (same PROMPT) so the website and bot read
// screenshots identically. The Anthropic key lives in the Worker secret
// ANTHROPIC_API_KEY — never in the static site.

const PROMPT = `From this Black Desert Online character/gear screenshot, read the three combat stats:
- "AP" (Attack Power — the non-awakening AP)
- "Awakening AP"
- "DP" (Defense Power)
They are usually shown together near the character, sometimes formatted like "269 / 287 / 401" meaning AP / Awakening AP / DP.
Respond with ONLY valid JSON — no markdown, no explanation — exactly:
{"ap":269,"aap":287,"dp":401}
Use whole numbers. If a value is genuinely not visible, use null for it.`;

const toInt = (v) => (v == null || isNaN(Number(v)) ? null : Math.round(Number(v)));

// Detect the real image type from the magic bytes, so a wrong/missing label
// (e.g. a PNG saved with a .webp name) can't trip Anthropic's type check.
function sniffMediaType(base64, fallback) {
  try {
    const bin = atob(base64.slice(0, 24));
    const c = (i) => bin.charCodeAt(i);
    if (c(0) === 0x89 && c(1) === 0x50 && c(2) === 0x4e && c(3) === 0x47) return "image/png";
    if (c(0) === 0xff && c(1) === 0xd8 && c(2) === 0xff) return "image/jpeg";
    if (c(0) === 0x47 && c(1) === 0x49 && c(2) === 0x46) return "image/gif";
    if (c(0) === 0x52 && c(1) === 0x49 && c(2) === 0x46 &&
        c(8) === 0x57 && c(9) === 0x45 && c(10) === 0x42 && c(11) === 0x50) return "image/webp";
  } catch {}
  return fallback || "image/png";
}

export async function readGearStats(base64, mediaType, apiKey, model) {
  if (!apiKey) return { ok: false, error: "no-key" };
  mediaType = sniffMediaType(base64, mediaType);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: model || "claude-sonnet-4-6",
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
