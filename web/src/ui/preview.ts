import { h } from "../dom";
import type { AppRec } from "../types";
import { parseHttpUrl } from "../validate";
import { appAvatar } from "./common";

export interface PreviewData {
  appName: string;
  title: string;
  body: string;
  imageUrl: string;
}

/** Approximate Android notification on a lock-screen backdrop. Updates live as the user types. */
export function createPreview(app: Pick<AppRec, "name" | "icon_url">): { el: HTMLElement; update: (d: PreviewData) => void } {
  const appName = h("span", { class: "pv-app" });
  const title = h("div", { class: "pv-title" });
  const body = h("div", { class: "pv-body" });
  const image = h("img", { class: "pv-image", alt: "", referrerpolicy: "no-referrer", hidden: true });
  const el = h(
    "section",
    { class: "preview", "aria-label": "Notification preview" },
    h("h3", {}, "Preview"),
    h(
      "div",
      { class: "pv-phone" },
      h("div", { class: "pv-clock", "aria-hidden": "true" }, "9:41"),
      h(
        "div",
        { class: "pv-card" },
        h("div", { class: "pv-head" }, appAvatar(app, "sm"), appName, h("span", { class: "pv-dot" }, "•"), h("span", {}, "now")),
        title,
        body,
        image,
      ),
    ),
  );
  image.addEventListener("error", () => {
    image.hidden = true;
  });
  return {
    el,
    update(d) {
      appName.textContent = d.appName;
      title.textContent = d.title.trim() || "Notification title";
      body.textContent = d.body.trim() || "Your message appears here.";
      title.classList.toggle("placeholder", !d.title.trim());
      body.classList.toggle("placeholder", !d.body.trim());
      const url = d.imageUrl.trim();
      if (url && /^https:\/\//i.test(url) && parseHttpUrl(url)) {
        if (image.getAttribute("src") !== url) image.setAttribute("src", url);
        image.hidden = false;
      } else {
        image.removeAttribute("src");
        image.hidden = true;
      }
    },
  };
}
