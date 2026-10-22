import { describe, expect, it } from "vitest";
import { loadDevices, MAX_DEVICES, removeDevice, saveDevices, upsertDevice, type StoreLike } from "./testDevices";

const TOKEN_A = "a".repeat(30);
const TOKEN_B = "b:".repeat(20);

function memory(initial: Record<string, string> = {}): StoreLike & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => void (data[k] = v),
    removeItem: (k) => void delete data[k],
  };
}

describe("upsertDevice", () => {
  it("adds, then replaces by name (case-insensitive)", () => {
    const a = upsertDevice([], "My phone", TOKEN_A);
    expect(a.list).toEqual([{ name: "My phone", token: TOKEN_A }]);
    const b = upsertDevice(a.list, "my PHONE", TOKEN_B);
    expect(b.list).toEqual([{ name: "My phone", token: TOKEN_B }]);
  });

  it("rejects an empty name, a bad token and a full list", () => {
    expect(upsertDevice([], " ", TOKEN_A).error).toBeTruthy();
    expect(upsertDevice([], "x", "short").error).toBeTruthy();
    const full = Array.from({ length: MAX_DEVICES }, (_, i) => ({ name: `d${i}`, token: TOKEN_A }));
    expect(upsertDevice(full, "one more", TOKEN_A).error).toMatch(/up to/);
    expect(upsertDevice(full, "d3", TOKEN_B).error).toBeUndefined(); // replacing is fine when full
  });
});

describe("storage", () => {
  it("round-trips and removes", () => {
    const store = memory();
    saveDevices(store, "app1", [{ name: "A", token: TOKEN_A }]);
    expect(loadDevices(store, "app1")).toEqual([{ name: "A", token: TOKEN_A }]);
    expect(loadDevices(store, "app2")).toEqual([]);
    expect(removeDevice([{ name: "A", token: TOKEN_A }], "a")).toEqual([]);
    saveDevices(store, "app1", []);
    expect(Object.keys(store.data)).toEqual([]);
  });

  it("picks up the old single-token value once", () => {
    const store = memory({ "testToken:app1": TOKEN_A });
    expect(loadDevices(store, "app1")).toEqual([{ name: "My device", token: TOKEN_A }]);
    saveDevices(store, "app1", loadDevices(store, "app1"));
    expect(store.data["testToken:app1"]).toBeUndefined();
    expect(loadDevices(store, "app1")).toHaveLength(1);
  });

  it("survives corrupt data and missing storage", () => {
    expect(loadDevices(memory({ "testDevices:app1": "{nope" }), "app1")).toEqual([]);
    expect(loadDevices(memory({ "testDevices:app1": JSON.stringify([{ name: 1 }, null, { name: "ok", token: TOKEN_A }]) }), "app1"))
      .toEqual([{ name: "ok", token: TOKEN_A }]);
    expect(loadDevices(undefined, "app1")).toEqual([]);
    expect(() => saveDevices(undefined, "app1", [{ name: "A", token: TOKEN_A }])).not.toThrow();
  });
});
