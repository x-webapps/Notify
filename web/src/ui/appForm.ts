import { createApp, deleteApp, getApp, updateApp } from "../api";
import { clear, confirmModal, field, h, toast } from "../dom";
import { go } from "../router";
import type { AppInput, AppRec } from "../types";
import { FCM_PROJECT_RE, isValidTopic, parseDomainList, SECRET_NAME_RE } from "../validate";
import { appTabs, errMsg, errorState, loading, type Screen } from "./common";

function buildForm(existing: AppRec | null): HTMLElement {
  const name = h("input", { type: "text", maxlength: 80, required: true, value: existing?.name ?? "" });
  const pkg = h("input", { type: "text", maxlength: 200, required: true, value: existing?.package_name ?? "", placeholder: "com.example.app", autocapitalize: "off", spellcheck: "false" });
  const project = h("input", { type: "text", required: true, value: existing?.fcm_project_id ?? "", placeholder: "my-app-12345", autocapitalize: "off", spellcheck: "false" });
  const topic = h("input", { type: "text", value: existing?.default_topic ?? "all" });
  const channel = h("input", { type: "text", maxlength: 100, value: existing?.channel_id ?? "app_updates_channel" });
  const secret = h("input", { type: "text", value: existing?.secret_key ?? "", placeholder: "FCM_SERVICE_ACCOUNT_MYAPP", autocapitalize: "characters", spellcheck: "false" });
  const allow = h("textarea", { rows: 3, placeholder: "example.com\nmy-site.io" }, (existing?.url_allowlist ?? []).join("\n"));

  const fName = field("App name", name);
  const fPkg = field("Package name", pkg);
  const fProject = field("FCM project ID", project, { hint: "Firebase console → Project settings → Project ID." });
  const fTopic = field("Default topic", topic, { hint: "The topic every user subscribes to (usually “all”)." });
  const fChannel = field("Notification channel ID", channel, { hint: "Must match the channel created in the Android app." });
  const fSecret = field("Own service-account secret name (optional)", secret, {
    hint: "Leave empty to use the central FCM_SERVICE_ACCOUNT. Only the secret NAME goes here, never the key itself.",
  });
  const fAllow = field("Allowed link domains (optional)", allow, {
    hint: "One per line. If set, notification links must be on one of these domains (or subdomains).",
  });

  const save = h("button", { type: "submit", class: "btn btn-primary" }, existing ? "Save changes" : "Add app");
  const form = h("form", { class: "card form", novalidate: true });
  form.append(fName.wrap, fPkg.wrap, fProject.wrap, fTopic.wrap, fChannel.wrap, fSecret.wrap, fAllow.wrap);

  const actions = h("div", { class: "row" }, save);
  if (existing) {
    const del = h("button", { type: "button", class: "btn btn-danger" }, "Delete app");
    del.addEventListener("click", async () => {
      const ok = await confirmModal({
        title: `Delete ${existing.name}?`,
        message: "This also deletes its notification history and templates. This cannot be undone.",
        confirmLabel: "Delete app",
        danger: true,
      });
      if (!ok) return;
      try {
        await deleteApp(existing.id);
        toast("App deleted.", "success");
        go("/");
      } catch (e) {
        toast(errMsg(e), "error");
      }
    });
    actions.appendChild(del);
  }
  form.appendChild(actions);

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const input: AppInput = {
      name: name.value.trim(),
      package_name: pkg.value.trim(),
      fcm_project_id: project.value.trim(),
      default_topic: topic.value.trim() || "all",
      channel_id: channel.value.trim() || "app_updates_channel",
      secret_key: secret.value.trim() || null,
      url_allowlist: parseDomainList(allow.value),
    };
    const errs = {
      name: input.name ? undefined : "Name is required.",
      pkg: input.package_name ? undefined : "Package name is required.",
      project: FCM_PROJECT_RE.test(input.fcm_project_id) ? undefined : "Use the lowercase Firebase project ID (letters, digits, dashes).",
      topic: isValidTopic(input.default_topic) ? undefined : "Topic may only contain letters, numbers and -_.~%",
      secret: input.secret_key && !SECRET_NAME_RE.test(input.secret_key) ? "Must look like FCM_SERVICE_ACCOUNT_MYAPP (A–Z, 0–9, _)." : undefined,
    };
    fName.setError(errs.name);
    fPkg.setError(errs.pkg);
    fProject.setError(errs.project);
    fTopic.setError(errs.topic);
    fSecret.setError(errs.secret);
    if (Object.values(errs).some(Boolean)) return;

    save.disabled = true;
    try {
      if (existing) {
        await updateApp(existing.id, input);
        toast("Saved.", "success");
        go(`/apps/${existing.id}`);
      } else {
        const created = await createApp(input);
        toast("App added.", "success");
        go(`/apps/${created.id}`);
      }
    } catch (e) {
      const msg = errMsg(e);
      toast(/duplicate key|unique/i.test(msg) ? "An app with this package name already exists." : msg, "error");
      save.disabled = false;
    }
  });
  return form;
}

export const renderAppNew: Screen = (view) => {
  view.append(h("div", { class: "page-head" }, h("h1", {}, "Add app")), buildForm(null));
};

export const renderAppEdit = (id: string): Screen => async (view) => {
  view.appendChild(loading());
  try {
    const app = await getApp(id);
    clear(view);
    view.append(appTabs(app, "edit"), buildForm(app));
  } catch (e) {
    errorState(view, errMsg(e));
  }
};
