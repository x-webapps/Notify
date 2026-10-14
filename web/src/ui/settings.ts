import { importApps, listApps } from "../api";
import { exportApps, parseAppsImport } from "../appsJson";
import { signOut } from "../auth";
import { androidGuide } from "../androidGuide";
import { confirmModal, h, toast } from "../dom";
import { getTheme, setTheme } from "../theme";
import { errMsg, type Screen } from "./common";

export const renderSettings: Screen = (view, ctx) => {
  const themeBtn = h("button", { type: "button", class: "btn btn-ghost" });
  const syncTheme = (): void => {
    themeBtn.textContent = getTheme() === "dark" ? "Switch to light theme" : "Switch to dark theme";
  };
  themeBtn.addEventListener("click", () => {
    setTheme(getTheme() === "dark" ? "light" : "dark");
    syncTheme();
  });
  syncTheme();

  const exportBtn = h("button", { type: "button", class: "btn btn-ghost" }, "Export apps (JSON)");
  exportBtn.addEventListener("click", async () => {
    try {
      const apps = await listApps();
      const blob = new Blob([JSON.stringify(exportApps(apps), null, 2)], { type: "application/json" });
      const a = h("a", { href: URL.createObjectURL(blob), download: "push-admin-apps.json" });
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      toast(`Exported ${apps.length} app(s).`, "success");
    } catch (e) {
      toast(errMsg(e), "error");
    }
  });

  const file = h("input", { type: "file", accept: "application/json,.json", class: "visually-hidden", "aria-label": "Import apps JSON file", tabindex: "-1" });
  const importBtn = h("button", { type: "button", class: "btn btn-ghost" }, "Import apps (JSON)");
  importBtn.addEventListener("click", () => file.click());
  file.addEventListener("change", async () => {
    const f = file.files?.[0];
    file.value = "";
    if (!f) return;
    try {
      if (f.size > 1_000_000) throw new Error("File is too large.");
      const apps = parseAppsImport(await f.text());
      const ok = await confirmModal({
        title: "Import apps?",
        message: `${apps.length} app(s) will be added. Apps with an existing package name are updated.`,
        confirmLabel: "Import",
      });
      if (!ok) return;
      toast(`Imported ${await importApps(apps)} app(s).`, "success");
    } catch (e) {
      toast(errMsg(e), "error");
    }
  });

  // ---- Android integration guide: a self-contained brief to paste into any AI coding agent
  const guideText = androidGuide();
  const guidePre = h("pre", { class: "code guide-pre", tabindex: "0", "aria-label": "Android integration guide" }, guideText);
  const copyGuide = h("button", { type: "button", class: "btn btn-primary" }, "Copy guide");
  copyGuide.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(guideText);
      toast("Guide copied. Paste it into your AI agent.", "success");
    } catch {
      // clipboard blocked: select the text so Ctrl+C works
      const details = guidePre.closest("details");
      details?.setAttribute("open", "");
      const range = document.createRange();
      range.selectNodeContents(guidePre);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      toast("Could not copy automatically. The guide is selected: press Ctrl+C.", "error");
    }
  });
  const guideCard = h(
    "section",
    { class: "card form" },
    h("h2", {}, "Android integration guide"),
    h("p", { class: "muted" },
      "A complete brief for adding push notifications to any Android app so it works with this panel: Firebase setup, link handling, notification channel, foreground service, and the audience / local-time topics. Paste it into an AI coding agent (Claude Code, Cursor, Copilot…) inside the other app's project."),
    h("div", { class: "row" }, copyGuide, h("span", { class: "muted small" }, `${guideText.split("\n").length} lines · Markdown`)),
    h("details", { class: "guide-details" }, h("summary", {}, "Preview the guide"), guidePre),
  );

  const out = h("button", { type: "button", class: "btn btn-danger" }, "Sign out");
  out.addEventListener("click", () => void signOut());

  view.append(
    h("div", { class: "page-head" }, h("h1", {}, "Settings")),
    h("section", { class: "card form" }, h("h2", {}, "Appearance"), h("div", { class: "row" }, themeBtn)),
    h("section", { class: "card form" }, h("h2", {}, "Apps backup"),
      h("p", { class: "muted" }, "Exports contain app definitions only. No keys or secrets are ever included."),
      h("div", { class: "row" }, exportBtn, importBtn, file)),
    guideCard,
    h("section", { class: "card form" }, h("h2", {}, "Account"), h("p", { class: "muted" }, `Signed in as ${ctx.email}`), h("div", { class: "row" }, out)),
  );
};
