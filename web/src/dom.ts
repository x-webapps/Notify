// Tiny DOM helpers. All text goes through textContent / setAttribute, never innerHTML.

export type Child = Node | string | number | null | undefined | false;
export type Attrs = Record<string, string | number | boolean | null | undefined | ((e: Event) => void)>;

const PROPS = new Set(["value", "checked", "disabled", "selected", "readOnly", "required"]);

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, val] of Object.entries(attrs)) {
    if (val == null || val === false) continue;
    if (key.startsWith("on") && typeof val === "function") {
      el.addEventListener(key.slice(2).toLowerCase(), val);
    } else if (key === "class") {
      el.className = String(val);
    } else if (PROPS.has(key)) {
      (el as unknown as Record<string, unknown>)[key] = val;
    } else {
      el.setAttribute(key, val === true ? "" : String(val));
    }
  }
  append(el, children);
  return el;
}

export function append(parent: Node, children: Child[]): void {
  for (const c of children) {
    if (c == null || c === false) continue;
    parent.appendChild(typeof c === "object" ? c : document.createTextNode(String(c)));
  }
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

// ---------------------------------------------------------------- toasts
let toastHost: HTMLElement | null = null;

export function toast(message: string, kind: "info" | "success" | "error" = "info"): void {
  if (!toastHost) {
    toastHost = h("div", { class: "toasts", "aria-live": "polite", role: "status" });
    document.body.appendChild(toastHost);
  }
  const el = h("div", { class: `toast toast-${kind}` }, message);
  toastHost.appendChild(el);
  window.setTimeout(() => el.remove(), kind === "error" ? 9000 : 4000);
}

// ---------------------------------------------------------------- modal
export interface ModalButton {
  label: string;
  kind?: "primary" | "danger" | "ghost";
  /** Return false to keep the modal open. */
  onClick?: () => boolean | void | Promise<boolean | void>;
}

export function showModal(title: string, content: Node, buttons: ModalButton[]): () => void {
  const previous = document.activeElement as HTMLElement | null;
  const overlay = h("div", { class: "overlay" });
  const dialog = h("div", { class: "modal", role: "dialog", "aria-modal": "true", "aria-label": title });
  const close = (): void => {
    overlay.remove();
    document.removeEventListener("keydown", onKey, true);
    previous?.focus?.();
  };
  const row = h("div", { class: "modal-actions" });
  for (const b of buttons) {
    const btn = h("button", { type: "button", class: `btn btn-${b.kind ?? "ghost"}` }, b.label);
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        const keep = b.onClick ? await b.onClick() : undefined;
        if (keep !== false) close();
      } finally {
        btn.disabled = false;
      }
    });
    row.appendChild(btn);
  }
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    } else if (e.key === "Tab") {
      const f = [...dialog.querySelectorAll<HTMLElement>("button, input, select, textarea, a[href]")]
        .filter((x) => !x.hasAttribute("disabled"));
      const first = f[0];
      const last = f[f.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener("keydown", onKey, true);
  append(dialog, [h("h2", {}, title), content, row]);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  const firstField = dialog.querySelector<HTMLElement>("input, textarea, select") ??
    dialog.querySelector<HTMLElement>(".modal-actions button:last-child");
  firstField?.focus();
  return close;
}

export function confirmModal(opts: {
  title: string;
  message: Node | string;
  confirmLabel: string;
  danger?: boolean;
}): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v: boolean): void => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    const body = typeof opts.message === "string" ? h("p", {}, opts.message) : opts.message;
    showModal(opts.title, body, [
      { label: "Cancel", kind: "ghost", onClick: () => done(false) },
      { label: opts.confirmLabel, kind: opts.danger ? "danger" : "primary", onClick: () => done(true) },
    ]);
    // Closing via Esc / backdrop resolves as cancel.
    const watcher = window.setInterval(() => {
      if (!document.querySelector(".overlay")) {
        window.clearInterval(watcher);
        done(false);
      }
    }, 200);
  });
}

// ---------------------------------------------------------------- form helpers
export function field(
  label: string,
  control: HTMLElement,
  opts: { hint?: string; id?: string } = {},
): { wrap: HTMLElement; error: HTMLElement; setError: (msg: string | undefined) => void } {
  const id = opts.id ?? `f_${Math.random().toString(36).slice(2, 9)}`;
  control.id = id;
  const error = h("div", { class: "field-error", role: "alert" });
  const hint = opts.hint ? h("div", { class: "hint", id: `${id}_hint` }, opts.hint) : null;
  if (hint) control.setAttribute("aria-describedby", `${id}_hint`);
  const wrap = h("div", { class: "field" }, h("label", { for: id }, label), control, hint, error);
  return {
    wrap,
    error,
    setError(msg) {
      error.textContent = msg ?? "";
      control.toggleAttribute("aria-invalid", Boolean(msg));
    },
  };
}
