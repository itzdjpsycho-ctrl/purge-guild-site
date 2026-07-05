/* ============================================================================
   flags.js — shared performance-flag logic for the Purge guild site.

   Pure, data-in / flags-out. No DOM, no localStorage access here — each page
   passes in its own matches array plus the shared roles/profiles maps it has
   already loaded. Included via <script src="flags.js"></script> BEFORE the
   inline page script on dashboard.html, player.html and players.html.

   A "match" is { date, result, players:[ [name, kills, deaths], ... ] } — the
   same MATCHES shape every page already uses.

   Flag logic is ROLE-AWARE RELATIVE: standouts/underperformers are judged
   against the rest of that war (fair across blowouts), and support roles are
   exempt from the negative "watch" flag (they naturally post low kills).

   NOTE: there is no backend, so the ⚠ Watch flag is visible to the whole guild
   — wording is kept neutral and the thresholds below are deliberately strict.
   ========================================================================== */
(function (global) {
  "use strict";

  /* ---- Tunable thresholds (adjust here, logic stays untouched) ---- */
  var FLAG_CFG = {
    MVP_MIN_KD: 2.0, MVP_MIN_KILLS: 5,        // ⭐ top K/D of the war + a real sample
    WATCH_MAX_KD: 0.6, WATCH_MIN_DEATHS: 8,   // ⚠ only if genuinely low + enough deaths
    ONFIRE_KD: 2.0, ONFIRE_WARS: 2            // 🔥 N most-recent consecutive wars >= this K/D
  };
  // Roles / classes exempt from the ⚠ Watch flag (naturally low kills):
  var SUPPORT_ROLES   = ["defensive"];
  var SUPPORT_CLASSES = ["Shai"];

  /* ---- Display metadata for each flag type ---- */
  var FLAG_META = {
    mvp:    { icon: "⭐", label: "MVP",     cls: "flag-mvp" },
    onfire: { icon: "🔥", label: "On Fire", cls: "flag-onfire" },
    watch:  { icon: "⚠",  label: "Watch",   cls: "flag-watch" }
  };

  function kd(k, d) { return (k === 0 && d === 0) ? null : d === 0 ? k : k / d; }

  function isSupport(name, roles, profiles) {
    var role = (roles && roles[name]) || "";
    var cls  = (profiles && profiles[name] && profiles[name].class) || "";
    return SUPPORT_ROLES.indexOf(role) !== -1 || SUPPORT_CLASSES.indexOf(cls) !== -1;
  }

  // A player with the "Exception" toggle on (see players.html) is exempt from
  // the ⚠ Watch flag — e.g. someone known to be playing a sacrificial role or
  // going through something, who shouldn't get auto-flagged for low stats.
  function hasException(name, profiles) {
    return !!(profiles && profiles[name] && profiles[name].exception);
  }

  function appearancesOf(name, matches) {
    return (matches || [])
      .filter(function (m) {
        return m && m.players && m.players.some(function (p) { return p[0] === name; });
      })
      .slice()
      .sort(function (a, b) { return a.date.localeCompare(b.date); });
  }

  /* ---- Per-war flags → { name: "mvp" | "watch" } (only flagged names appear) ---- */
  function computeWarFlags(match, roles, profiles) {
    var out = {};
    if (!match || !match.players || !match.players.length) return out;

    // Build rows; 0K/0D players carry no signal, so drop them.
    var rows = match.players.map(function (p) {
      return { name: p[0], kills: p[1], deaths: p[2], kd: kd(p[1], p[2]) };
    }).filter(function (r) { return r.kd !== null; });
    if (!rows.length) return out;

    // ⭐ MVP — single highest K/D of the war, gated by minimums.
    var byKdDesc = rows.slice().sort(function (a, b) { return b.kd - a.kd; });
    var top = byKdDesc[0];
    if (top && top.kd >= FLAG_CFG.MVP_MIN_KD && top.kills >= FLAG_CFG.MVP_MIN_KILLS) {
      out[top.name] = "mvp";
    }

    // ⚠ Watch — bottom quartile by K/D, genuinely low, enough deaths, non-support.
    var byKdAsc = rows.slice().sort(function (a, b) { return a.kd - b.kd; });
    var cutoff = Math.max(1, Math.ceil(byKdAsc.length * 0.25));
    byKdAsc.slice(0, cutoff).forEach(function (r) {
      if (out[r.name]) return; // already crowned MVP — guard
      if (r.kd < FLAG_CFG.WATCH_MAX_KD &&
          r.deaths >= FLAG_CFG.WATCH_MIN_DEATHS &&
          !isSupport(r.name, roles, profiles) &&
          !hasException(r.name, profiles)) {
        out[r.name] = "watch";
      }
    });

    return out;
  }

  /* ---- 🔥 On Fire — most recent ONFIRE_WARS appearances all >= ONFIRE_KD ---- */
  function computeOnFire(name, matches) {
    var apps = appearancesOf(name, matches);
    if (apps.length < FLAG_CFG.ONFIRE_WARS) return false;
    return apps.slice(-FLAG_CFG.ONFIRE_WARS).every(function (m) {
      var p = m.players.find(function (x) { return x[0] === name; });
      var v = kd(p[1], p[2]);
      return v !== null && v >= FLAG_CFG.ONFIRE_KD;
    });
  }

  /* ---- Dominant flag for a player: On Fire > MVP(latest war) > Watch(latest war) ---- */
  function currentFlag(name, matches, roles, profiles) {
    if (computeOnFire(name, matches)) return "onfire";
    var apps = appearancesOf(name, matches);
    if (!apps.length) return null;
    var latest = apps[apps.length - 1];
    return computeWarFlags(latest, roles, profiles)[name] || null;
  }

  global.GuildFlags = {
    CFG: FLAG_CFG,
    META: FLAG_META,
    kd: kd,
    computeWarFlags: computeWarFlags,
    computeOnFire: computeOnFire,
    currentFlag: currentFlag
  };
})(window);
