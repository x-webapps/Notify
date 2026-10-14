import { lastNotification, listApps } from "../api";
import { clear, fmtDate, h } from "../dom";
import { icon } from "../icons";
import type { AppRec, NotificationRec } from "../types";
import { effectiveAppUrl } from "../validate";
import { appAvatar, errMsg, errorState, loading, statusBadge, type Screen } from "./common";

function head(count?: number): HTMLElement {
  return h(
    "div",
    { class: "page-head" },
    h("div", {}, h("h1", {}, "Your apps"), h("p", { class: "muted" }, count === undefined ? " " : `${count} connected · pick one to send a notification`)),
    h("a", { href: "#/apps/new", class: "btn btn-primary" }, icon("plus", 16), "Add app"),
  );
}

export function card(app: AppRec, last: NotificationRec | null): HTMLElement {
  return h(
    "article",
    { class: "card app-card" },
    h(
      "div",
      { class: "app-card-head" },
      appAvatar(app, "lg"),
      h("div", { class: "app-card-title" }, h("h2", {}, h("a", { href: `#/apps/${app.id}` }, app.name)), h("p", { class: "mono muted" }, app.package_name)),
      h("a", { href: effectiveAppUrl(app), target: "_blank", rel: "noopener noreferrer", class: "icon-btn", "aria-label": `Open ${app.name} page` }, icon("external", 16)),
    ),
    h(
      "dl",
      { class: "meta" },
      h("dt", {}, "FCM project"),
      h("dd", { class: "mono" }, app.fcm_project_id),
      h("dt", {}, "Credentials"),
      h("dd", {}, app.secret_key ? "Own key" : "Central key"),
      h("dt", {}, "Last sent"),
      h(
        "dd",
        {},
        last
          ? h("span", { class: "last" }, statusBadge(last.status), " ", h("span", { class: "last-title" }, last.title), h("span", { class: "muted" }, ` · ${fmtDate(last.sent_at ?? last.scheduled_at ?? last.created_at)}`))
          : h("span", { class: "muted" }, "Nothing yet"),
      ),
    ),
    h(
      "div",
      { class: "row" },
      h("a", { href: `#/apps/${app.id}`, class: "btn btn-primary btn-sm" }, icon("send", 14), "Compose"),
      h("a", { href: `#/apps/${app.id}/history`, class: "btn btn-ghost btn-sm" }, "History"),
      h("a", { href: `#/apps/${app.id}/edit`, class: "btn btn-ghost btn-sm" }, "Edit"),
    ),
  );
}

export const renderApps: Screen = async (view) => {
  const load = async (): Promise<void> => {
    clear(view);
    view.append(head(), loading());
    try {
      const apps = await listApps();
      const lasts = await Promise.all(apps.map((a) => lastNotification(a.id).catch(() => null)));
      clear(view);
      view.appendChild(head(apps.length));
      if (apps.length === 0) {
        view.appendChild(
          h(
            "div",
            { class: "state empty" },
            h("div", { class: "empty-mark" }, icon("bell", 28)),
            h("h2", {}, "No apps yet"),
            h("p", {}, "Add your first Android app to start sending push notifications."),
            h("a", { href: "#/apps/new", class: "btn btn-primary" }, icon("plus", 16), "Add app"),
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
