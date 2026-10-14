// Small inline SVG icons. The markup below is static (authored here, never user data).

const PATHS = {
  bell: "M12 3a6 6 0 0 0-6 6v3.6L4.3 15.4A1 1 0 0 0 5.2 17h13.6a1 1 0 0 0 .9-1.6L18 12.6V9a6 6 0 0 0-6-6Zm-2.2 15a2.2 2.2 0 0 0 4.4 0H9.8Z",
  plus: "M12 5v14M5 12h14",
  external: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
  send: "M21 3 10 14M21 3l-7 18-4-7-7-4 18-7Z",
} as const;

export type IconName = keyof typeof PATHS;

export function icon(name: IconName, size = 18): SVGElement {
  const filled = name === "bell";
  const svg = new DOMParser().parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" focusable="false" ` +
      `fill="${filled ? "currentColor" : "none"}" stroke="${filled ? "none" : "currentColor"}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
      `<path d="${PATHS[name]}"/></svg>`,
    "image/svg+xml",
  ).documentElement as unknown as SVGElement;
  return document.importNode(svg, true) as SVGElement;
}
