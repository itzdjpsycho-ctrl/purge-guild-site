// Sidebar nav reordering — lets a Guild Master drag the left sidebar's links
// into whatever order they want; the result is stored in the Worker (KV key
// "navOrder") and applied for every visitor, not just the Guild Master.
// One copy included on every page via <script src="assets/nav-order.js"></script>,
// placed after the <nav class="side-nav"> markup.
//
// Two entry points:
//   - runs immediately on load: fetches the saved order and reorders the
//     .side-nav links. Public GET, no auth needed — this half is for every
//     visitor, so it doesn't wait on PurgeAuth.init()'s round trip.
//   - PurgeNavOrder.enableIfGuildMaster(state): call once auth state is known
//     (the state PurgeAuth.init() resolves with) to turn on drag-and-drop.
//     Gated to guildmaster rank specifically — stricter than the general
//     officer-tier gate used elsewhere on the site, since this changes
//     navigation for every visitor, not just the requester's own view.
(function () {
  const WORKER_URL = (window.PurgeAuth && window.PurgeAuth.WORKER_URL)
    || "https://purge-signups.itzdjpsycho.workers.dev";
  const nav = document.querySelector(".side-nav");
  if (!nav) return;

  function links() {
    return Array.from(nav.querySelectorAll("a"));
  }

  function applyOrder(order) {
    if (!Array.isArray(order) || !order.length) return;
    const all = links();
    const byHref = new Map(all.map((a) => [a.getAttribute("href"), a]));
    // Known hrefs go in the saved order; anything not in it (a page added
    // since the Guild Master last arranged the nav) keeps its original
    // relative position, appended after the ordered ones.
    const ordered = order.map((h) => byHref.get(h)).filter(Boolean);
    const leftover = all.filter((a) => !order.includes(a.getAttribute("href")));
    ordered.concat(leftover).forEach((a) => nav.appendChild(a));
  }

  fetch(`${WORKER_URL}/nav-order`)
    .then((r) => r.json())
    .then((data) => applyOrder(data.order))
    .catch(() => {}); // saved order unreachable — keep the default markup order

  let dragging = null;

  function saveOrder() {
    const order = links().map((a) => a.getAttribute("href"));
    fetch(`${WORKER_URL}/nav-order`, {
      method: "POST",
      headers: Object.assign(
        { "Content-Type": "application/json" },
        window.PurgeAuth ? window.PurgeAuth.headers() : {}
      ),
      body: JSON.stringify({ order }),
    }).catch(() => {});
  }

  function enableIfGuildMaster(state) {
    if (!state || state.role !== "guildmaster") return;
    nav.classList.add("side-nav-editable");
    links().forEach((a) => {
      a.draggable = true;
      a.addEventListener("dragstart", () => {
        dragging = a;
        a.classList.add("dragging");
      });
      a.addEventListener("dragend", () => {
        a.classList.remove("dragging");
        dragging = null;
        saveOrder();
      });
      a.addEventListener("dragover", (e) => {
        e.preventDefault();
        if (!dragging || dragging === a) return;
        const rect = a.getBoundingClientRect();
        const before = (e.clientY - rect.top) < rect.height / 2;
        nav.insertBefore(dragging, before ? a : a.nextSibling);
      });
    });
  }

  window.PurgeNavOrder = { enableIfGuildMaster };
})();
