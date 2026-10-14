import {
  createTemplate,
  getApp,
  getNotification,
  getTemplate,
  scheduleNotification,
  sendNow,
  type ComposePayload,
} from "../api";
import { append, clear, confirmModal, field, h, showModal, toast } from "../dom";
import type { AppRec, SendResult, TargetType } from "../types";
import { effectiveAppUrl, hasErrors, LIMITS, validateFields, validateSchedule, type FieldErrors } from "../validate";
import { appTabs, errMsg, errorState, loading, type Ctx } from "./common";
import { createPreview } from "./preview";

type TargetChoice = "default" | "topic" | "condition" | "token";

const COOLDOWN_MS = 3000;

function toLocalInputValue(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function counter(max: number): { el: HTMLElement; set: (n: number) => void } {
  const el = h("span", { class: "counter", "aria-live": "off" });
  return {
    el,
    set(n) {
      el.textContent = `${n}/${max}`;
      el.classList.toggle("over", n > max);
    },
  };
}

function resultBox(): { el: HTMLElement; show: (r: SendResult | { error: string }, scheduledNote?: string) => void; hide: () => void } {
  const el = h("div", { class: "result", hidden: true });
  return {
    el,
    hide() {
      el.hidden = true;
    },
    show(r, scheduledNote) {
      clear(el);
      el.hidden = false;
      if ("ok" in r && r.ok) {
        el.className = "result result-ok";
        el.setAttribute("role", "status");
        append(el, [h("strong", {}, scheduledNote ?? "Sent successfully."), r.message_id ? h("div", { class: "mono" }, `Message ID: ${r.message_id}`) : null]);
      } else {
        el.className = "result result-error";
        el.setAttribute("role", "alert");
        const err = "error" in r && r.error ? r.error : "Sending failed.";
        append(el, [h("strong", {}, "Not sent"), h("div", {}, err), "hint" in r && r.hint ? h("div", { class: "hint" }, r.hint) : null]);
      }
    },
  };
}

export function buildComposer(app: AppRec, ctx: Ctx, prefill: Partial<ComposePayload>): HTMLElement {
  const preview = createPreview(app);

  // ---- inputs
  const title = h("input", { type: "text", maxlength: LIMITS.title, autocomplete: "off", value: prefill.title ?? "" });
  const body = h("textarea", { rows: 4, maxlength: LIMITS.body, value: prefill.body ?? "" });
  body.value = prefill.body ?? "";
  const url = h("input", { type: "text", inputmode: "url", autocomplete: "off", spellcheck: "false", placeholder: "https://example.com/page", value: prefill.url ?? "" });
  const image = h("input", { type: "text", inputmode: "url", autocomplete: "off", spellcheck: "false", placeholder: "https://example.com/banner.png", value: prefill.image_url ?? "" });

  const targetSel = h(
    "select",
    {},
    h("option", { value: "default" }, `All users (topic “${app.default_topic}”)`),
    h("option", { value: "topic" }, "Custom topic"),
    h("option", { value: "condition" }, "Condition (topic combination)"),
    h("option", { value: "token" }, "Single device token"),
  );
  const targetValue = h("input", { type: "text", autocomplete: "off", spellcheck: "false" });
  const initialTarget: TargetChoice = prefill.target_type === undefined
    ? "default"
    : prefill.target_type === "topic" && prefill.target_value === app.default_topic
    ? "default"
    : prefill.target_type;
  targetSel.value = initialTarget;
  targetValue.value = initialTarget === "default" ? "" : prefill.target_value ?? "";

  const modeNow = h("input", { type: "radio", name: "mode", value: "now", checked: true });
  const modeLater = h("input", { type: "radio", name: "mode", value: "later" });
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const when = h("input", { type: "datetime-local", value: toLocalInputValue(new Date(Date.now() + 3600_000)) });

  const testToken = h("input", { type: "text", autocomplete: "off", spellcheck: "false", placeholder: "Device token from Logcat" });

  const tCount = counter(LIMITS.title);
  const bCount = counter(LIMITS.body);

  // ---- fields
  const fTitle = field("Title", title);
  const fBody = field("Message", body);
  const fUrl = field("Link URL (optional)", url, { hint: "Opens in the browser when the notification is tapped. Sent as data key “url”." });
  const useAppLink = h("button", { type: "button", class: "btn btn-ghost btn-sm link-chip" }, "Use app page link");
  useAppLink.addEventListener("click", () => {
    url.value = effectiveAppUrl(app);
    url.dispatchEvent(new Event("input"));
  });
  fUrl.wrap.querySelector("label")?.after(useAppLink);
  const fImage = field("Image URL (optional)", image, { hint: "Must be https. Shown as a large image on Android." });
  const fTarget = field("Target", targetSel);
  const fTargetValue = field("Target value", targetValue);
  const fWhen = field("Date and time", when, { hint: `Your local time zone: ${tz}` });
  const fTest = field("Test device token", testToken);

  fTitle.wrap.querySelector("label")?.after(tCount.el);
  fBody.wrap.querySelector("label")?.after(bCount.el);

  const result = resultBox();
  const sendBtn = h("button", { type: "button", class: "btn btn-primary btn-lg" }, "Send now");
  const testBtn = h("button", { type: "button", class: "btn btn-ghost" }, "Send test to token");
  const tplBtn = h("button", { type: "button", class: "btn btn-ghost" }, "Save as template");

  // ---- derived state
  const targetType = (): TargetType => (targetSel.value === "default" ? "topic" : (targetSel.value as TargetType));
  const targetVal = (): string => (targetSel.value === "default" ? app.default_topic : targetValue.value.trim());
  const isLater = (): boolean => modeLater.checked;

  const payload = (override?: { target_type: TargetType; target_value: string }): ComposePayload => ({
    app_id: app.id,
    title: title.value.trim(),
    body: body.value.trim(),
    url: url.value.trim() || null,
    image_url: image.value.trim() || null,
    target_type: override?.target_type ?? targetType(),
    target_value: override?.target_value ?? targetVal(),
  });

  const showErrors = (e: FieldErrors, includeTarget: boolean): void => {
    fTitle.setError(e.title);
    fBody.setError(e.body);
    fUrl.setError(e.url);
    fImage.setError(e.image_url);
    if (includeTarget) fTargetValue.setError(e.target_value);
  };

  const refresh = (): void => {
    tCount.set(title.value.length);
    bCount.set(body.value.length);
    fTargetValue.wrap.hidden = targetSel.value === "default";
    const labels: Record<string, string> = { topic: "Topic name", condition: "Condition", token: "Device token" };
    fTargetValue.wrap.querySelector("label")!.textContent = labels[targetSel.value] ?? "Target value";
    targetValue.placeholder = targetSel.value === "condition" ? "'news' in topics && 'pro' in topics" : "";
    fWhen.wrap.hidden = !isLater();
    sendBtn.textContent = isLater() ? "Schedule" : "Send now";
    preview.update({ appName: app.name, title: title.value, body: body.value, imageUrl: image.value });
    // Live validation of the link/image only (don't nag about empty required fields before submit).
    const live = validateFields({ ...payload(), title: "x", body: "x", target_type: "topic", target_value: "all" }, app.url_allowlist);
    fUrl.setError(live.url);
    fImage.setError(live.image_url);
  };
  for (const el of [title, body, url, image, targetSel, targetValue, modeNow, modeLater]) {
    el.addEventListener("input", refresh);
    el.addEventListener("change", refresh);
  }

  // ---- send throttling: busy while in flight + 3 s after each click
  let busy = false;
  let lockedUntil = 0;
  const buttons = [sendBtn, testBtn];
  const syncButtons = (): void => {
    const locked = busy || Date.now() < lockedUntil;
    for (const b of buttons) b.disabled = locked;
  };
  const run = async (task: () => Promise<void>): Promise<void> => {
    if (busy || Date.now() < lockedUntil) return;
    busy = true;
    lockedUntil = Date.now() + COOLDOWN_MS;
    syncButtons();
    window.setTimeout(syncButtons, COOLDOWN_MS + 50);
    try {
      await task();
    } catch (e) {
      const msg = errMsg(e);
      result.show({ error: msg });
      toast(msg, "error");
    } finally {
      busy = false; // never leave the UI stuck on "sending"
      syncButtons();
    }
  };

  const summary = (p: ComposePayload, extra?: string): HTMLElement =>
    h(
      "div",
      {},
      h("p", {}, p.target_type === "topic" && p.target_value === app.default_topic
        ? `This will notify all users of ${app.name}.`
        : `This will notify ${p.target_type} “${p.target_value}” of ${app.name}.`),
      h("dl", { class: "meta" }, h("dt", {}, "Title"), h("dd", {}, p.title), h("dt", {}, "Message"), h("dd", {}, p.body),
        p.url ? h("dt", {}, "Link") : null, p.url ? h("dd", { class: "mono" }, p.url) : null,
        extra ? h("dt", {}, "When") : null, extra ? h("dd", {}, extra) : null),
    );

  // ---- actions
  sendBtn.addEventListener("click", () => void run(async () => {
    result.hide();
    const p = payload();
    const errors = validateFields(p, app.url_allowlist);
    showErrors(errors, true);
    let whenDate: Date | null = null;
    if (isLater()) {
      whenDate = when.value ? new Date(when.value) : null;
      const err = validateSchedule(whenDate);
      fWhen.setError(err ?? undefined);
      if (err) return;
    }
    if (hasErrors(errors)) {
      toast("Fix the highlighted fields first.", "error");
      return;
    }
    const wide = p.target_type !== "token";
    if (wide || isLater()) {
      const ok = await confirmModal({
        title: isLater() ? "Schedule notification?" : "Send notification?",
        message: summary(p, whenDate ? `${whenDate.toLocaleString()} (${tz})` : undefined),
        confirmLabel: isLater() ? "Schedule" : "Send now",
      });
      if (!ok) return;
    }
    if (whenDate) {
      await scheduleNotification(p, whenDate, ctx.email);
      result.show({ notification_id: "", ok: true, status: "scheduled" }, `Scheduled for ${whenDate.toLocaleString()}.`);
      toast("Notification scheduled.", "success");
    } else {
      const r = await sendNow(p);
      result.show(r);
      toast(r.ok ? "Notification sent." : "Sending failed.", r.ok ? "success" : "error");
    }
  }));

  testBtn.addEventListener("click", () => void run(async () => {
    result.hide();
    const token = testToken.value.trim();
    const p = payload({ target_type: "token", target_value: token });
    const errors = validateFields(p, app.url_allowlist);
    showErrors(errors, false);
    fTest.setError(errors.target_value);
    if (hasErrors(errors)) {
      toast("Fix the highlighted fields first.", "error");
      return;
    }
    const r = await sendNow(p);
    result.show(r);
    toast(r.ok ? "Test sent." : "Test failed.", r.ok ? "success" : "error");
  }));

  tplBtn.addEventListener("click", () => {
    const errors = validateFields({ ...payload(), target_type: "topic", target_value: "all" }, app.url_allowlist);
    showErrors(errors, false);
    if (errors.title || errors.body || errors.url || errors.image_url) {
      toast("Fix the highlighted fields first.", "error");
      return;
    }
    const nameInput = h("input", { type: "text", maxlength: 80, value: title.value.trim().slice(0, 80) });
    const f = field("Template name", nameInput);
    showModal("Save as template", f.wrap, [
      { label: "Cancel" },
      {
        label: "Save",
        kind: "primary",
        onClick: async () => {
          const name = nameInput.value.trim();
          if (!name) {
            f.setError("Name is required.");
            return false;
          }
          try {
            const p = payload();
            await createTemplate({ app_id: app.id, name, title: p.title, body: p.body, url: p.url, image_url: p.image_url });
            toast("Template saved.", "success");
          } catch (e) {
            toast(errMsg(e), "error");
            return false;
          }
        },
      },
    ]);
  });

  const resetBtn = h("button", { type: "button", class: "btn btn-ghost", onclick: () => {
    for (const el of [title, body, url, image, targetValue]) el.value = "";
    targetSel.value = "default";
    modeNow.checked = true;
    result.hide();
    showErrors({}, true);
    refresh();
  } }, "Clear");

  const form = h(
    "form",
    { class: "card form", novalidate: true, onsubmit: (e: Event) => e.preventDefault() },
    fTitle.wrap,
    fBody.wrap,
    fUrl.wrap,
    fImage.wrap,
    fTarget.wrap,
    fTargetValue.wrap,
    h(
      "fieldset",
      { class: "mode" },
      h("legend", {}, "When"),
      h("label", { class: "radio" }, modeNow, " Send now"),
      h("label", { class: "radio" }, modeLater, " Schedule"),
    ),
    fWhen.wrap,
    h("div", { class: "row" }, sendBtn, tplBtn, resetBtn),
    result.el,
    h("hr", {}),
    h("h3", {}, "Send a test"),
    h("p", { class: "muted" }, "Sends the content above to one device only. Get the token from Logcat in your app."),
    fTest.wrap,
    testBtn,
  );

  refresh();
  return h("div", { class: "compose" }, form, preview.el);
}

export const renderCompose = (id: string, query: URLSearchParams) => async (view: HTMLElement, ctx: Ctx): Promise<void> => {
  view.appendChild(loading());
  try {
    const app = await getApp(id);
    const prefill: Partial<ComposePayload> = {};
    const templateId = query.get("template");
    const fromId = query.get("from");
    if (templateId) {
      const t = await getTemplate(templateId);
      Object.assign(prefill, { title: t.title, body: t.body, url: t.url, image_url: t.image_url });
    } else if (fromId) {
      const n = await getNotification(fromId);
      Object.assign(prefill, {
        title: n.title, body: n.body, url: n.url, image_url: n.image_url,
        target_type: n.target_type, target_value: n.target_value,
      });
    }
    clear(view);
    view.append(appTabs(app, "compose"), buildComposer(app, ctx, prefill));
  } catch (e) {
    errorState(view, errMsg(e));
  }
};
