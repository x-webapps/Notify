// Advice about a notification image link, before anything is sent.
// A browser cannot read the size or type of a third-party image (CORS, and the panel's CSP blocks fetching it),
// so this checks what it can: the file extension, whether the link looks like a web page, and whether the
// image actually loads (and how many pixels it has, as a rough stand-in for the 1 MB limit).

const BAD_FORMATS: Record<string, string> = {
  gif: "GIFs do not animate in notifications and may not show at all. Use a JPG, PNG or WebP.",
  svg: "SVG images are not supported in notifications. Use a JPG, PNG or WebP.",
  avif: "AVIF is not supported on many Android versions. Use a JPG, PNG or WebP.",
  heic: "HEIC is not supported. Use a JPG, PNG or WebP.",
  ico: "ICO is not supported. Use a JPG, PNG or WebP.",
  bmp: "BMP is not supported reliably. Use a JPG, PNG or WebP.",
};

/** Hosts whose normal links are web pages. Their direct image links use another host (i.imgur.com, i.postimg.cc, ...). */
const PAGE_HOSTS = ["imgur.com", "postimg.cc", "drive.google.com", "photos.google.com", "dropbox.com", "pinterest.com", "instagram.com", "flickr.com", "unsplash.com", "pexels.com"];

const PIXEL_WARN = 4_000_000; // about 2000 x 2000: usually over FCM's 1 MB limit unless heavily compressed

function parse(url: string): URL | null {
  try {
    return new URL(url.trim());
  } catch {
    return null;
  }
}

/** Problems visible from the link alone. Null when nothing looks wrong. */
export function imageLinkWarning(raw: string): string | null {
  const u = parse(raw);
  if (!u) return null; // a malformed link is reported by the normal validation
  const ext = /\.([a-z0-9]{2,5})$/i.exec(u.pathname)?.[1]?.toLowerCase();
  const fmt = (u.searchParams.get("format") ?? u.searchParams.get("fm") ?? "").toLowerCase();
  const kind = ext && BAD_FORMATS[ext] ? ext : BAD_FORMATS[fmt] ? fmt : null;
  if (kind) return BAD_FORMATS[kind] ?? null;
  const host = u.hostname.toLowerCase();
  const isPageHost = PAGE_HOSTS.some((p) => host === p || host === `www.${p}`);
  if (isPageHost && !ext) return "This looks like a web page, not a direct image link. Open the image on its own and copy that link (it usually ends in .jpg, .png or .webp).";
  return null;
}

/** A warning for images with a lot of pixels, which probably exceed the 1 MB limit. */
export function imageSizeWarning(width: number, height: number): string | null {
  return width * height > PIXEL_WARN
    ? `This image is ${width}×${height}. Large images often exceed the 1 MB limit and then do not show. Try about 1200×600.`
    : null;
}

export type ImageProbe = { ok: true; width: number; height: number } | { ok: false };

/** Loads the image in the browser. Resolves (never rejects) with its size, or ok:false if it cannot be shown. */
export function probeImage(url: string, timeoutMs = 8000): Promise<ImageProbe> {
  return new Promise((resolve) => {
    const img = new Image();
    const timer = window.setTimeout(() => {
      img.src = "";
      resolve({ ok: false });
    }, timeoutMs);
    img.onload = () => {
      window.clearTimeout(timer);
      resolve({ ok: true, width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      window.clearTimeout(timer);
      resolve({ ok: false });
    };
    img.referrerPolicy = "no-referrer";
    img.src = url;
  });
}

export interface ImageAdvice {
  /** Shown under the image field. */
  note: string;
  /** True when sending this image will probably not show a picture. */
  problem: boolean;
}

export function adviceFor(url: string, probe: ImageProbe | null): ImageAdvice | null {
  if (!url.trim()) return null;
  const link = imageLinkWarning(url);
  if (link) return { note: link, problem: true };
  if (probe === null) return { note: "Checking the image…", problem: false };
  if (!probe.ok) return { note: "The image could not be loaded. Check the link: it must be a public, direct image address.", problem: true };
  const size = imageSizeWarning(probe.width, probe.height);
  if (size) return { note: size, problem: true };
  return { note: `Image loads (${probe.width}×${probe.height}).`, problem: false };
}
