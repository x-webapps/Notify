import { deleteDraft, deleteTemplate, getApp, listDrafts, listTemplates, updateTemplate } from "../api";
import { clear, confirmModal, field, fmtDate, h, showModal, toast } from "../dom";
import type { AppRec, TemplateRec } from "../types";
import { hasErrors, LIMITS, validateFields } from "../validate";
import { appTabs, errMsg, errorState, loading } from "./common";

export const renderTemplates = (id: string) => async (view: HTMLElement): Promise<void> => {
  view.appendChild(loading());
  let app: AppRec;
  try {
    app = await getApp(id);
  } catch (e) {
    errorState(view, errMsg(e));
    return;
  }

  const drafts = h("div", { class: "grid" });
  const list = h("div", { class: "grid" });
  clear(view);
  view.append(
    appTabs(app, "templates"),
    h("h2", { class: "section-title" }, "Drafts"),
    drafts,
    h("h2", { class: "section-title" }, "Templates"),
    list,
  );

  async function loadDrafts(): Promise<void> {
    clear(drafts);
    try {
      const items = await listDrafts(id);
      if (items.length === 0) {
        drafts.appendChild(h("div", { class: "state" }, h("p", {}, "No drafts. Use “Save draft” in the composer to keep unfinished work.")));
        return;
      }
      for (const d of items) {
        drafts.appendChild(
          h("article", { class: "card" },
            h("strong", {}, d.title || "(untitled)"),
            h("p", { class: "muted clamp" }, d.body || "No message yet"),
            h("p", { class: "muted small" }, `Edited ${fmtDate(d.updated_at)}`),
            h("div", { class: "row" },
              h("a", { href: `#/apps/${id}?draft=${d.id}`, class: "btn btn-primary btn-sm" }, "Continue"),
              h("button", { type: "button", class: "btn btn-ghost btn-sm", onclick: async () => {
                const ok = await confirmModal({ title: "Delete draft?", message: "This draft will be removed.", confirmLabel: "Delete", danger: true });
                if (!ok) return;
                try {
                  await deleteDraft(d.id);
                } catch (e) {
                  toast(errMsg(e), "error");
                }
                await loadDrafts();
              } }, "Delete"))),
        );
      }
    } catch (e) {
      errorState(drafts, errMsg(e), () => void loadDrafts());
    }
  }
  void loadDrafts();

  const edit = (t: TemplateRec): void => {
    const name = h("input", { type: "text", maxlength: 80, value: t.name });
    const title = h("input", { type: "text", maxlength: LIMITS.title, value: t.title });
    const body = h("textarea", { rows: 4, maxlength: LIMITS.body });
    body.value = t.body;
    const url = h("input", { type: "text", value: t.url ?? "" });
    const image = h("input", { type: "text", value: t.image_url ?? "" });
    const fName = field("Template name", name);
    const fTitle = field("Title", title);
    const fBody = field("Message", body);
    const fUrl = field("Link URL (optional)", url);
    const fImage = field("Image URL (optional)", image);
    showModal("Edit template", h("div", { class: "form" }, fName.wrap, fTitle.wrap, fBody.wrap, fUrl.wrap, fImage.wrap), [
      { label: "Cancel" },
      {
        label: "Save",
        kind: "primary",
        onClick: async () => {
          const errors = validateFields(
            { title: title.value, body: body.value, url: url.value, image_url: image.value, target_type: "topic", target_value: "all" },
            app.url_allowlist,
          );
          fName.setError(name.value.trim() ? undefined : "Name is required.");
          fTitle.setError(errors.title);
          fBody.setError(errors.body);
          fUrl.setError(errors.url);
          fImage.setError(errors.image_url);
          if (hasErrors(errors) || !name.value.trim()) return false;
          try {
            await updateTemplate(t.id, {
              name: name.value.trim(), title: title.value.trim(), body: body.value.trim(),
              url: url.value.trim() || null, image_url: image.value.trim() || null,
            });
            toast("Template saved.", "success");
          } catch (e) {
            toast(errMsg(e), "error");
            return false;
          }
          void load();
        },
      },
    ]);
  };

  async function load(): Promise<void> {
    clear(list);
    list.appendChild(loading());
    try {
      const items = await listTemplates(id);
      clear(list);
      if (items.length === 0) {
        list.appendChild(h("div", { class: "state" }, h("p", {}, "No templates yet. Use “Save as template” in the composer.")));
        return;
      }
      for (const t of items) {
        list.appendChild(
          h("article", { class: "card" },
            h("h2", {}, t.name),
            h("strong", {}, t.title),
            h("p", { class: "muted clamp" }, t.body),
            t.url ? h("p", { class: "mono muted" }, t.url) : null,
            h("div", { class: "row" },
              h("a", { href: `#/apps/${id}?template=${t.id}`, class: "btn btn-primary btn-sm" }, "Use"),
              h("button", { type: "button", class: "btn btn-ghost btn-sm", onclick: () => edit(t) }, "Edit"),
              h("button", { type: "button", class: "btn btn-ghost btn-sm", onclick: async () => {
                const ok = await confirmModal({ title: "Delete template?", message: `“${t.name}” will be removed.`, confirmLabel: "Delete", danger: true });
                if (!ok) return;
                try {
                  await deleteTemplate(t.id);
                  toast("Deleted.", "success");
                } catch (e) {
                  toast(errMsg(e), "error");
                }
                await load();
              } }, "Delete"))),
        );
      }
    } catch (e) {
      errorState(list, errMsg(e), () => void load());
    }
  }
  await load();
};
