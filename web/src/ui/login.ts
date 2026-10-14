import { signInWithGoogle } from "../auth";
import { clear, h, toast } from "../dom";
import { errMsg } from "./common";

export function renderLogin(root: HTMLElement, notice?: string): void {
  clear(root);
  const btn = h("button", { type: "button", class: "btn btn-primary btn-lg" }, "Sign in with Google");
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    try {
      await signInWithGoogle();
    } catch (e) {
      toast(errMsg(e), "error");
      btn.disabled = false;
    }
  });
  root.appendChild(
    h(
      "main",
      { class: "login" },
      h(
        "div",
        { class: "card login-card" },
        h("div", { class: "logo", "aria-hidden": "true" }, "🔔"),
        h("h1", {}, "Push Admin"),
        h("p", { class: "muted" }, "Send push notifications to your Android apps."),
        notice ? h("p", { class: "state state-error", role: "alert" }, notice) : null,
        btn,
        h("p", { class: "hint" }, "Only approved Google accounts can sign in."),
      ),
    ),
  );
}
