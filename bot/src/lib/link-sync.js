import { renameLink, allLinks } from "./links.js";
import { fetchMergeOps, pushLinks, workerEnabled } from "./worker.js";
import { fail } from "./console-ui.js";

/**
 * Apply pending "renameLink" ops — queued by the Worker's POST /merge
 * (website's Roster "Merge Stats" button) right after it merges a player's
 * war/profile data in D1. The private Discord-id<->family-name link
 * (bot/data/links.json) only exists on the bot host, so the Worker can't
 * update it itself; this small poller is all that's left of the old
 * merge-sync.js now that the D1 merge itself happens instantly in the
 * Worker. Ignores any other op type that might land on the same queue (e.g.
 * a stray legacy /merge-op enqueue). Returns how many renames applied.
 */
export async function applyLinkRenameOps() {
  if (!workerEnabled()) return 0;
  let applied = 0;
  try {
    const ops = await fetchMergeOps();
    if (!ops.length) return 0;
    let changed = false;
    for (const item of ops) {
      const op = item.op || item;
      if (op.type !== "renameLink" || !op.from || !op.to) continue;
      if (renameLink(op.from, op.to)) changed = true;
      applied++;
    }
    if (changed) await pushLinks(allLinks());
  } catch (err) {
    fail(`applyLinkRenameOps failed: ${err.message}`);
  }
  return applied;
}
