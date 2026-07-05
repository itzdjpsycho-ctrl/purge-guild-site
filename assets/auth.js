// Shared "Sign in with Discord" nav widget — one copy included on every page
// via <script src="assets/auth.js"></script> plus a <div id="authWidget"></div>
// in the sidebar. Talks to the Cloudflare Worker's /auth/* endpoints
// (worker/src/auth.js) which hold the actual session.
//
// The session id is NOT a cookie: github.io (this site) and workers.dev (the
// Worker) are different domains, and browsers increasingly refuse to
// store/send third-party SameSite=None cookies (Safari and Brave block them
// outright, Chrome in some configurations too) — login would silently no-op.
// Instead /auth/callback hands the session id back in the URL fragment (never
// sent to any server), this file stashes it in localStorage, and every
// authenticated request attaches it explicitly via PurgeAuth.headers().
(function () {
  const WORKER_URL = (localStorage.getItem("signupWorkerUrl")
    || "https://purge-signups.itzdjpsycho.workers.dev").replace(/\/+$/, "");
  const SESSION_KEY = "purgeSessionId";

  let loginError = null;

  // Pick up ?/#purgeSession=<id> (or purgeError=<code>) left by /auth/callback's
  // redirect, then scrub it from the URL so it doesn't linger in history/bookmarks.
  (function adoptSessionFromRedirect() {
    const hash = window.location.hash || "";
    const sessionMatch = hash.match(/(?:^#|&)purgeSession=([^&]+)/);
    const errorMatch = hash.match(/(?:^#|&)purgeError=([^&]+)/);
    if (!sessionMatch && !errorMatch) return;
    if (sessionMatch) localStorage.setItem(SESSION_KEY, decodeURIComponent(sessionMatch[1]));
    if (errorMatch) loginError = decodeURIComponent(errorMatch[1]);
    const cleaned = hash
      .replace(/[#&]purgeSession=[^&]+/, "")
      .replace(/[#&]purgeError=[^&]+/, "")
      .replace(/^&/, "#");
    history.replaceState(null, "", window.location.pathname + window.location.search + (cleaned === "#" ? "" : cleaned));
  })();

  const STYLE = `
    .auth-widget{ display:flex; align-items:center; gap:8px; font-family:var(--font-mono,monospace);
      font-size:11px; color:var(--text-muted,#9a93a8); padding:10px 18px; }
    .auth-widget img{ width:20px; height:20px; border-radius:50%; flex:none; }
    .auth-widget span{ overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .auth-widget button{ font:inherit; letter-spacing:0.04em; padding:6px 12px; border-radius:999px;
      cursor:pointer; border:1px solid var(--hairline,#2A1F3A); background:var(--panel,#110D18);
      color:var(--crimson-glow,#C77DFF); flex:none; }
    .auth-widget button:hover{ border-color:var(--crimson,#6E1FB8); }
    .auth-widget-error{
      font-family:var(--font-mono,monospace); font-size:10.5px; color:var(--red-bright,#E27C6B);
      padding:0 18px 10px; line-height:1.5;
    }
  `;

  const LOGIN_ERROR_MESSAGES = {
    not_member: "That Discord account isn't in the Purge server — sign in with the account you use in our Discord.",
  };

  function ensureStyle() {
    if (document.getElementById("authWidgetStyle")) return;
    const s = document.createElement("style");
    s.id = "authWidgetStyle";
    s.textContent = STYLE;
    document.head.appendChild(s);
  }

  function sessionId() {
    return localStorage.getItem(SESSION_KEY) || null;
  }

  const ROLE_LABELS = { officer: "Officer", second: "Second in Command", guildmaster: "Guild Master" };

  function render(container, state) {
    if (state.loggedIn) {
      const avatarUrl = state.avatar
        ? `https://cdn.discordapp.com/avatars/${state.discordId}/${state.avatar}.png?size=32`
        : "";
      const roleLabel = ROLE_LABELS[state.role];
      container.innerHTML =
        (avatarUrl ? `<img src="${avatarUrl}" alt="">` : "") +
        `<span>${state.familyName || state.username}${roleLabel ? ` · ${roleLabel}` : ""}</span>` +
        `<button type="button" data-auth-action="logout">Sign out</button>`;
    } else {
      container.innerHTML = `<button type="button" data-auth-action="login">Sign in with Discord</button>`;
    }
    if (loginError) {
      let errBox = container.nextElementSibling;
      if (!errBox || !errBox.classList.contains("auth-widget-error")) {
        errBox = document.createElement("div");
        errBox.className = "auth-widget-error";
        container.insertAdjacentElement("afterend", errBox);
      }
      errBox.textContent = LOGIN_ERROR_MESSAGES[loginError] || "Sign-in failed. Please try again.";
    }

    const btn = container.querySelector("[data-auth-action]");
    if (!btn) return;
    btn.addEventListener("click", () => {
      if (btn.dataset.authAction === "login") {
        window.location.href = `${WORKER_URL}/auth/login?next=${encodeURIComponent(window.location.href)}`;
      } else {
        fetch(`${WORKER_URL}/auth/logout`, { method: "POST", headers: window.PurgeAuth.headers() })
          .catch(() => {})
          .then(() => { localStorage.removeItem(SESSION_KEY); window.location.reload(); });
      }
    });
  }

  // Mirrors worker/src/auth.js ROLE_RANK — client-side only for deciding what
  // UI to show; the Worker re-checks every permission server-side regardless.
  const ROLE_RANK = { officer: 1, second: 2, guildmaster: 3 };

  // The nav's "current page" link is already marked class="current" on every
  // page (existing site convention) — reuse it instead of adding a new one.
  function currentPageHref() {
    return document.querySelector(".side-nav a.current")?.getAttribute("href") || null;
  }

  // Signed-out visitors can only browse home.html: every other nav link is
  // hidden, and landing on a gated page directly bounces you to home.html.
  // This is a UX guard, not real access control — the underlying pages are
  // still public static files GitHub Pages will serve to anyone who fetches
  // them directly (curl, view-source, etc.); there's no server in front of
  // this site that could enforce a real login wall.
  function guardPage(state) {
    document.querySelectorAll('.side-nav a:not([href="home.html"])').forEach((a) => {
      a.style.display = state.loggedIn ? "" : "none";
    });
    if (!state.loggedIn && currentPageHref() !== "home.html") {
      window.location.replace("home.html");
    }
  }

  window.PurgeAuth = {
    WORKER_URL,
    ROLE_RANK,
    ROLE_LABELS,
    state: { loggedIn: false },
    // Header to spread into any fetch() that needs to identify the signed-in
    // user (empty object if nobody's signed in — same shape either way).
    headers() {
      const id = sessionId();
      return id ? { "X-Session-Id": id } : {};
    },
    // This user's officer rank (0 if signed out or not an officer).
    rank() {
      return ROLE_RANK[window.PurgeAuth.state.role] || 0;
    },
    // Fetches /auth/me, renders the widget into #<containerId>, and resolves
    // with the auth state so callers can gate their own admin/owner UI.
    init(containerId) {
      ensureStyle();
      const container = document.getElementById(containerId || "authWidget");
      return fetch(`${WORKER_URL}/auth/me`, { headers: window.PurgeAuth.headers() })
        .then((r) => r.json())
        .catch(() => ({ loggedIn: false }))
        .then((state) => {
          window.PurgeAuth.state = state;
          guardPage(state);
          if (container) render(container, state);
          return state;
        });
    },
  };
})();
