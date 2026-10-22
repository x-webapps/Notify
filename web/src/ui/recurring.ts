import { deleteRecurring, getApp, listRecurring, setRecurringActive } from "../api";
import { clear, confirmModal, fmtDate, h, toast } from "../dom";
import { describeSchedule } from "../recurring";
import type { RecurringRec } from "../types";
import { describeDelivery } from "../validate";
import { appTabs, errMsg, errorState, loading, targetLabel } from "./common";

function stateBadge(r: RecurringRec): HTMLElement {
  if (r.active) return h("span", { class: "badge badge-scheduled" }, "Active");
  const ended = r.ends_on !== null && r.ends_on < new Date().toISOString().slice(0, 10);
  return h("span", { class: "badge badge-cancelled" }, ended ? "Ended" : "Paused");
}

export const renderRecurring = (id: string) => async (view: HTMLElement): Promise<void> => {
  view.appendChild(loading());
  let app;
  try {
    app = await getApp(id);
  } catch (e) {
    errorState(view, errMsg(e));
    return;
  }
  const results = h("div", { class: "results" });
  clear(view);
  view.append(
    appTabs(app, "recurring"),
    h("p", { class: "muted" }, "Notifications that repeat on a schedule. Each run is sent as a normal notification and appears in History. Create one in Compose: choose When → Repeat."),
    results,
  );

  const rowEl = (r: RecurringRec): HTMLElement => {
    const toggle = h("button", { type: "button", class: "btn btn-ghost btn-sm", onclick: async () => {
      try {
        const updated = await setRecurringActive(r.id, !r.active);
        if (!r.active && !updated.active) toast("This schedule has reached its end date, so it stays off.", "error");
        else toast(r.active ? "Paused." : "Resumed.", "success");
      } catch (e) {
        toast(errMsg(e), "error");
      }
      await load();
    } }, r.active ? "Pause" : "Resume");
    const del = h("button", { type: "button", class: "btn btn-ghost btn-sm", onclick: async () => {
      const ok = await confirmModal({
        title: "Delete recurring send?",
        message: `“${r.title}” will stop. Notifications it already sent stay in History.`,
        confirmLabel: "Delete",
        danger: true,
      });
      if (!ok) return;
      try {
        await deleteRecurring(r.id);
        toast("Deleted.", "success");
      } catch (e) {
        toast(errMsg(e), "error");
      }
      await load();
    } }, "Delete");
    return h(
      "tr",
      {},
      h("td", { "data-label": "Status" }, stateBadge(r)),
      h("td", { "data-label": "Notification" }, h("strong", {}, r.title), h("div", { class: "muted clamp" }, r.body),
        describeDelivery(r) ? h("div", { class: "muted small" }, describeDelivery(r)) : null),
      h("td", { "data-label": "Schedule" }, describeSchedule(r), h("div", { class: "mono muted small" }, targetLabel(r.target_type, r.target_value))),
      h("td", { "data-label": "Next run" }, r.next_run_at ? fmtDate(r.next_run_at) : "—"),
      h("td", { "data-label": "Runs" }, `${r.run_count}`, r.last_run_at ? h("div", { class: "muted small" }, `last ${fmtDate(r.last_run_at)}`) : null),
      h("td", { "data-label": "Actions" }, h("div", { class: "row actions" }, toggle, del)),
    );
  };

  async function load(): Promise<void> {
    clear(results);
    results.appendChild(loading());
    try {
      const rows = await listRecurring(id);
      clear(results);
      if (rows.length === 0) {
        results.appendChild(h("div", { class: "state" }, h("p", {}, "No recurring sends yet."), h("a", { href: `#/apps/${id}`, class: "btn btn-primary" }, "Go to Compose")));
        return;
      }
      results.appendChild(
        h("div", { class: "table-wrap" },
          h("table", { class: "table" },
            h("thead", {}, h("tr", {}, ...["Status", "Notification", "Schedule", "Next run", "Runs", ""].map((t) => h("th", { scope: "col" }, t)))),
            h("tbody", {}, ...rows.map(rowEl)))),
      );
    } catch (e) {
      errorState(results, errMsg(e), () => void load());
    }
  }
  await load();
};
