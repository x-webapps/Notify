import { listApps } from "../api";
import { signOut } from "../auth";
import { clear, h } from "../dom";
import { icon } from "../icons";
import type { Route } from "../router";
import { getTheme, setTheme } from "../theme";
import type { AppRec } from "../types";
import { appAvatar } from "./common";

const COLLAPSE_KEY = "sidebar-collapsed";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeCollapsed(v: boolean): void {
  try {
    localStorage.setItem(COLLAPSE_KEY, v ? "1" : "0");
  } catch { /* storage unavailable: preference just won't persist */ }
}

/** Section path to keep when switching app, so History stays History. */
function sectionOf(route: Route): string {
  switch (route.name) {
    case "history": return "/history";
    case "templates": return "/templates";
    case "audience": return "/audience";
    case "recurring": return "/recurring";
    case "app-edit": return "/edit";
    default: return "";
  }
}

function appIdOf(route: Route): string | null {
  return "id" in route ? route.id : null;
}

let stopKeys: (() => void) | null = null;

function isTyping(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
}

/** `/` search, `g d` dashboard, `n` new notification, `[` collapse. Returns an unbind function. */
function bindShortcuts(a: { focusSearch(): void; newNotification(): void; toggleSidebar(): void }): () => void {
  let pendingG = 0;
  const onKey = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target) || document.querySelector(".overlay")) return;
    const g = pendingG > Date.now();
    pendingG = 0;
    if (e.key === "/") { e.preventDefault(); a.focusSearch(); }
    else if (e.key === "[") a.toggleSidebar();
    else if (e.key === "n") a.newNotification();
    else if (e.key === "g") pendingG = Date.now() + 1000;
    else if (e.key === "d" && g) window.location.hash = "#/";
  };
  document.addEventListener("keydown", onKey);
  return () => document.removeEventListener("keydown", onKey);
}

export interface Shell {
  el: HTMLElement;
  view: HTMLElement;
  update(route: Route): void;
}

export function buildShell(email: string): Shell {
  let apps: AppRec[] | null = null;
  let query = "";
  let route: Route = { name: "dashboard" };
  let collapsed = readCollapsed();

  const shell = h("div", { class: `shell${collapsed ? " is-collapsed" : ""}` });
  const view = h("main", { class: "view", id: "main", tabindex: "-1" });
  const appList = h("div", { class: "side-apps", role: "list" });
  const scrim = h("div", { class: "scrim", onclick: () => shell.classList.remove("nav-open") });

  const navLink = (href: string, label: string, ico: Parameters<typeof icon>[0], active: boolean): HTMLElement =>
    h("a", { href, class: `side-link${active ? " active" : ""}`, title: label, "aria-current": active ? "page" : null }, icon(ico, 18), h("span", { class: "side-text" }, label));

  const nav = h("nav", { class: "side-nav", "aria-label": "Main" });
  const themeBtn = h("button", { type: "button", class: "side-icon", onclick: () => {
    setTheme(getTheme() === "dark" ? "light" : "dark");
    paintTheme();
  } });
  function setCollapsed(v: boolean): void {
    collapsed = v;
    writeCollapsed(v);
    shell.classList.toggle("is-collapsed", v);
    paintCollapse();
  }
  const collapseBtn = h("button", { type: "button", class: "side-icon side-collapse", onclick: () => setCollapsed(!collapsed) });

  function paintTheme(): void {
    const dark = getTheme() === "dark";
    clear(themeBtn);
    themeBtn.append(icon(dark ? "sun" : "moon", 17));
    themeBtn.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
    themeBtn.title = dark ? "Light theme" : "Dark theme";
  }

  function paintCollapse(): void {
    clear(collapseBtn);
    collapseBtn.append(icon("panel", 17));
    collapseBtn.setAttribute("aria-label", collapsed ? "Expand sidebar" : "Collapse sidebar");
    collapseBtn.title = collapsed ? "Expand sidebar" : "Collapse sidebar";
  }

  function paintApps(): void {
    clear(appList);
    const activeId = appIdOf(route);
    const q = query.trim().toLowerCase();
    const shown = (apps ?? []).filter((a) => !q || a.name.toLowerCase().includes(q) || a.package_name.toLowerCase().includes(q));
    for (const a of shown) {
      const active = a.id === activeId;
      appList.appendChild(
        h(
          "a",
          { href: `#/apps/${a.id}${sectionOf(route)}`, class: `side-app${active ? " active" : ""}`, role: "listitem", title: a.name, "aria-current": active ? "page" : null },
          appAvatar(a, "md"),
          h("span", { class: "side-text side-app-text" }, h("span", { class: "side-app-name" }, a.name), h("span", { class: "side-app-pkg" }, a.package_name)),
        ),
      );
    }
    if (apps && shown.length === 0) {
      appList.appendChild(h("p", { class: "side-none" }, q ? "No results" : "No apps yet"));
    }
  }

  function paintNav(): void {
    clear(nav);
    nav.append(
      navLink("#/", "Dashboard", "home", route.name === "dashboard"),
      navLink("#/apps", "All apps", "grid", route.name === "apps"),
      navLink("#/settings", "Settings", "settings", route.name === "settings"),
    );
  }

  const search = h("input", { type: "search", placeholder: "Find application…  ( / )", "aria-label": "Find application", oninput: (e: Event) => {
    query = (e.target as HTMLInputElement).value;
    paintApps();
  }, onkeydown: (e: Event) => {
    if ((e as KeyboardEvent).key === "Escape") {
      search.blur();
      shell.classList.remove("nav-open");
    }
  } });

  const sidebar = h(
    "aside",
    { class: "sidebar", "aria-label": "Sidebar" },
    h(
      "div",
      { class: "side-head" },
      h("a", { href: "#/", class: "brand", title: "Push Admin" }, h("span", { class: "brand-mark", "aria-hidden": "true" }, icon("bell", 18)), h("span", { class: "side-text brand-text" }, h("strong", {}, "Push Admin"), h("small", {}, "Notifications"))),
      collapseBtn,
    ),
    nav,
    h("div", { class: "side-search" }, icon("search", 15), search),
    h("div", { class: "side-label" }, h("span", { class: "side-text" }, "Applications")),
    appList,
    h("a", { href: "#/apps/new", class: "side-new", title: "New app" }, icon("plus", 16), h("span", { class: "side-text" }, "New app")),
    h(
      "div",
      { class: "side-foot" },
      h("span", { class: "side-user side-text", title: email }, email),
      themeBtn,
      h("button", { type: "button", class: "side-icon", "aria-label": "Sign out", title: "Sign out", onclick: () => void signOut() }, icon("logout", 17)),
    ),
  );

  const mobileBar = h(
    "header",
    { class: "mobile-bar" },
    h("button", { type: "button", class: "side-icon", "aria-label": "Open menu", onclick: () => shell.classList.add("nav-open") }, icon("menu", 20)),
    h("a", { href: "#/", class: "brand" }, h("span", { class: "brand-mark", "aria-hidden": "true" }, icon("bell", 16)), "Push Admin"),
  );

  shell.append(
    h("a", { href: "#main", class: "skip", onclick: (e: Event) => {
      e.preventDefault(); // "#main" would otherwise be read as a route
      view.focus();
    } }, "Skip to content"),
    sidebar,
    scrim,
    h("div", { class: "content" }, mobileBar, view),
  );
  paintTheme();
  paintCollapse();

  stopKeys?.();
  stopKeys = bindShortcuts({
    focusSearch: () => {
      if (collapsed) setCollapsed(false);
      shell.classList.add("nav-open"); // opens the drawer on phones; no effect on desktop
      search.focus();
    },
    newNotification: () => {
      const id = appIdOf(route);
      if (id) window.location.hash = `#/apps/${id}`;
    },
    toggleSidebar: () => setCollapsed(!collapsed),
  });

  // Re-fetch only when the list may have changed (add/edit/delete); app-to-app navigation reuses the cache.
  const refetch = (r: Route): boolean => apps === null || r.name === "app-new" || r.name === "app-edit" || r.name === "apps";

  return {
    el: shell,
    view,
    update(next: Route): void {
      route = next;
      shell.classList.remove("nav-open");
      paintNav();
      paintApps();
      if (refetch(next)) {
        void listApps().then((list) => {
          apps = list;
          paintApps();
        }).catch(() => { /* the page itself reports load errors */ });
      }
    },
  };
}
