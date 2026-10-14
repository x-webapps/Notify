import { cancelNotification, deleteNotification, getApp, listNotifications, PAGE_SIZE } from "../api";
import { clear, confirmModal, fmtDate, h, toast } from "../dom";
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

  const rowEl = (n: NotificationRec): HTMLElement => {
    const actions = h("div", { class: "row actions" });
    actions.append(
      h("a", { href: `#/apps/${id}?from=${n.id}`, class: "btn btn-ghost btn-sm" }, "Duplicate"),
    );
    if (n.status === "scheduled") {
      actions.append(h("button", { type: "button", class: "btn btn-ghost btn-sm", onclick: async () => {
        const ok = await confirmModal({ title: "Cancel scheduled notification?", message: `“${n.title}” will not be sent.`, confirmLabel: "Cancel notification", danger: true });
        if (!ok) return;
        try {
          await cancelNotification(n.id);
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
    const when = n.status === "scheduled" ? `For ${fmtDate(n.scheduled_at)}` : fmtDate(n.sent_at ?? n.created_at);
    return h(
      "tr",
      {},
      h("td", { "data-label": "Status" }, statusBadge(n.status)),
      h("td", { "data-label": "Notification" }, h("strong", {}, n.title), h("div", { class: "muted clamp" }, n.body),
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
            h("tbody", {}, ...rows.map(rowEl)))),
        h("div", { class: "pager" }, prev, h("span", { class: "muted" }, `Page ${page + 1} of ${pages} · ${total} total`), next),
      );
    } catch (e) {
      errorState(results, errMsg(e), () => void load());
    }
  }
  await load();
};
