import { removeImage, canonicalName, setClass, setGear } from "./profiles.js";
import { deleteAsset } from "./images.js";
import { fetchProfileOps, workerEnabled } from "./worker.js";
import { publish } from "./git.js";
import { BDO_CLASSES } from "../config.js";

const VALID_FIELDS = new Set(["gearImg", "crystalsImg", "addonsImg"]);

/**
 * Apply pending website profile-ops: "removeShot" deletes a published
 * screenshot (+ its asset file); "setClass"/"setStats" publish class/gear
 * edits a signed-in player made on their own player.html. The Worker only
 * queues these from an admin session or the profile's own owner (see
 * worker/src/worker.js POST /profile-op), so no further auth check is needed
 * here. Returns how many ops applied.
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
      const name = canonicalName(op.player);
      if (!name) continue;

      if (op.type === "removeShot" && VALID_FIELDS.has(op.field)) {
        const prev = removeImage(name, op.field);
        if (prev == null) continue; // nothing was set
        if (deleteAsset(prev)) paths.add(prev);
        summary.push(`${name}/${op.field} removed`);
        applied++;
      } else if (op.type === "setClass" && BDO_CLASSES.includes(op.className)) {
        setClass(name, op.className);
        summary.push(`${name} class -> ${op.className}`);
        applied++;
      } else if (op.type === "setStats" && (op.ap != null || op.aap != null || op.dp != null)) {
        setGear(name, { ap: op.ap, aap: op.aap, dp: op.dp });
        summary.push(`${name} gear stats`);
        applied++;
      }
    }
    if (applied) {
      const res = await publish([...paths], `Apply ${applied} profile edit(s) via website: ${summary.join(", ")}`);
      if (!res.ok) console.error("profile-op publish failed:", res.error);
      else console.log(`✏️  Applied ${applied} profile edit(s): ${summary.join(", ")}`);
    }
  } catch (err) {
    console.error("applyProfileOps failed:", err.message);
  }
  return applied;
}
