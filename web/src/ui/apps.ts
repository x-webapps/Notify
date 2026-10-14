import { lastNotification, listApps } from "../api";
import { clear, fmtDate, h } from "../dom";
import type { AppRec, NotificationRec } from "../types";
import { errMsg, errorState, loading, statusBadge, type Screen } from "./common";

function card(app: AppRec, last: NotificationRec | null): HTMLElement {
  return h(
    "article",
    { class: "card app-card" },
    h("h2", {}, h("a", { href: `#/apps/${app.id}` }, app.name)),
    h("p", { class: "mono muted" }, app.package_name),
    h(
      "dl",
      { class: "meta" },
      h("dt", {}, "FCM project"),
      h("dd", { class: "mono" }, app.fcm_project_id),
      h("dt", {}, "Credentials"),
      h("dd", {}, app.secret_key ? `Own key (${app.secret_key})` : "Central key"),
      h("dt", {}, "Last notification"),
      h(
        "dd",
        {},
        last
          ? h("span", {}, statusBadge(last.status), " ", last.title, " · ", fmtDate(last.sent_at ?? last.scheduled_at ?? last.created_at))
          : "None yet",
      ),
    ),
    h(
      "div",
      { class: "row" },
      h("a", { href: `#/apps/${app.id}`, class: "btn btn-primary" }, "Compose"),
      h("a", { href: `#/apps/${app.id}/history`, class: "btn btn-ghost" }, "History"),
      h("a", { href: `#/apps/${app.id}/edit`, class: "btn btn-ghost" }, "Edit"),
    ),
  );
}

export const renderApps: Screen = async (view) => {
  const load = async (): Promise<void> => {
    clear(view);
    view.append(
      h("div", { class: "page-head" }, h("h1", {}, "Apps"), h("a", { href: "#/apps/new", class: "btn btn-primary" }, "Add app")),
      loading(),
    );
    try {
      const apps = await listApps();
      const lasts = await Promise.all(apps.map((a) => lastNotification(a.id).catch(() => null)));
      clear(view);
      view.appendChild(
        h("div", { class: "page-head" }, h("h1", {}, "Apps"), h("a", { href: "#/apps/new", class: "btn btn-primary" }, "Add app")),
      );
      if (apps.length === 0) {
        view.appendChild(
          h(
            "div",
            { class: "state" },
            h("p", {}, "No apps yet. Add your first Android app to start sending notifications."),
            h("a", { href: "#/apps/new", class: "btn btn-primary" }, "Add app"),
          ),
        );
        return;
      }
      view.appendChild(h("div", { class: "grid" }, ...apps.map((a, i) => card(a, lasts[i] ?? null))));
    } catch (e) {
      errorState(view, errMsg(e), () => void load());
    }
  };
  await load();
};
