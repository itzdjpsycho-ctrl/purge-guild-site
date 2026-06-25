import { writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Website assets live at the repo root. bot/src/lib -> ../../../assets/profiles
export const ASSETS_DIR = join(__dirname, "..", "..", "..", "assets", "profiles");

const ALLOWED = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB

/** Filesystem-safe slug from a family name. */
export function slug(name) {
  return name.toLowerCase().replace(/[^a-z0-9_-]/g, "");
}

/**
 * Download a Discord attachment for a player's slot and save it under
 * assets/profiles/. Returns { ok, relativePath?, absPath?, error? }.
 *
 * `prevRelative` (optional) is the previously stored path; if it points to a
 * different file, it's deleted so we don't leave orphans.
 */
export async function saveAttachment(attachment, name, slot, prevRelative) {
  const mediaType = attachment.contentType?.split(";")[0];
  const ext = ALLOWED[mediaType];
  if (!ext) {
    return { ok: false, error: "That file isn't a PNG, JPG, or WebP image." };
  }
  if (attachment.size > MAX_BYTES) {
    return { ok: false, error: "Image is larger than 8 MB — please resize and retry." };
  }

  let buffer;
  try {
    const res = await fetch(attachment.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    buffer = Buffer.from(await res.arrayBuffer());
  } catch (e) {
    return { ok: false, error: `Couldn't download the image (${e.message}).` };
  }

  if (!existsSync(ASSETS_DIR)) mkdirSync(ASSETS_DIR, { recursive: true });

  const fileName = `${slug(name)}-${slot}.${ext}`;
  const absPath = join(ASSETS_DIR, fileName);
  writeFileSync(absPath, buffer);

  // Remove a stale file from a previous upload with a different extension.
  const relativePath = `assets/profiles/${fileName}`;
  if (prevRelative && prevRelative !== relativePath) {
    const stale = join(ASSETS_DIR, "..", "..", prevRelative);
    try {
      if (existsSync(stale)) rmSync(stale);
    } catch {
      /* non-fatal */
    }
  }

  return { ok: true, relativePath, absPath, fileName, buffer, mediaType };
}
