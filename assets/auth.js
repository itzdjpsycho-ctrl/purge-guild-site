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

  // Pick up ?/#purgeSession=<id> left by /auth/callback's redirect, then
  // scrub it from the URL so it doesn't linger in history/bookmarks.
  (function adoptSessionFromRedirect() {
    const hash = window.location.hash || "";
    const m = hash.match(/(?:^#|&)purgeSession=([^&]+)/);
    if (!m) return;
    localStorage.setItem(SESSION_KEY, decodeURIComponent(m[1]));
    const cleaned = hash.replace(/[#&]purgeSession=[^&]+/, "").replace(/^&/, "#");
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
  `;

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

  function render(container, state) {
    if (state.loggedIn) {
      const avatarUrl = state.avatar
        ? `https://cdn.discordapp.com/avatars/${state.discordId}/${state.avatar}.png?size=32`
        : "";
      container.innerHTML =
        (avatarUrl ? `<img src="${avatarUrl}" alt="">` : "") +
        `<span>${state.familyName || state.username}${state.isAdmin ? " · Officer" : ""}</span>` +
        `<button type="button" data-auth-action="logout">Sign out</button>`;
    } else {
      container.innerHTML = `<button type="button" data-auth-action="login">Sign in with Discord</button>`;
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

  window.PurgeAuth = {
    WORKER_URL,
    state: { loggedIn: false },
    // Header to spread into any fetch() that needs to identify the signed-in
    // user (empty object if nobody's signed in — same shape either way).
    headers() {
      const id = sessionId();
      return id ? { "X-Session-Id": id } : {};
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
          if (container) render(container, state);
          return state;
        });
    },
  };
})();
