import { h } from "../dom";
import { VARIABLES } from "../variables";

type TextField = HTMLInputElement | HTMLTextAreaElement;

const EMOJIS = [
  "🎉", "🔥", "✨", "🚀", "🎁", "💥", "⭐", "🌟", "💡", "📣", "🔔", "🆕", "✅", "⚡", "🏆", "💎",
  "❤️", "😍", "😎", "🙌", "👏", "👍", "🤩", "😊", "🥳", "😉", "🤗", "🙏", "💪", "👀", "🎯", "🎨",
  "📱", "🖼️", "🌈", "☀️", "🌙", "🍀", "🎶", "📅", "⏰", "⏳", "🛠️", "🔒", "💬", "📌", "➡️", "🔗",
];

/** Inserts text at the caret, respecting the field's maxlength. */
export function insertAtCaret(el: TextField, text: string): void {
  const max = el.maxLength > 0 ? el.maxLength : Infinity;
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? start;
  const room = max - (el.value.length - (end - start));
  if (room <= 0) return;
  const piece = [...text].length <= room ? text : "";
  if (!piece) return;
  el.setRangeText(piece, start, end, "end");
  el.focus();
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Toolbar with an emoji popover and variable chips; inserts into the last-focused field. */
export function insertToolbar(fields: TextField[]): HTMLElement {
  let target: TextField | undefined = fields[fields.length - 1];
  for (const f of fields) f.addEventListener("focus", () => (target = f));

  const pop = h("div", { class: "emoji-pop", hidden: true, role: "group", "aria-label": "Emoji" });
  for (const e of EMOJIS) {
    const b = h("button", { type: "button", class: "emoji-btn", "aria-label": `Insert ${e}` }, e);
    b.addEventListener("click", () => target && insertAtCaret(target, e));
    pop.appendChild(b);
  }
  const toggle = h("button", { type: "button", class: "btn btn-ghost btn-sm", "aria-expanded": "false" }, "😊 Emoji");
  toggle.addEventListener("click", () => {
    pop.hidden = !pop.hidden;
    toggle.setAttribute("aria-expanded", String(!pop.hidden));
  });

  const chips = VARIABLES.map((v) => {
    const b = h("button", { type: "button", class: "chip", title: "Filled in when the notification is sent" }, v);
    b.addEventListener("click", () => target && insertAtCaret(target, v));
    return b;
  });

  return h("div", { class: "insert-bar" }, h("div", { class: "row" }, toggle, h("span", { class: "muted small" }, "Variables:"), ...chips), pop);
}
