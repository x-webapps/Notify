import { clear, fmtDate, h } from "../dom";
import type { AppRec, DraftRec, NotificationRec, TemplateRec } from "../types";
import { appAvatar } from "./common";

export interface Content {
  title: string;
  body: string;
  url: string | null;
  image_url: string | null;
}

export interface QuickData {
  templates: TemplateRec[];
  /** Newest sends from every app. Only title, message, link and image are reused; audience and options are not. */
  recent: NotificationRec[];
  drafts: DraftRec[];
  apps: AppRec[];
}

type Tab = "templates" | "recent" | "drafts";

interface Row {
  lead: Node | null;
  title: string;
  body: string;
  meta: string;
  pick: () => void;
}

/**
 * Quick start list: templates, recent sends from all apps, and drafts.
 * `apply` fills the form and returns an undo function; drafts open the draft page so saving keeps updating it.
 */
export function quickStart(
  app: { id: string },
  data: QuickData,
  apply: (c: Content) => () => void,
  openDraft: (id: string) => void,
): HTMLElement {
  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "templates", label: "Templates", count: data.templates.length },
    { key: "recent", label: "Recent", count: data.recent.length },
    { key: "drafts", label: "Drafts", count: data.drafts.length },
  ];
  let active: Tab = (tabs.find((t) => t.count > 0) ?? tabs[0]!).key;
  let query = "";
  let undo: (() => void) | null = null;
  const appById = new Map(data.apps.map((a) => [a.id, a]));

  const list = h("div", { class: "qs-list" });
  const tabRow = h("div", { class: "qs-tabs", role: "tablist" });
  const status = h("div", { class: "qs-status", hidden: true, role: "status" });
  const search = h("input", { type: "search", placeholder: "Search…", "aria-label": "Search quick start", class: "qs-search", oninput: (e: Event) => {
    query = (e.target as HTMLInputElement).value.trim().toLowerCase();
    paintRows();
  } });

  const applyWith = (c: Content, label: string): void => {
    undo = apply(c);
    clear(status);
    status.hidden = false;
    status.append(
      `Applied “${label}”. `,
      h("button", { type: "button", class: "link-btn", onclick: () => {
        undo?.();
        undo = null;
        status.hidden = true;
      } }, "Undo"),
    );
  };

  const rowsFor = (tab: Tab): Row[] => {
    if (tab === "templates") {
      return data.templates.map((t) => ({ lead: null, title: t.name, body: t.title ? `${t.title} — ${t.body}` : t.body, meta: "", pick: () => applyWith(t, t.name) }));
    }
    if (tab === "recent") {
      return data.recent.map((n) => {
        const a = appById.get(n.app_id);
        return {
          lead: a ? appAvatar(a, "sm") : null,
          title: n.title,
          body: n.body,
          meta: `${a && a.id !== app.id ? `${a.name} · ` : ""}${fmtDate(n.sent_at ?? n.scheduled_at ?? n.created_at)}`,
          pick: () => applyWith(n, n.title),
        };
      });
    }
    return data.drafts.map((d) => ({ lead: null, title: d.title || "Untitled draft", body: d.body, meta: fmtDate(d.updated_at), pick: () => openDraft(d.id) }));
  };

  function paintRows(): void {
    clear(list);
    const all = rowsFor(active);
    const shown = all.filter((r) => !query || `${r.title} ${r.body}`.toLowerCase().includes(query));
    search.hidden = all.length < 6;
    if (shown.length === 0) {
      const empty = all.length === 0
        ? active === "templates" ? "No templates yet. Save a message as a template to reuse it."
          : active === "recent" ? "Nothing sent yet." : "No drafts saved."
        : "No matches.";
      list.appendChild(h("p", { class: "muted qs-empty" }, empty));
      return;
    }
    for (const r of shown) {
      list.appendChild(
        h(
          "button",
          { type: "button", class: "qs-row", onclick: r.pick },
          r.lead,
          h("span", { class: "qs-row-text" }, h("strong", {}, r.title), h("span", { class: "qs-row-body" }, r.body || "—"), r.meta ? h("span", { class: "qs-row-meta" }, r.meta) : null),
        ),
      );
    }
  }

  function paintTabs(): void {
    clear(tabRow);
    for (const t of tabs) {
      tabRow.appendChild(
        h(
          "button",
          { type: "button", role: "tab", class: `qs-tab${t.key === active ? " active" : ""}`, "aria-selected": String(t.key === active), onclick: () => {
            active = t.key;
            paintTabs();
            paintRows();
          } },
          t.label, h("span", { class: "qs-count" }, String(t.count)),
        ),
      );
    }
  }

  paintTabs();
  paintRows();
  return h(
    "section",
    { class: "card qs", "aria-label": "Quick start" },
    h("div", { class: "qs-head" }, h("h3", {}, "Quick start"), h("a", { href: `#/apps/${app.id}/templates`, class: "small" }, "Manage")),
    tabRow,
    search,
    status,
    list,
  );
}
