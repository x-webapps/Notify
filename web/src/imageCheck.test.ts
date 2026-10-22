import { describe, expect, it } from "vitest";
import { adviceFor, imageLinkWarning, imageSizeWarning } from "./imageCheck";

describe("imageLinkWarning", () => {
  it("flags formats that do not work in notifications", () => {
    expect(imageLinkWarning("https://cdn.example.com/a.gif")).toMatch(/GIF/);
    expect(imageLinkWarning("https://cdn.example.com/a.GIF?x=1")).toMatch(/GIF/);
    expect(imageLinkWarning("https://cdn.example.com/a.svg")).toMatch(/SVG/);
    expect(imageLinkWarning("https://cdn.example.com/a?format=gif")).toMatch(/GIF/);
  });

  it("flags page links on known hosts, but not their direct image hosts", () => {
    expect(imageLinkWarning("https://imgur.com/AbC123")).toMatch(/web page/);
    expect(imageLinkWarning("https://postimg.cc/xyz")).toMatch(/web page/);
    expect(imageLinkWarning("https://i.imgur.com/AbC123.png")).toBeNull();
    expect(imageLinkWarning("https://i.postimg.cc/9fvNvd1d/shot.jpg")).toBeNull();
    expect(imageLinkWarning("https://imgur.com/AbC123.png")).toBeNull();
  });

  it("accepts normal image links and ignores malformed ones", () => {
    expect(imageLinkWarning("https://cdn.example.com/banner.png")).toBeNull();
    expect(imageLinkWarning("https://cdn.example.com/banner")).toBeNull();
    expect(imageLinkWarning("not a url")).toBeNull();
  });
});

describe("imageSizeWarning", () => {
  it("warns only for very large pixel counts", () => {
    expect(imageSizeWarning(1200, 600)).toBeNull();
    expect(imageSizeWarning(2000, 2000)).toBeNull();
    expect(imageSizeWarning(4000, 3000)).toMatch(/4000×3000/);
  });
});

describe("adviceFor", () => {
  it("returns nothing without a link", () => {
    expect(adviceFor("  ", null)).toBeNull();
  });

  it("combines the link check with the load result", () => {
    expect(adviceFor("https://x.io/a.gif", { ok: true, width: 10, height: 10 })).toMatchObject({ problem: true });
    expect(adviceFor("https://x.io/a.png", null)).toMatchObject({ problem: false, note: expect.stringContaining("Checking") });
    expect(adviceFor("https://x.io/a.png", { ok: false })).toMatchObject({ problem: true });
    expect(adviceFor("https://x.io/a.png", { ok: true, width: 4000, height: 3000 })).toMatchObject({ problem: true });
    expect(adviceFor("https://x.io/a.png", { ok: true, width: 1200, height: 600 })).toEqual({ note: "Image loads (1200×600).", problem: false });
  });
});
