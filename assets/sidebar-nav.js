// Sidebar nav — category collapse/expand. The nav is grouped into fixed
// categories (Overview / Warfare / Media / Tools); this just lets a visitor
// collapse ones they don't use, and remembers that per-browser (localStorage),
// same pattern as Squad Roles / the Tachyon Tracker's found-state — personal
// to the visitor, not shared guild data.
//
// Replaces the old assets/nav-order.js (Guild-Master drag-to-reorder), which
// was dropped when the nav became categorized — the category order is fixed
// for everyone now. One copy included on every page via
// <script src="assets/sidebar-nav.js"></script>, placed after the
// <nav class="side-nav"> markup. No auth dependency — runs immediately.
(function () {
  const STORAGE_KEY = "sidebarCollapsedCats";
  const nav = document.getElementById("sideNav");
  if (!nav) return;

  const groups = Array.from(nav.querySelectorAll(".side-nav-group"));

  function readCollapsed() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch (e) {
      return new Set();
    }
  }

  function writeCollapsed(set) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
    } catch (e) {}
  }

  const collapsed = readCollapsed();

  groups.forEach((group) => {
    const cat = group.dataset.cat;
    const head = group.querySelector(".side-nav-group-head");
    if (!head) return;

    if (cat && collapsed.has(cat)) group.classList.add("collapsed");

    head.addEventListener("click", () => {
      const isCollapsed = group.classList.toggle("collapsed");
      if (!cat) return;
      if (isCollapsed) collapsed.add(cat);
      else collapsed.delete(cat);
      writeCollapsed(collapsed);
    });
  });
})();
