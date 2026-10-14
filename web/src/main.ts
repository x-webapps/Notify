import "./styles.css";
import "./styles-features.css";
import { resolveAuth, type AuthState } from "./auth";
import { clear, h } from "./dom";
import { icon } from "./icons";
import { parseHash } from "./router";
import { configError, supabase } from "./supabase";
import { applyStoredTheme } from "./theme";
import { renderAppEdit, renderAppNew } from "./ui/appForm";
import { renderApps } from "./ui/apps";
import { renderAudience } from "./ui/audience";
import { renderDashboard } from "./ui/dashboard";
import { renderCompose } from "./ui/compose";
import { errorState, type Screen } from "./ui/common";
import { renderHistory } from "./ui/history";
import { renderLogin } from "./ui/login";
import { renderSettings } from "./ui/settings";
import { renderTemplates } from "./ui/templates";

applyStoredTheme();

const root = document.getElementById("app");
if (!root) throw new Error("Missing #app");

let auth: AuthState = { status: "signed-out" };

function screenFor(hash: string): Screen {
  const r = parseHash(hash);
  switch (r.name) {
    case "dashboard": return renderDashboard;
    case "apps": return renderApps;
    case "audience": return renderAudience(r.id);
    case "app-new": return renderAppNew;
    case "app-edit": return renderAppEdit(r.id);
    case "compose": return renderCompose(r.id, r.query);
    case "history": return renderHistory(r.id);
    case "templates": return renderTemplates(r.id);
    case "settings": return renderSettings;
    default:
      return (view) => {
        view.appendChild(h("div", { class: "state" }, h("p", {}, "Page not found."), h("a", { href: "#/", class: "btn btn-primary" }, "Go to apps")));
      };
  }
}

async function render(): Promise<void> {
  if (!root) return;
  if (auth.status !== "admin") {
    renderLogin(root, auth.notice);
    return;
  }
  const email = auth.email;
  const hash = window.location.hash;
  const route = parseHash(hash);
  const view = h("main", { class: "view", id: "main", tabindex: "-1" });

  const navLink = (href: string, label: string, active: boolean): HTMLElement =>
    h("a", { href, class: `nav-link${active ? " active" : ""}`, "aria-current": active ? "page" : null }, label);

  clear(root);
  root.append(
    h("a", { href: "#main", class: "skip", onclick: (e: Event) => {
      e.preventDefault(); // "#main" would otherwise be read as a route
      view.focus();
    } }, "Skip to content"),
    h(
      "header",
      { class: "topbar" },
      h("a", { href: "#/", class: "brand" }, h("span", { class: "brand-mark", "aria-hidden": "true" }, icon("bell", 16)), "Push Admin"),
      h(
        "nav",
        { "aria-label": "Main" },
        navLink("#/", "Dashboard", route.name === "dashboard"),
        navLink("#/apps", "Apps", route.name !== "settings" && route.name !== "dashboard"),
        navLink("#/settings", "Settings", route.name === "settings"),
      ),
      h("span", { class: "user muted" }, email),
    ),
    view,
  );
  try {
    await screenFor(hash)(view, { email });
  } catch {
    errorState(view, "Something went wrong while loading this page.");
  }
}

async function boot(): Promise<void> {
  if (!root) return;
  if (configError) {
    root.appendChild(h("div", { class: "state state-error", role: "alert" }, h("p", {}, configError)));
    return;
  }
  auth = await resolveAuth();
  supabase.auth.onAuthStateChange((event) => {
    // Keep this callback synchronous (no awaits on supabase calls inside it).
    if (event === "SIGNED_OUT" && auth.status === "admin") {
      auth = { status: "signed-out" };
      void render();
    }
  });
  window.addEventListener("hashchange", () => void render());
  await render();
}

void boot();
