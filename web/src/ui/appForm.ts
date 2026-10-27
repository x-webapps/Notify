import { checkAppConnection, createApp, deleteApp, getApp, removeAppKey, saveAppKey, updateApp } from "../api";
import { KEY_MAX_BYTES, readServiceKey } from "../serviceKey";
import { clear, confirmModal, field, h, toast } from "../dom";
import { go } from "../router";
import type { AppInput, AppRec } from "../types";
import { FCM_PROJECT_RE, isValidTopic, parseDomainList, parseHttpUrl, playStoreUrl, SECRET_NAME_RE, validateImage } from "../validate";
import { appAvatar, appTabs, errMsg, errorState, loading, type Screen } from "./common";

export function buildForm(existing: AppRec | null): HTMLElement {
  const name = h("input", { type: "text", maxlength: 80, required: true, value: existing?.name ?? "" });
  const pkg = h("input", { type: "text", maxlength: 200, required: true, value: existing?.package_name ?? "", placeholder: "com.example.app", autocapitalize: "off", spellcheck: "false" });
  const project = h("input", { type: "text", required: true, value: existing?.fcm_project_id ?? "", placeholder: "my-app-12345", autocapitalize: "off", spellcheck: "false" });
  const icon = h("input", { type: "text", inputmode: "url", value: existing?.icon_url ?? "", placeholder: "https://…/icon.png", spellcheck: "false", autocomplete: "off" });
  const appUrl = h("input", { type: "text", inputmode: "url", value: existing?.app_url ?? "", spellcheck: "false", autocomplete: "off" });
  const topic = h("input", { type: "text", value: existing?.default_topic ?? "", placeholder: "com.example.app", autocapitalize: "off", spellcheck: "false" });
  const channel = h("input", { type: "text", maxlength: 100, value: existing?.channel_id ?? "app_updates_channel" });
  const secret = h("input", { type: "text", value: existing?.secret_key ?? "", placeholder: "FCM_SERVICE_ACCOUNT_MYAPP", autocapitalize: "characters", spellcheck: "false" });
  const allow = h("textarea", { rows: 3, placeholder: "example.com\nmy-site.io" }, (existing?.url_allowlist ?? []).join("\n"));

  const fName = field("App name", name);
  const fPkg = field("Package name", pkg);
  const fProject = field("FCM project ID", project, { hint: "Filled in automatically when you choose a key file. Otherwise: Firebase console → Project settings → Project ID." });

  // ---- Service account key: pick the file downloaded from Firebase; the server checks and stores it encrypted.
  let pendingKey: string | null = null;
  const keyFile = h("input", { type: "file", accept: "application/json,.json", class: "visually-hidden", "aria-label": "Service account key file (JSON)", tabindex: "-1" });
  const keyBtn = h("button", { type: "button", class: "btn btn-ghost" }, existing?.has_credential ? "Replace key file" : "Choose key file");
  const keyStatus = h("p", { class: "hint", "aria-live": "polite" });
  const showStored = (): void => {
    keyStatus.textContent = existing?.has_credential
      ? `Key stored for ${existing.credential_email ?? "this app"}. It is encrypted and never shown again.`
      : "No key yet. Without one, this app sends through the server’s central account.";
  };
  showStored();
  keyBtn.addEventListener("click", () => keyFile.click());
  keyFile.addEventListener("change", async () => {
    const f = keyFile.files?.[0];
    keyFile.value = "";
    if (!f) return;
    try {
      if (f.size > KEY_MAX_BYTES) throw new Error("That file is too large to be a service account key.");
      const text = await f.text();
      const info = readServiceKey(text);
      pendingKey = text;
      project.value = info.projectId;
      keyStatus.textContent = `Ready: ${info.email} (project ${info.projectId}). It is checked with Firebase when you save.`;
    } catch (e) {
      pendingKey = null;
      showStored();
      toast(errMsg(e), "error");
    }
  });
  const keyRow = h("div", { class: "row" }, keyBtn, keyFile);
  if (existing?.has_credential) {
    const rm = h("button", { type: "button", class: "btn btn-ghost" }, "Remove key");
    rm.addEventListener("click", async () => {
      const ok = await confirmModal({
        title: "Remove the stored key?",
        message: "This app will fall back to the server’s central account until you upload a new key.",
        confirmLabel: "Remove key",
        danger: true,
      });
      if (!ok) return;
      try {
        await removeAppKey(existing.id);
        toast("Key removed.", "success");
        go(`/apps/${existing.id}/edit`);
      } catch (e) {
        toast(errMsg(e), "error");
      }
    });
    keyRow.appendChild(rm);
  }
  const keyCard = h("div", { class: "form" },
    h("label", {}, "Firebase service account key"),
    h("p", { class: "hint" }, "Firebase console → Project settings → Service accounts → Generate new private key. Choose the downloaded .json file here. That is all the setup this app needs."),
    keyRow,
    keyStatus,
  );
  const iconPreview = h("div", { class: "icon-preview" });
  const fIcon = field("App icon URL (optional)", icon, { hint: "A direct https:// link to a square PNG/JPG. Shown on cards and in the preview." });
  const fAppUrl = field("App URL (optional)", appUrl, { hint: "Detected automatically from the package name when left empty." });
  const syncAuto = (): void => {
    appUrl.placeholder = pkg.value.trim() ? playStoreUrl(pkg.value) : "https://play.google.com/store/apps/details?id=…";
    clear(iconPreview);
    iconPreview.appendChild(appAvatar({ name: name.value || "?", icon_url: icon.value.trim() || null }, "md"));
  };
  for (const el of [name, pkg, icon]) el.addEventListener("input", syncAuto);
  syncAuto();
  // A new app's topic follows the package name until it is edited by hand.
  let topicEdited = !!existing;
  topic.addEventListener("input", () => { topicEdited = true; });
  pkg.addEventListener("input", () => { if (!topicEdited) topic.value = pkg.value.trim(); });
  const fTopic = field("Default topic", topic, { hint: "The topic every user subscribes to. Filled from the package name; the app must subscribe to the same name." });
  const fChannel = field("Notification channel ID", channel, { hint: "Must match the channel created in the Android app." });
  const fSecret = field("Server secret name (advanced, optional)", secret, {
    hint: "Only used when no key file is uploaded. Leave empty to use the central FCM_SERVICE_ACCOUNT. Only the secret NAME goes here, never the key itself.",
  });
  const advanced = h("details", { class: "guide-details" }, h("summary", {}, "Advanced: use a server secret instead"), fSecret.wrap);
  if (existing?.secret_key) advanced.setAttribute("open", "");
  const fAllow = field("Allowed link domains (optional)", allow, {
    hint: "One per line. If set, notification links must be on one of these domains (or subdomains).",
  });

  const save = h("button", { type: "submit", class: "btn btn-primary" }, existing ? "Save changes" : "Add app");
  const form = h("form", { class: "card form", novalidate: true });
  form.append(fName.wrap, fPkg.wrap, keyCard, fProject.wrap, h("div", { class: "icon-row" }, iconPreview, fIcon.wrap), fAppUrl.wrap, fTopic.wrap, fChannel.wrap, advanced, fAllow.wrap);

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
        go("/apps");
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
      default_topic: topic.value.trim() || pkg.value.trim(),
      channel_id: channel.value.trim() || "app_updates_channel",
      secret_key: secret.value.trim() || null,
      url_allowlist: parseDomainList(allow.value),
      icon_url: icon.value.trim() || null,
      app_url: appUrl.value.trim() || null,
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
    const iconErr = validateImage(input.icon_url);
    const appUrlErr = input.app_url && !parseHttpUrl(input.app_url) ? "App URL must be a valid http(s) link." : undefined;
    fIcon.setError(iconErr ?? undefined);
    fAppUrl.setError(appUrlErr);
    if (Object.values(errs).some(Boolean) || iconErr || appUrlErr) return;

    save.disabled = true;
    try {
      let id: string;
      if (existing) {
        await updateApp(existing.id, input);
        id = existing.id;
      } else {
        id = (await createApp(input)).id;
      }
      if (pendingKey) {
        // The app is saved either way; a rejected key leaves the user on the edit page to retry.
        const r = await saveAppKey(id, pendingKey);
        if (!r.ok) {
          toast(`Saved, but the key was not accepted: ${[r.error, r.hint].filter(Boolean).join(" ")}`, "error");
          go(`/apps/${id}/edit`);
          return;
        }
        toast("Saved. Key connected.", "success");
      } else {
        toast(existing ? "Saved." : "App added.", "success");
      }
      go(`/apps/${id}`);
    } catch (e) {
      const msg = errMsg(e);
      toast(/duplicate key|unique/i.test(msg) ? "An app with this package name already exists." : msg, "error");
      save.disabled = false;
    }
  });
  return form;
}

/** "Check connection" card: dry-run against FCM using the saved settings. */
function connectionCard(app: AppRec): HTMLElement {
  const out = h("div", { "aria-live": "polite" });
  const btn = h("button", { type: "button", class: "btn btn-ghost" }, "Check connection");
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    clear(out);
    out.appendChild(loading("Checking with Firebase…"));
    try {
      const r = await checkAppConnection(app.id);
      clear(out);
      const lines: (HTMLElement | null)[] = [];
      if (r.ok) {
        lines.push(h("strong", {}, "Connected"));
        lines.push(h("p", {}, `Firebase project “${r.project_id}” accepts messages from this panel.`));
      } else {
        lines.push(h("strong", {}, "Not connected"));
        lines.push(h("p", {}, r.error ?? "Unknown error."));
        if (r.hint) lines.push(h("p", {}, r.hint));
      }
      if (r.service_account_email) {
        lines.push(h("p", { class: "muted" }, "Service account used: ", h("span", { class: "mono" }, r.service_account_email)));
        if (!r.ok) lines.push(h("p", { class: "muted" }, "In that Firebase project, grant this account the “Firebase Cloud Messaging API Admin” role. Step-by-step terminal commands (including gcloud login) are in Settings → Server-side setup."));
      }
      out.appendChild(h("div", { class: `result ${r.ok ? "result-ok" : "result-error"}`, role: "status" }, ...lines));
    } catch (e) {
      clear(out);
      out.appendChild(h("div", { class: "result result-error", role: "alert" }, errMsg(e)));
    } finally {
      btn.disabled = false;
    }
  });
  return h(
    "div",
    { class: "card form" },
    h("h2", {}, "Connection"),
    h("p", { class: "hint" }, "Dry-run with Google using the saved settings. Nothing is sent. It confirms the project ID, the FCM API and the service account permission. It can’t tell whether the app is installed on a device."),
    h("div", { class: "row" }, btn),
    out,
  );
}

export const renderAppNew: Screen = (view) => {
  view.append(h("div", { class: "page-head" }, h("h1", {}, "Add app")), buildForm(null));
};

export const renderAppEdit = (id: string): Screen => async (view) => {
  view.appendChild(loading());
  try {
    const app = await getApp(id);
    clear(view);
    view.append(appTabs(app, "edit"), connectionCard(app), buildForm(app));
  } catch (e) {
    errorState(view, errMsg(e));
  }
};
