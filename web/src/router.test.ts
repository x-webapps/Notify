import { describe, expect, it } from "vitest";
import { parseHash } from "./router";

const id = "123e4567-e89b-12d3-a456-426614174000";

describe("parseHash", () => {
  it("routes the basics", () => {
    expect(parseHash("").name).toBe("dashboard");
    expect(parseHash("#/").name).toBe("dashboard");
    expect(parseHash("#/apps").name).toBe("apps");
    expect(parseHash("#/settings").name).toBe("settings");
    expect(parseHash("#/apps/new").name).toBe("app-new");
  });

  it("routes app screens", () => {
    expect(parseHash(`#/apps/${id}`)).toMatchObject({ name: "compose", id });
    expect(parseHash(`#/apps/${id}/edit`)).toMatchObject({ name: "app-edit", id });
    expect(parseHash(`#/apps/${id}/history`)).toMatchObject({ name: "history", id });
    expect(parseHash(`#/apps/${id}/templates`)).toMatchObject({ name: "templates", id });
    expect(parseHash(`#/apps/${id}/audience`)).toMatchObject({ name: "audience", id });
  });

  it("parses query strings and rejects junk", () => {
    const r = parseHash(`#/apps/${id}?template=abc`);
    expect(r.name === "compose" && r.query.get("template")).toBe("abc");
    expect(parseHash("#/apps/nope").name).toBe("not-found");
    expect(parseHash("#/whatever").name).toBe("not-found");
  });
});
