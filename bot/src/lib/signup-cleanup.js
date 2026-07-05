import { listAll, markAutoDeleted } from "./signups.js";
import { parseWarStart } from "./wartime.js";

const HOURS_AFTER_START = 4;
// If the free-text time field can't be parsed, fall back to the end of the
// day so cleanup only ever runs LATE, never early on a war that hasn't
// happened yet.
const FALLBACK_HOUR = 23;
const FALLBACK_MINUTE = 59;

function warStartOrFallback(signup) {
  const start = parseWarStart(signup.date, signup.time);
  if (start) return start;
  if (!signup.date) return null;
  const d = new Date(`${signup.date}T${FALLBACK_HOUR}:${FALLBACK_MINUTE}:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Delete the Discord message for any sign-up sheet whose war started more
 * than HOURS_AFTER_START hours ago. The signups.json record is kept (never
 * deleted) so attendance history stays intact — only the live message goes.
 */
export async function sweepExpiredSignups(client) {
  const now = Date.now();
  for (const s of listAll()) {
    if (s.autoDeletedAt || !s.messageId || !s.channelId) continue;

    const start = warStartOrFallback(s);
    if (!start) continue;
    if (now - start.getTime() < HOURS_AFTER_START * 60 * 60 * 1000) continue;

    try {
      const channel = await client.channels.fetch(s.channelId);
      const message = await channel.messages.fetch(s.messageId);
      await message.delete();
    } catch (err) {
      // Already deleted / channel or message gone — fine, just stop retrying it.
      if (err.code !== 10008 && err.code !== 10003) {
        console.error(`Failed to auto-delete sign-up ${s.messageId}:`, err.message);
        continue;
      }
    }
    markAutoDeleted(s.messageId);
  }
}
