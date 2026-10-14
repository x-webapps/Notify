import { describe, expect, it } from "vitest";
import { renderVariables, safeTimeZone } from "./variables";

const now = new Date("2026-10-14T20:30:00Z");

describe("variables", () => {
  it("resolves in the given time zone", () => {
    expect(renderVariables("{app_name} on {date}", { appName: "Glass", now, tz: "UTC" })).toBe("Glass on Oct 14, 2026");
    expect(renderVariables("{day} {time}", { appName: "x", now, tz: "Asia/Kolkata" })).toBe("Thursday 2:00 AM");
  });

  it("leaves unknown placeholders and falls back to UTC", () => {
    expect(renderVariables("{nope} {app_name}", { appName: "A", now })).toBe("{nope} A");
    expect(safeTimeZone("Not/AZone")).toBe("UTC");
  });
});
