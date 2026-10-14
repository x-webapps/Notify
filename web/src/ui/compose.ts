import {
  createTemplate,
  deleteDraft,
  getApp,
  getDraft,
  getNotification,
  getTemplate,
  listAudience,
  saveDraft,
  scheduleNotification,
  sendNow,
  uploadImage,
  type ComposePayload,
} from "../api";
import { buildAudienceTarget, decodeAudience, encodeAudience, MAX_TOPICS_IN_CONDITION } from "../audience";
import { append, clear, confirmModal, field, h, showModal, toast } from "../dom";
import type { AppRec, AudienceTopic, SendResult, TargetChoice, TargetType } from "../types";
import {
  effectiveAppUrl,
  hasErrors,
  LIMITS,
  validateFields,
  validateImage,
  validateLink,
  validateSchedule,
  type FieldErrors,
} from "../validate";
import { renderVariables } from "../variables";
import { appTabs, errMsg, errorState, loading, type Ctx } from "./common";
import { insertToolbar } from "./insert";
import { createPreview } from "./preview";

const COOLDOWN_MS = 3000;
const TITLE_FIT = 40; // roughly what a collapsed Android title shows
const BODY_FIT = 100; // roughly what a collapsed Android body shows

export interface Prefill {
  title?: string;
  body?: string;
  url?: string | null;
  image_url?: string | null;
  choice?: TargetChoice;
  targetValue?: string;
}

export interface ComposeExtras {
  topics: AudienceTopic[];
  draftId: string | null;
}

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

export function buildComposer(app: AppRec, ctx: Ctx, prefill: Prefill, extras: ComposeExtras): HTMLElement {
  const preview = createPreview(app);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  let draftId = extras.draftId;

  // ---- inputs
  const title = h("input", { type: "text", maxlength: LIMITS.title, autocomplete: "off", value: prefill.title ?? "" });
  const body = h("textarea", { rows: 4, maxlength: LIMITS.body });
  body.value = prefill.body ?? "";
  const url = h("input", { type: "text", inputmode: "url", autocomplete: "off", spellcheck: "false", placeholder: "https://example.com/page", value: prefill.url ?? "" });
  const image = h("input", { type: "text", inputmode: "url", autocomplete: "off", spellcheck: "false", placeholder: "https://example.com/banner.png", value: prefill.image_url ?? "" });

  const targetSel = h(
    "select",
    {},
    h("option", { value: "default" }, `All users (topic “${app.default_topic}”)`),
    h("option", { value: "audience" }, "Audience (version, country, language…)"),
    h("option", { value: "topic" }, "Custom topic"),
    h("option", { value: "condition" }, "Condition (advanced)"),
    h("option", { value: "token" }, "Single device token"),
  );
  const targetValue = h("input", { type: "text", autocomplete: "off", spellcheck: "false" });
  const choice: TargetChoice = prefill.choice ?? "default";
  targetSel.value = choice;
  if (choice === "topic" || choice === "condition" || choice === "token") targetValue.value = prefill.targetValue ?? "";

  // audience builder
  const initialAudience = choice === "audience" ? decodeAudience(prefill.targetValue ?? "") : { names: [], mode: "all" as const };
  const audienceChecks = extras.topics.map((t) => {
    const box = h("input", { type: "checkbox", value: t.name, checked: initialAudience.names.includes(t.name) });
    return { topic: t, box };
  });
  const modeAll = h("input", { type: "radio", name: "aud-mode", value: "all", checked: initialAudience.mode === "all" });
  const modeAny = h("input", { type: "radio", name: "aud-mode", value: "any", checked: initialAudience.mode === "any" });
  const audienceText = h("div", { class: "mono muted audience-result" });
  const audienceBox = h(
    "div",
    { class: "audience-box" },
    extras.topics.length === 0
      ? h("p", { class: "muted" }, "No audiences saved yet. ", h("a", { href: `#/apps/${app.id}/audience` }, "Add some in the Audience tab"), ".")
      : h(
        "div",
        {},
        h("div", { class: "check-grid" }, ...audienceChecks.map(({ topic, box }) => h("label", { class: "check" }, box, h("span", {}, topic.label)))),
        h("div", { class: "row mode-row" }, h("label", { class: "radio" }, modeAll, " Match all"), h("label", { class: "radio" }, modeAny, " Match any")),
        audienceText,
      ),
  );
  const fAudience = field("Audience", audienceBox);

  const modeNow = h("input", { type: "radio", name: "mode", value: "now", checked: true });
  const modeLater = h("input", { type: "radio", name: "mode", value: "later" });
  const when = h("input", { type: "datetime-local", value: toLocalInputValue(new Date(Date.now() + 3600_000)) });
  const testToken = h("input", { type: "text", autocomplete: "off", spellcheck: "false", placeholder: "Device token from Logcat" });

  const tCount = counter(LIMITS.title);
  const bCount = counter(LIMITS.body);

  // ---- fields
  const fTitle = field("Title", title);
  const fBody = field("Message", body);
  const titleFit = h("div", { class: "hint warn-hint" });
  const bodyFit = h("div", { class: "hint warn-hint" });
  title.after(titleFit);
  body.after(bodyFit);
  const fUrl = field("Link URL (optional)", url, { hint: "Opens in the browser when the notification is tapped. Sent as data key “url”." });
  const useAppLink = h("button", { type: "button", class: "btn btn-ghost btn-sm link-chip" }, "Use app page link");
  useAppLink.addEventListener("click", () => {
    url.value = effectiveAppUrl(app);
    url.dispatchEvent(new Event("input"));
  });
  fUrl.wrap.querySelector("label")?.after(useAppLink);

  const fImage = field("Image (optional)", image, { hint: "Paste an https link, or upload a JPG/PNG/WebP under 1 MB." });
  const fileInput = h("input", { type: "file", accept: "image/jpeg,image/png,image/webp", class: "visually-hidden", tabindex: "-1", "aria-label": "Upload image file" });
  const uploadBtn = h("button", { type: "button", class: "btn btn-ghost btn-sm link-chip" }, "Upload image");
  uploadBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const f = fileInput.files?.[0];
    fileInput.value = "";
    if (!f) return;
    uploadBtn.disabled = true;
    uploadBtn.textContent = "Uploading…";
    try {
      image.value = await uploadImage(app.id, f);
      image.dispatchEvent(new Event("input"));
      toast("Image uploaded.", "success");
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      uploadBtn.disabled = false;
      uploadBtn.textContent = "Upload image";
    }
  });
  fImage.wrap.querySelector("label")?.after(uploadBtn, fileInput);

  const fTarget = field("Target", targetSel);
  const fTargetValue = field("Target value", targetValue);
  const fWhen = field("Date and time", when, { hint: `Your local time zone: ${tz}` });
  const fTest = field("Test device token", testToken);

  fTitle.wrap.querySelector("label")?.after(tCount.el);
  fBody.wrap.querySelector("label")?.after(bCount.el);

  const toolbar = insertToolbar([title, body]);

  const result = resultBox();
  const sendBtn = h("button", { type: "button", class: "btn btn-primary btn-lg" }, "Send now");
  const testBtn = h("button", { type: "button", class: "btn btn-ghost" }, "Send test to token");
  const draftBtn = h("button", { type: "button", class: "btn btn-ghost" }, "Save draft");
  const tplBtn = h("button", { type: "button", class: "btn btn-ghost" }, "Save as template");

  // ---- derived state
  const isLater = (): boolean => modeLater.checked;
  const selectedNames = (): string[] => audienceChecks.filter((c) => c.box.checked).map((c) => c.topic.name);
  const audienceMode = (): "all" | "any" => (modeAny.checked ? "any" : "all");
  const audienceTarget = (): { type: TargetType; value: string } | null => {
    const t = buildAudienceTarget(selectedNames(), audienceMode());
    return t;
  };
  const target = (): { type: TargetType; value: string } => {
    switch (targetSel.value) {
      case "default": return { type: "topic", value: app.default_topic };
      case "audience": return audienceTarget() ?? { type: "topic", value: "" };
      default: return { type: targetSel.value as TargetType, value: targetValue.value.trim() };
    }
  };
  const targetLabelFor = (): string => {
    if (targetSel.value === "audience") {
      const labels = audienceChecks.filter((c) => c.box.checked).map((c) => c.topic.label);
      return labels.length ? labels.join(audienceMode() === "all" ? " AND " : " OR ") : "";
    }
    return "";
  };

  const payload = (override?: { type: TargetType; value: string }): ComposePayload => {
    const t = override ?? target();
    return {
      app_id: app.id,
      title: title.value.trim(),
      body: body.value.trim(),
      url: url.value.trim() || null,
      image_url: image.value.trim() || null,
      target_type: t.type,
      target_value: t.value,
      tz,
    };
  };
  const vars = (): { appName: string; now: Date; tz: string } => ({ appName: app.name, now: new Date(), tz });
  /** Validation runs on the text as it will be after variables are filled in. */
  const validate = (p: ComposePayload): FieldErrors => {
    const v = vars();
    return validateFields({ ...p, title: renderVariables(p.title, v), body: renderVariables(p.body, v) }, app.url_allowlist);
  };

  const showErrors = (e: FieldErrors, includeTarget: boolean): void => {
    fTitle.setError(e.title);
    fBody.setError(e.body);
    fUrl.setError(e.url);
    fImage.setError(e.image_url);
    if (includeTarget) {
      if (targetSel.value === "audience") {
        const n = selectedNames().length;
        fAudience.setError(n === 0 ? "Pick at least one audience." : n > MAX_TOPICS_IN_CONDITION ? `Pick at most ${MAX_TOPICS_IN_CONDITION} audiences.` : e.target_value);
      } else {
        fTargetValue.setError(e.target_value);
      }
    }
  };

  const refresh = (): void => {
    tCount.set(title.value.length);
    bCount.set(body.value.length);
    titleFit.textContent = title.value.length > TITLE_FIT ? `Over ~${TITLE_FIT} characters: may be cut off on a collapsed notification.` : "";
    bodyFit.textContent = body.value.length > BODY_FIT ? `Over ~${BODY_FIT} characters: the rest shows only when expanded.` : "";
    const c = targetSel.value;
    fTargetValue.wrap.hidden = c === "default" || c === "audience";
    fAudience.wrap.hidden = c !== "audience";
    const labels: Record<string, string> = { topic: "Topic name", condition: "Condition", token: "Device token" };
    fTargetValue.wrap.querySelector("label")!.textContent = labels[c] ?? "Target value";
    targetValue.placeholder = c === "condition" ? "'news' in topics && 'pro' in topics" : "";
    const t = audienceTarget();
    audienceText.textContent = t ? (t.type === "topic" ? `Topic: ${t.value}` : t.value) : "Nothing selected";
    fWhen.wrap.hidden = !isLater();
    sendBtn.textContent = isLater() ? "Schedule" : "Send now";
    const v = vars();
    preview.update({
      appName: app.name,
      title: renderVariables(title.value, v),
      body: renderVariables(body.value, v),
      imageUrl: image.value,
    });
    // Live validation of link/image only (don't nag about empty required fields before submit).
    fUrl.setError(validateLink(url.value, app.url_allowlist) ?? undefined);
    fImage.setError(validateImage(image.value) ?? undefined);
  };
  const watched: HTMLElement[] = [title, body, url, image, targetSel, targetValue, modeNow, modeLater, modeAll, modeAny, ...audienceChecks.map((c) => c.box)];
  for (const el of watched) {
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

  const summary = (p: ComposePayload, extra?: string): HTMLElement => {
    const aud = targetLabelFor();
    const who = p.target_type === "topic" && p.target_value === app.default_topic
      ? `all users of ${app.name}`
      : aud ? `${aud} (${app.name})` : `${p.target_type} “${p.target_value}” of ${app.name}`;
    return h(
      "div",
      {},
      h("p", {}, `This will notify ${who}.`),
      h("dl", { class: "meta" }, h("dt", {}, "Title"), h("dd", {}, p.title), h("dt", {}, "Message"), h("dd", {}, p.body),
        p.url ? h("dt", {}, "Link") : null, p.url ? h("dd", { class: "mono" }, p.url) : null,
        extra ? h("dt", {}, "When") : null, extra ? h("dd", {}, extra) : null),
    );
  };

  const afterSent = async (): Promise<void> => {
    if (!draftId) return;
    try {
      await deleteDraft(draftId);
    } catch { /* the draft is just left behind */ }
    draftId = null;
  };

  // ---- actions
  sendBtn.addEventListener("click", () => void run(async () => {
    result.hide();
    const p = payload();
    const errors = validate(p);
    showErrors(errors, true);
    let whenDate: Date | null = null;
    if (isLater()) {
      whenDate = when.value ? new Date(when.value) : null;
      const err = validateSchedule(whenDate);
      fWhen.setError(err ?? undefined);
      if (err) return;
    }
    const audienceBad = targetSel.value === "audience" && (selectedNames().length === 0 || selectedNames().length > MAX_TOPICS_IN_CONDITION);
    if (hasErrors(errors) || audienceBad) {
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
      await afterSent();
    } else {
      const r = await sendNow(p);
      result.show(r);
      toast(r.ok ? "Notification sent." : "Sending failed.", r.ok ? "success" : "error");
      if (r.ok) await afterSent();
    }
  }));

  testBtn.addEventListener("click", () => void run(async () => {
    result.hide();
    const token = testToken.value.trim();
    const p = payload({ type: "token", value: token });
    const errors = validate(p);
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

  draftBtn.addEventListener("click", async () => {
    const linkErr = validateLink(url.value, app.url_allowlist) ?? validateImage(image.value);
    if (linkErr) {
      toast(linkErr, "error");
      return;
    }
    draftBtn.disabled = true;
    try {
      const c = targetSel.value as TargetChoice;
      draftId = await saveDraft(draftId, {
        app_id: app.id,
        title: title.value.trim(),
        body: body.value.trim(),
        url: url.value.trim() || null,
        image_url: image.value.trim() || null,
        target_choice: c,
        target_value: c === "audience" ? encodeAudience(selectedNames(), audienceMode()) : c === "default" ? "" : targetValue.value.trim(),
      });
      toast("Draft saved.", "success");
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      draftBtn.disabled = false;
    }
  });

  tplBtn.addEventListener("click", () => {
    const errors = validate({ ...payload(), target_type: "topic", target_value: "all" });
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
    for (const c of audienceChecks) c.box.checked = false;
    targetSel.value = "default";
    modeNow.checked = true;
    result.hide();
    showErrors({}, true);
    fAudience.setError(undefined);
    refresh();
  } }, "Clear");

  const form = h(
    "form",
    { class: "card form", novalidate: true, onsubmit: (e: Event) => e.preventDefault() },
    toolbar,
    fTitle.wrap,
    fBody.wrap,
    fUrl.wrap,
    fImage.wrap,
    fTarget.wrap,
    fTargetValue.wrap,
    fAudience.wrap,
    h(
      "fieldset",
      { class: "mode" },
      h("legend", {}, "When"),
      h("label", { class: "radio" }, modeNow, " Send now"),
      h("label", { class: "radio" }, modeLater, " Schedule"),
    ),
    fWhen.wrap,
    h("div", { class: "row" }, sendBtn, draftBtn, tplBtn, resetBtn),
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
    const [app, topics] = await Promise.all([getApp(id), listAudience(id)]);
    const prefill: Prefill = {};
    let draftId: string | null = null;
    const templateId = query.get("template");
    const fromId = query.get("from");
    const draftParam = query.get("draft");
    if (templateId) {
      const t = await getTemplate(templateId);
      Object.assign(prefill, { title: t.title, body: t.body, url: t.url, image_url: t.image_url });
    } else if (fromId) {
      const n = await getNotification(fromId);
      const choice: TargetChoice = n.target_type === "topic" && n.target_value === app.default_topic ? "default" : n.target_type;
      Object.assign(prefill, { title: n.title, body: n.body, url: n.url, image_url: n.image_url, choice, targetValue: n.target_value });
    } else if (draftParam) {
      const d = await getDraft(draftParam);
      draftId = d.id;
      Object.assign(prefill, { title: d.title, body: d.body, url: d.url, image_url: d.image_url, choice: d.target_choice, targetValue: d.target_value });
    }
    clear(view);
    view.append(appTabs(app, "compose"), buildComposer(app, ctx, prefill, { topics, draftId }));
  } catch (e) {
    errorState(view, errMsg(e));
  }
};
