import { loadDashboard } from "../api";
import { clear, fmtDate, h } from "../dom";
import { icon } from "../icons";
import { successRate } from "../stats";
import type { AppRec, DashboardData } from "../types";
import { appAvatar, errMsg, errorState, loading, statusBadge, type Screen } from "./common";

export function tile(label: string, value: string, note: string, accent = false): HTMLElement {
  return h(
    "div",
    { class: `tile${accent ? " tile-accent" : ""}` },
    h("div", { class: "tile-label" }, label),
    h("div", { class: "tile-value" }, value),
    h("div", { class: "tile-note" }, note),
  );
}

export function chart(data: DashboardData): HTMLElement {
  const max = Math.max(1, ...data.days.map((d) => d.sent + d.failed));
  const cols = data.days.map((d) => {
    const sent = h("div", { class: "bar bar-sent" });
    const failed = h("div", { class: "bar bar-failed" });
    sent.style.height = `${(d.sent / max) * 100}%`;
    failed.style.height = `${(d.failed / max) * 100}%`;
    return h(
      "div",
      { class: "bar-col", title: `${d.label}: ${d.sent} sent, ${d.failed} failed` },
      h("div", { class: "bar-stack" }, failed, sent),
      h("div", { class: "bar-label" }, d.label),
      h("div", { class: "visually-hidden" }, `${d.label}: ${d.sent} sent, ${d.failed} failed`),
    );
  });
  return h(
    "section",
    { class: "card" },
    h("div", { class: "card-head" }, h("h2", {}, "Last 7 days"), h("div", { class: "legend" }, h("span", { class: "dot dot-sent" }), "Sent", h("span", { class: "dot dot-failed" }), "Failed")),
    data.sent7 + data.failed7 === 0 ? h("p", { class: "muted" }, "No notifications sent in the last 7 days.") : null,
    h("div", { class: "bars", role: "img", "aria-label": "Notifications sent per day over the last 7 days" }, ...cols),
  );
}

export function recent(data: DashboardData): HTMLElement {
  const apps = new Map<string, AppRec>(data.apps.map((a) => [a.id, a]));
  const items = data.recent.map((n) => {
    const app = apps.get(n.app_id);
    return h(
      "a",
      { href: `#/apps/${n.app_id}/history`, class: "activity-item" },
      app ? appAvatar(app, "md") : null,
      h("div", { class: "activity-text" }, h("strong", {}, n.title), h("div", { class: "muted clamp" }, `${app?.name ?? "Unknown app"} · ${n.body}`)),
      h("div", { class: "activity-meta" }, statusBadge(n.status), h("span", { class: "muted" }, fmtDate(n.sent_at ?? n.scheduled_at ?? n.created_at))),
    );
  });
  return h(
    "section",
    { class: "card" },
    h("div", { class: "card-head" }, h("h2", {}, "Recent activity")),
    items.length === 0 ? h("p", { class: "muted" }, "Nothing sent yet. Pick an app and send your first notification.") : h("div", { class: "activity" }, ...items),
  );
}

export const renderDashboard: Screen = async (view, ctx) => {
  const load = async (): Promise<void> => {
    clear(view);
    view.appendChild(loading());
    try {
      const data = await loadDashboard();
      clear(view);
      const rate = successRate(data.sent7, data.failed7);
      view.append(
        h(
          "div",
          { class: "page-head" },
          h("div", {}, h("h1", {}, "Dashboard"), h("p", { class: "muted" }, `Welcome back, ${ctx.email.split("@")[0]}`)),
          h("a", { href: "#/apps", class: "btn btn-primary" }, icon("send", 16), "Send a notification"),
        ),
        h(
          "div",
          { class: "tiles" },
          tile("Apps", String(data.apps.length), "connected", true),
          tile("Sent", String(data.sent7), "last 7 days"),
          tile("Success rate", rate === null ? "—" : `${rate}%`, data.failed7 > 0 ? `${data.failed7} failed` : "no failures"),
          tile("Scheduled", String(data.scheduled), "waiting to send"),
        ),
        h("div", { class: "two-col" }, chart(data), recent(data)),
      );
    } catch (e) {
      errorState(view, errMsg(e), () => void load());
    }
  };
  await load();
};
