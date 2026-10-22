export type Route =
  | { name: "dashboard" }
  | { name: "apps" }
  | { name: "app-new" }
  | { name: "app-edit"; id: string }
  | { name: "compose"; id: string; query: URLSearchParams }
  | { name: "history"; id: string }
  | { name: "templates"; id: string }
  | { name: "audience"; id: string }
  | { name: "recurring"; id: string }
  | { name: "settings" }
  | { name: "not-found" };

/** Parses "#/apps/<id>/history?x=y" style hashes. */
export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, "") || "/";
  const [path = "/", search = ""] = raw.split("?", 2);
  const parts = path.split("/").filter(Boolean);
  const query = new URLSearchParams(search);

  if (parts.length === 0) return { name: "dashboard" };
  if (parts[0] === "settings" && parts.length === 1) return { name: "settings" };
  if (parts[0] === "apps") {
    if (parts.length === 1) return { name: "apps" };
    if (parts[1] === "new" && parts.length === 2) return { name: "app-new" };
    const id = parts[1];
    if (id && /^[0-9a-f-]{36}$/i.test(id)) {
      if (parts.length === 2) return { name: "compose", id, query };
      if (parts.length === 3 && parts[2] === "edit") return { name: "app-edit", id };
      if (parts.length === 3 && parts[2] === "history") return { name: "history", id };
      if (parts.length === 3 && parts[2] === "templates") return { name: "templates", id };
      if (parts.length === 3 && parts[2] === "audience") return { name: "audience", id };
      if (parts.length === 3 && parts[2] === "recurring") return { name: "recurring", id };
    }
  }
  return { name: "not-found" };
}

export function go(path: string): void {
  window.location.hash = path.startsWith("#") ? path : `#${path}`;
}
