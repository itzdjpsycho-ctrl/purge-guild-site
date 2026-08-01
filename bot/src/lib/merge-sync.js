import { mergeNames } from "./data.js";
import { mergeProfiles, canonicalName } from "./profiles.js";
import { deleteAsset } from "./images.js";
import { renameLink } from "./links.js";
import { allLinks } from "./links.js";
import { fetchMergeOps, pushLinks, workerEnabled } from "./worker.js";
import { computeAttendance, writeAttendance } from "./attendance.js";
import { publish } from "./git.js";

/**
 * Apply pending website merge-ops — "mergeNames", queued by the Roster
 * page's "Merge Stats" button (see worker/src/worker.js POST /merge-op).
 * The Worker only queues these from an officer-tier session, so no further
 * auth check is needed here. Combines two names' entire history (data.js,
 * profiles.js, the private Discord link) into one, then re-derives
 * attendance.js and publishes. Returns how many ops applied.
 */
export async function applyMergeOps() {
  if (!workerEnabled()) return 0;
  let applied = 0;
  try {
    const ops = await fetchMergeOps();
    if (!ops.length) return 0;

    const paths = new Set(["data.js", "profiles.js"]);
    const summary = [];
    let linksChanged = false;

    for (const item of ops) {
      const op = item.op || item;
      if (op.type !== "mergeNames" || !op.from || !op.to) continue;

      const from = canonicalName(op.from);
      if (!from) continue; // unknown "from" name — nothing to merge
      const to = canonicalName(op.to) || String(op.to).trim();
      if (!to || from.toLowerCase() === to.toLowerCase()) continue;

      const { warsChanged } = mergeNames(from, to);
      const { orphanedAssets } = mergeProfiles(from, to);
      orphanedAssets.forEach((p) => { if (deleteAsset(p)) paths.add(p); });
      if (renameLink(from, to)) linksChanged = true;

      summary.push(`${from} -> ${to} (${warsChanged} war${warsChanged !== 1 ? "s" : ""})`);
      applied++;
    }

    if (applied) {
      writeAttendance(computeAttendance());
      paths.add("attendance.js");
      const res = await publish([...paths], `Merge ${applied} player name(s) via website: ${summary.join(", ")}`);
      if (!res.ok) console.error("merge-op publish failed:", res.error);
      else console.log(`🔀 Merged ${applied} player name(s): ${summary.join(", ")}`);
      if (linksChanged) pushLinks(allLinks()).catch(() => {});
    }
  } catch (err) {
    console.error("applyMergeOps failed:", err.message);
  }
  return applied;
}
