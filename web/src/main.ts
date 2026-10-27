import "./styles.css";
import "./styles-features.css";
import { resolveAuth, type AuthState } from "./auth";
import { clear, h } from "./dom";
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
import { renderRecurring } from "./ui/recurring";
import { renderSettings } from "./ui/settings";
import { buildShell, type Shell } from "./ui/shell";
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
    case "recurring": return renderRecurring(r.id);
    case "settings": return renderSettings;
    default:
      return (view) => {
        view.appendChild(h("div", { class: "state" }, h("p", {}, "Page not found."), h("a", { href: "#/", class: "btn btn-primary" }, "Go to apps")));
      };
  }
}

let shell: Shell | null = null;

async function render(): Promise<void> {
  if (!root) return;
  if (auth.status !== "admin") {
    shell = null;
    renderLogin(root, auth.notice);
    return;
  }
  const email = auth.email;
  const hash = window.location.hash;
  // The shell is built once so the sidebar keeps its search text and scroll position between pages.
  if (!shell) {
    shell = buildShell(email);
    clear(root);
    root.appendChild(shell.el);
  }
  const { view } = shell;
  clear(view);
  shell.update(parseHash(hash));
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
