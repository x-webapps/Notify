import { clear, h } from "../dom";
import { icon } from "../icons";
import type { AppRec, NotificationStatus } from "../types";
import { effectiveAppUrl } from "../validate";

export interface Ctx {
  email: string;
}

export type Screen = (view: HTMLElement, ctx: Ctx) => void | Promise<void>;

/** Skeleton placeholder; pass text only for a specific wait message (e.g. a connection check). */
export function loading(text?: string): HTMLElement {
  if (text) return h("p", { class: "muted loading", role: "status" }, text);
  const bar = (cls: string): HTMLElement => h("div", { class: `skel ${cls}` });
  return h(
    "div",
    { class: "skeleton", role: "status", "aria-label": "Loading" },
    bar("skel-title"),
    ...[0, 1, 2].map(() => h("div", { class: "skel-card" }, bar("skel-line w60"), bar("skel-line"), bar("skel-line w80"))),
  );
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

function hashOf(text: string): number {
  let n = 0;
  for (const ch of text) n = (n * 31 + ch.codePointAt(0)!) >>> 0;
  return n;
}

/** App icon (from icon_url) or a gradient letter avatar. Sizes: sm 20px, md 44px, lg 56px. */
export function appAvatar(app: Pick<AppRec, "name" | "icon_url">, size: "sm" | "md" | "lg" = "md"): HTMLElement {
  const letter = (app.name.trim()[0] ?? "?").toUpperCase();
  const fallback = (): HTMLElement =>
    h("span", { class: `avatar avatar-${size} av-${hashOf(app.name) % 6}`, "aria-hidden": "true" }, letter);
  const url = app.icon_url?.trim();
  if (!url || !/^https:\/\//i.test(url)) return fallback();
  const img = h("img", { class: `avatar avatar-${size} avatar-img`, src: url, alt: "", referrerpolicy: "no-referrer", loading: "lazy" });
  img.addEventListener("error", () => img.replaceWith(fallback()));
  return img;
}

export function link(href: string, text: string, cls = ""): HTMLAnchorElement {
  return h("a", { href, class: cls }, text);
}

export function appTabs(app: AppRec, active: "compose" | "history" | "recurring" | "templates" | "audience" | "edit"): HTMLElement {
  const tab = (key: typeof active, path: string, label: string): HTMLElement =>
    h("a", { href: `#/apps/${app.id}${path}`, class: `tab${key === active ? " active" : ""}`, "aria-current": key === active ? "page" : null }, label);
  return h(
    "header",
    { class: "app-header" },
    h(
      "div",
      { class: "app-title" },
      appAvatar(app, "lg"),
      h("div", { class: "app-title-text" }, h("h1", {}, app.name), h("p", { class: "mono muted" }, app.package_name)),
      h(
        "a",
        { href: effectiveAppUrl(app), target: "_blank", rel: "noopener noreferrer", class: "btn btn-ghost btn-sm" },
        "Open app page ",
        icon("external", 14),
      ),
    ),
    h(
      "nav",
      { class: "tabs", "aria-label": `${app.name} sections` },
      tab("compose", "", "Compose"),
      tab("history", "/history", "History"),
      tab("recurring", "/recurring", "Recurring"),
      tab("templates", "/templates", "Drafts & templates"),
      tab("audience", "/audience", "Audience"),
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
