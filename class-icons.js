/* ============================================================================
   class-icons.js — shared BDO class icon lookup for the Purge guild site.

   Icons live at assets/classes/<slug>.png (white glyph, transparent bg) —
   slug matches the bot's slug() convention: lowercase, non a-z0-9 stripped
   (e.g. "Dark Knight" -> "darkknight.png"). Not every one of the 31 classes
   necessarily has an icon file yet; callers should treat a miss as "no icon"
   and fall back to text, not an error.
   ========================================================================== */
(function (global) {
  "use strict";

  function slug(className) {
    return String(className || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function path(className) {
    if (!className) return null;
    return "assets/classes/" + slug(className) + ".png";
  }

  // <img> markup for a class icon, or "" if no class given. `has` is an
  // optional Set/array of known-available slugs — when provided, unknown
  // classes render no icon instead of a broken <img>.
  function img(className, opts) {
    opts = opts || {};
    if (!className) return "";
    var s = slug(className);
    if (opts.has && !(opts.has.has ? opts.has.has(s) : opts.has.indexOf(s) !== -1)) return "";
    var size = opts.size || 16;
    var cls = opts.className ? (" " + opts.className) : "";
    return '<img src="assets/classes/' + s + '.png" alt="" class="class-icon' + cls + '" ' +
      'width="' + size + '" height="' + size + '" loading="lazy" onerror="this.remove()">';
  }

  global.ClassIcons = { slug: slug, path: path, img: img };
})(window);
