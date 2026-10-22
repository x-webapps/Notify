import { cancelLocalGroup, cancelNotification, deleteNotification, getApp, listLocalChildren, listNotifications, PAGE_SIZE, type LocalChild } from "../api";
import { clear, confirmModal, fmtDate, h, showModal, toast } from "../dom";
import { offsetLabel } from "../localtime";
import type { NotificationRec } from "../types";
import { describeDelivery } from "../validate";
import { appTabs, errMsg, errorState, loading, statusBadge, targetLabel } from "./common";

export const renderHistory = (id: string) => async (view: HTMLElement): Promise<void> => {
  view.appendChild(loading());
  let app;
  try {
    app = await getApp(id);
  } catch (e) {
    errorState(view, errMsg(e));
    return;
  }

  let page = 0;
  let search = "";
  const results = h("div", { class: "results" });
  const search$ = h("input", { type: "search", placeholder: "Search title or message", "aria-label": "Search history" });
  let debounce: number | undefined;
  search$.addEventListener("input", () => {
    window.clearTimeout(debounce);
    debounce = window.setTimeout(() => {
      search = search$.value;
      page = 0;
      void load();
    }, 300);
  });

  clear(view);
  view.append(appTabs(app, "history"), h("div", { class: "toolbar" }, search$), results);

  /** Per-time-zone detail of a local-time send. */
  const showZones = (n: NotificationRec, kids: LocalChild[]): void => {
    const rows = kids.map((k) =>
      h("tr", {},
        h("td", {}, k.local_offset_min === null ? "?" : offsetLabel(k.local_offset_min)),
        h("td", {}, statusBadge(k.status)),
        h("td", {}, fmtDate(k.scheduled_at)),
        h("td", { class: "row-error" }, k.error ?? "")),
    );
    const table = h("div", { class: "table-wrap zones" },
      h("table", { class: "table" },
        h("thead", {}, h("tr", {}, ...["Time zone", "Status", "Send time", ""].map((t) => h("th", { scope: "col" }, t)))),
        h("tbody", {}, ...rows)));
    showModal(`${n.title}: time zones`, table, [{ label: "Close", kind: "primary" }]);
  };

  const rowEl = (n: NotificationRec, kids: LocalChild[]): HTMLElement => {
    const isLocal = n.kind === "local_parent";
    const count = (s: string): number => kids.filter((k) => k.status === s).length;
    const actions = h("div", { class: "row actions" });
    actions.append(
      h("a", { href: `#/apps/${id}?from=${n.id}`, class: "btn btn-ghost btn-sm" }, "Duplicate"),
    );
    if (n.status === "scheduled") {
      actions.append(h("button", { type: "button", class: "btn btn-ghost btn-sm", onclick: async () => {
        const ok = await confirmModal({ title: "Cancel scheduled notification?", message: isLocal ? `The ${count("scheduled")} time zones not sent yet will be cancelled. Zones already sent stay sent.` : `“${n.title}” will not be sent.`, confirmLabel: "Cancel notification", danger: true });
        if (!ok) return;
        try {
          await (isLocal ? cancelLocalGroup(n.id) : cancelNotification(n.id));
          toast("Cancelled.", "success");
        } catch (e) {
          toast(errMsg(e), "error");
        }
        await load();
      } }, "Cancel"));
    }
    if (n.status !== "sending") {
      actions.append(h("button", { type: "button", class: "btn btn-ghost btn-sm", onclick: async () => {
        const ok = await confirmModal({ title: "Delete log entry?", message: "This only removes the log. A notification already sent cannot be recalled.", confirmLabel: "Delete", danger: true });
        if (!ok) return;
        try {
          await deleteNotification(n.id);
          toast("Deleted.", "success");
        } catch (e) {
          toast(errMsg(e), "error");
        }
        await load();
      } }, "Delete"));
    }
    if (isLocal) {
      actions.prepend(h("button", { type: "button", class: "btn btn-ghost btn-sm", onclick: () => showZones(n, kids) }, "View zones"));
    }
    const when = isLocal
      ? `Local ${n.local_time ?? ""}${n.status === "scheduled" ? ` · next ${fmtDate(n.scheduled_at)}` : ""}`
      : n.status === "scheduled" ? `For ${fmtDate(n.scheduled_at)}` : fmtDate(n.sent_at ?? n.created_at);
    const zoneSummary = isLocal
      ? `Device local time · ${kids.length} time zones · ${count("sent")} sent${count("scheduled") ? ` · ${count("scheduled")} scheduled` : ""}${count("failed") ? ` · ${count("failed")} failed` : ""}`
      : "";
    return h(
      "tr",
      {},
      h("td", { "data-label": "Status" }, statusBadge(n.status)),
      h("td", { "data-label": "Notification" }, h("strong", {}, n.title), h("div", { class: "muted clamp" }, n.body),
        zoneSummary ? h("div", { class: "muted small" }, zoneSummary) : null,
        n.recurring_id ? h("div", { class: "muted small" }, "From a recurring send") : null,
        describeDelivery(n) ? h("div", { class: "muted small" }, describeDelivery(n)) : null,
        n.error ? h("div", { class: "row-error" }, n.error) : null),
      h("td", { "data-label": "Target", class: "mono" }, targetLabel(n.target_type, n.target_value)),
      h("td", { "data-label": "Time" }, when),
      h("td", { "data-label": "Actions" }, actions),
    );
  };

  async function load(): Promise<void> {
    clear(results);
    results.appendChild(loading());
    try {
      const { rows, total } = await listNotifications(id, page, search);
      const kids = await listLocalChildren(rows.filter((r) => r.kind === "local_parent").map((r) => r.id));
      clear(results);
      if (rows.length === 0) {
        results.appendChild(h("div", { class: "state" }, h("p", {}, search ? "No notifications match your search." : "No notifications yet.")));
        return;
      }
      const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
      const prev = h("button", { type: "button", class: "btn btn-ghost btn-sm", disabled: page === 0, onclick: () => { page--; void load(); } }, "Previous");
      const next = h("button", { type: "button", class: "btn btn-ghost btn-sm", disabled: page >= pages - 1, onclick: () => { page++; void load(); } }, "Next");
      results.append(
        h("div", { class: "table-wrap" },
          h("table", { class: "table" },
            h("thead", {}, h("tr", {}, ...["Status", "Notification", "Target", "Time", ""].map((t) => h("th", { scope: "col" }, t)))),
            h("tbody", {}, ...rows.map((r) => rowEl(r, kids.filter((k) => k.parent_id === r.id)))))),
        h("div", { class: "pager" }, prev, h("span", { class: "muted" }, `Page ${page + 1} of ${pages} · ${total} total`), next),
      );
    } catch (e) {
      errorState(results, errMsg(e), () => void load());
    }
  }
  await load();
};
