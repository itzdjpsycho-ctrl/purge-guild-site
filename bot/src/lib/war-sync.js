import { removeWar } from "./data.js";
import { fetchWarOps, workerEnabled } from "./worker.js";
import { computeAttendance, writeAttendance } from "./attendance.js";
import { publish } from "./git.js";

/**
 * Apply pending website war-ops — currently just "removeWar", queued by the
 * War Scores page's "Remove This War" button (see worker/src/worker.js
 * POST /war-op). The Worker only queues these from an officer-tier session,
 * so no further auth check is needed here. Mirrors /removewar's confirm
 * handler exactly. Returns how many ops applied.
 */
export async function applyWarOps() {
  if (!workerEnabled()) return 0;
  let applied = 0;
  try {
    const ops = await fetchWarOps();
    if (!ops.length) return 0;
    const summary = [];
    for (const item of ops) {
      const op = item.op || item;
      if (op.type !== "removeWar" || !op.date) continue;
      const removed = removeWar(op.date);
      if (!removed.removed) continue;
      summary.push(`${removed.location || "war"} ${op.date}`);
      applied++;
    }
    if (applied) {
      writeAttendance(computeAttendance());
      const res = await publish(
        ["data.js", "attendance.js"],
        `Remove ${applied} war(s) via website: ${summary.join(", ")}`
      );
      if (!res.ok) console.error("war-op publish failed:", res.error);
      else console.log(`🗑️  Removed ${applied} war(s) via website: ${summary.join(", ")}`);
    }
  } catch (err) {
    console.error("applyWarOps failed:", err.message);
  }
  return applied;
}
