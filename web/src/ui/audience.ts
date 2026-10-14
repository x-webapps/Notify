import { addAudienceTopic, deleteAudienceTopic, getApp, listAudience } from "../api";
import { KOTLIN_SNIPPET, topicName } from "../audience";
import { clear, confirmModal, field, h, toast } from "../dom";
import type { AppRec, AudienceKind, AudienceTopic } from "../types";
import { appTabs, errMsg, errorState, loading } from "./common";

const KIND_LABEL: Record<AudienceKind, string> = {
  custom: "Custom",
  version: "App version",
  country: "Country",
  language: "Language",
  timezone: "Time zone",
};

const HELP: Record<AudienceKind, { label: string; placeholder: string }> = {
  custom: { label: "Topic name", placeholder: "beta_testers" },
  version: { label: "Version code", placeholder: "42" },
  country: { label: "Country code (2 letters)", placeholder: "IN" },
  language: { label: "Language code", placeholder: "hi" },
  timezone: { label: "Time zone", placeholder: "Asia/Kolkata" },
};

function timeZones(): string[] {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return ["UTC", "Asia/Kolkata", "America/New_York", "Europe/London"];
  }
}

export const renderAudience = (id: string) => async (view: HTMLElement): Promise<void> => {
  view.appendChild(loading());
  let app: AppRec;
  try {
    app = await getApp(id);
  } catch (e) {
    errorState(view, errMsg(e));
    return;
  }

  const list = h("div", { class: "audience-list" });

  // ---- add form
  const kind = h("select", {}, ...(Object.keys(KIND_LABEL) as AudienceKind[]).map((k) => h("option", { value: k }, KIND_LABEL[k])));
  const value = h("input", { type: "text", autocomplete: "off", spellcheck: "false" });
  const tzList = h("datalist", { id: "tz-list" }, ...timeZones().map((z) => h("option", { value: z })));
  const labelInput = h("input", { type: "text", maxlength: 60, placeholder: "Optional friendly name" });
  const fKind = field("Type", kind);
  const fValue = field("Value", value);
  const fLabel = field("Label (optional)", labelInput);
  const result = h("div", { class: "hint" });
  const add = h("button", { type: "submit", class: "btn btn-primary" }, "Add audience");

  const sync = (): void => {
    const k = kind.value as AudienceKind;
    fValue.wrap.querySelector("label")!.textContent = HELP[k].label;
    value.placeholder = HELP[k].placeholder;
    if (k === "timezone") value.setAttribute("list", "tz-list");
    else value.removeAttribute("list");
    const name = topicName(k, value.value);
    result.textContent = name ? `The app must subscribe to topic: ${name}` : "";
  };
  kind.addEventListener("change", sync);
  value.addEventListener("input", sync);
  sync();

  const form = h("form", { class: "card form", novalidate: true }, h("h2", {}, "Add an audience"), fKind.wrap, fValue.wrap, tzList, fLabel.wrap, result, h("div", { class: "row" }, add));
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const k = kind.value as AudienceKind;
    const name = topicName(k, value.value);
    fValue.setError(name ? undefined : "Enter a value.");
    if (!name) return;
    add.disabled = true;
    try {
      await addAudienceTopic({ app_id: id, name, kind: k, label: labelInput.value.trim() || name });
      value.value = "";
      labelInput.value = "";
      sync();
      toast("Audience added.", "success");
      await load();
    } catch (e) {
      const msg = errMsg(e);
      toast(/duplicate key|unique/i.test(msg) ? "That audience already exists." : msg, "error");
    } finally {
      add.disabled = false;
    }
  });

  // ---- Android snippet
  const code = h("pre", { class: "code" }, KOTLIN_SNIPPET);
  const copy = h("button", { type: "button", class: "btn btn-ghost btn-sm" }, "Copy code");
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(KOTLIN_SNIPPET);
      toast("Copied.", "success");
    } catch {
      toast("Could not copy. Select the code and copy it manually.", "error");
    }
  });
  const snippet = h(
    "section",
    { class: "card" },
    h("div", { class: "card-head" }, h("h2", {}, "Android code"), copy),
    h("p", { class: "muted" }, "Add this to your Android app so each device joins its own audience topics. Firebase stores the subscriptions, so nothing is saved in your database."),
    code,
  );

  clear(view);
  view.append(
    appTabs(app, "audience"),
    h("div", { class: "two-col audience-cols" }, h("div", {}, form, h("section", { class: "card" }, h("div", { class: "card-head" }, h("h2", {}, "Saved audiences")), list)), snippet),
  );

  async function load(): Promise<void> {
    clear(list);
    list.appendChild(loading());
    try {
      const items = await listAudience(id);
      clear(list);
      if (items.length === 0) {
        list.appendChild(h("p", { class: "muted" }, "None yet. Add audiences such as a country or app version, then target them in the composer."));
        return;
      }
      const row = (t: AudienceTopic): HTMLElement =>
        h(
          "div",
          { class: "chip-row" },
          h("span", { class: "kind-pill" }, KIND_LABEL[t.kind]),
          h("div", { class: "chip-text" }, h("strong", {}, t.label), t.label !== t.name ? h("span", { class: "mono muted" }, ` ${t.name}`) : null),
          h("button", { type: "button", class: "btn btn-ghost btn-sm", onclick: async () => {
            const ok = await confirmModal({ title: "Remove audience?", message: `“${t.label}” is only removed from this list. Devices stay subscribed.`, confirmLabel: "Remove", danger: true });
            if (!ok) return;
            try {
              await deleteAudienceTopic(t.id);
            } catch (e) {
              toast(errMsg(e), "error");
            }
            await load();
          } }, "Remove"),
        );
      list.append(...items.map(row));
    } catch (e) {
      errorState(list, errMsg(e), () => void load());
    }
  }
  await load();
};
