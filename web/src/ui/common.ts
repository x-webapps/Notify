import { clear, h } from "../dom";
import type { AppRec, NotificationStatus } from "../types";

export interface Ctx {
  email: string;
}

export type Screen = (view: HTMLElement, ctx: Ctx) => void | Promise<void>;

export function loading(text = "Loading…"): HTMLElement {
  return h("p", { class: "muted loading", role: "status" }, text);
}

export function errorState(view: HTMLElement, message: string, retry?: () => void): void {
  clear(view);
  view.appendChild(
    h(
      "div",
      { class: "state state-error", role: "alert" },
      h("p", {}, message),
      retry ? h("button", { type: "button", class: "btn btn-ghost", onclick: retry }, "Try again") : null,
    ),
  );
}

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong.";
}

export function link(href: string, text: string, cls = ""): HTMLAnchorElement {
  return h("a", { href, class: cls }, text);
}

export function appTabs(app: AppRec, active: "compose" | "history" | "templates" | "edit"): HTMLElement {
  const tab = (key: typeof active, path: string, label: string): HTMLElement =>
    h("a", { href: `#/apps/${app.id}${path}`, class: `tab${key === active ? " active" : ""}`, "aria-current": key === active ? "page" : null }, label);
  return h(
    "header",
    { class: "app-header" },
    h("div", { class: "crumbs" }, h("a", { href: "#/" }, "Apps"), " / ", h("strong", {}, app.name)),
    h(
      "nav",
      { class: "tabs", "aria-label": `${app.name} sections` },
      tab("compose", "", "Compose"),
      tab("history", "/history", "History"),
      tab("templates", "/templates", "Templates"),
      tab("edit", "/edit", "App settings"),
    ),
  );
}

const STATUS_LABEL: Record<NotificationStatus, string> = {
  scheduled: "Scheduled",
  sending: "Sending",
  sent: "Sent",
  failed: "Failed",
  cancelled: "Cancelled",
};

export function statusBadge(status: NotificationStatus): HTMLElement {
  return h("span", { class: `badge badge-${status}` }, STATUS_LABEL[status]);
}

export function targetLabel(type: string, value: string): string {
  if (type === "topic") return `Topic: ${value}`;
  if (type === "condition") return `Condition: ${value}`;
  return `Device: …${value.slice(-8)}`;
}
