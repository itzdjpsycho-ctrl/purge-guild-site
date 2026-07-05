// Shared date/time parsing for sign-up sheets. `date`/`time` are free-text
// fields entered via /signup create|edit (e.g. "2026-06-26", "8:00 PM"), with
// no format enforced at entry — this is the one place that turns them into a
// real Date, used both to render Discord's <t:...> auto-localizing timestamp
// (embeds.js) and to time the post-war sign-up cleanup (signup-cleanup.js).

/** Best-effort parse of a free-text time string into { hour, minute } (24h), or null. */
function parseTime(time) {
  if (!time) return null;
  const m = String(time).match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!m) return null;

  let hour = parseInt(m[1], 10);
  const minute = m[2] ? parseInt(m[2], 10) : 0;
  const ampm = m[3]?.toLowerCase();
  if (hour > 23 || minute > 59) return null;

  if (ampm === "pm" && hour < 12) hour += 12;
  if (ampm === "am" && hour === 12) hour = 0;

  return { hour, minute };
}

/** War start as a Date, or null if `date` is missing or `time` can't be parsed. */
export function parseWarStart(date, time) {
  if (!date) return null;
  const t = parseTime(time);
  if (!t) return null;

  const hh = String(t.hour).padStart(2, "0");
  const mm = String(t.minute).padStart(2, "0");
  const d = new Date(`${date}T${hh}:${mm}:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}
