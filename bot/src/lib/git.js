import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const exec = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
// Repo root: bot/src/lib -> ../../..
export const REPO_ROOT = join(__dirname, "..", "..", "..");

async function git(args) {
  return exec("git", args, { cwd: REPO_ROOT, windowsHide: true });
}

/**
 * Stage ONLY the given paths (relative to repo root), commit, and push.
 * Deliberately scoped — never `git add -A` — so unrelated uncommitted work is
 * left untouched. Returns { ok, pushed, message, error }.
 */
export async function publish(paths, message) {
  try {
    await git(["add", "--", ...paths]);

    // Anything actually staged? (avoids empty commits on no-op re-uploads)
    const { stdout: staged } = await git(["diff", "--cached", "--name-only"]);
    if (!staged.trim()) {
      return { ok: true, pushed: false, message: "No changes to publish." };
    }

    await git(["commit", "-m", message]);

    try {
      await git(["push", "origin", "HEAD:main"]);
    } catch (first) {
      // Most likely the remote moved ahead (a concurrent push). Rebase our
      // commit on top of the latest origin/main — --autostash keeps any other
      // uncommitted working-tree files (e.g. bot code) out of the way — then
      // push again.
      try {
        await git(["pull", "--rebase", "--autostash", "origin", "main"]);
        await git(["push", "origin", "HEAD:main"]);
      } catch (second) {
        return {
          ok: true,
          pushed: false,
          error: `Committed locally but push failed (even after rebase): ${
            second.stderr || second.message
          }`,
        };
      }
    }

    return { ok: true, pushed: true, message: "Published to the live site." };
  } catch (e) {
    return { ok: false, pushed: false, error: e.stderr || e.message };
  }
}
