import { h } from "../dom";
import { parseHttpUrl } from "../validate";

export interface PreviewData {
  appName: string;
  title: string;
  body: string;
  imageUrl: string;
}

/** Approximate Android notification (collapsed/expanded look). Updates live as the user types. */
export function createPreview(): { el: HTMLElement; update: (d: PreviewData) => void } {
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
      { class: "pv-card" },
      h(
        "div",
        { class: "pv-head" },
        h("span", { class: "pv-icon", "aria-hidden": "true" }, "🔔"),
        appName,
        h("span", { class: "pv-dot" }, "•"),
        h("span", { class: "pv-time" }, "now"),
      ),
      title,
      body,
      image,
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
