import { removeImage, canonicalName } from "./profiles.js";
import { deleteAsset } from "./images.js";
import { fetchProfileOps, workerEnabled } from "./worker.js";
import { publish } from "./git.js";

const VALID_FIELDS = new Set(["gearImg", "crystalsImg", "addonsImg"]);

/**
 * Apply pending website profile-ops. Currently just "removeShot": delete a
 * published screenshot from profiles.js AND its asset file, then push — so a
 * Remove on the website is gone for the whole guild. Returns how many applied.
 */
export async function applyProfileOps() {
  if (!workerEnabled()) return 0;
  let applied = 0;
  try {
    const ops = await fetchProfileOps();
    if (!ops.length) return 0;
    const paths = new Set(["profiles.js"]);
    const summary = [];
    for (const item of ops) {
      const op = item.op || item;
      if (op.type !== "removeShot" || !VALID_FIELDS.has(op.field)) continue;
      const name = canonicalName(op.player);
      if (!name) continue;
      const prev = removeImage(name, op.field);
      if (prev == null) continue; // nothing was set
      if (deleteAsset(prev)) paths.add(prev);
      summary.push(`${name}/${op.field}`);
      applied++;
    }
    if (applied) {
      const res = await publish([...paths], `Remove ${applied} screenshot(s) via website: ${summary.join(", ")}`);
      if (!res.ok) console.error("profile-op publish failed:", res.error);
      else console.log(`🗑️  Removed ${applied} published screenshot(s): ${summary.join(", ")}`);
    }
  } catch (err) {
    console.error("applyProfileOps failed:", err.message);
  }
  return applied;
}
