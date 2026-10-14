import { defineConfig, loadEnv, type Plugin } from "vite";

// Site is served from https://<user>.github.io/<repo>/ . Set VITE_BASE=/<repo>/ at build time
// (the deploy workflow derives it from the repository name). Local dev uses "/".
function productionPage(supabaseUrl: string, base: string): Plugin {
  return {
    name: "production-page",
    apply: "build",
    transformIndexHtml(html) {
      // GitHub Pages cannot send headers, so the CSP is a <meta> tag (production build only,
      // because the dev server needs inline HMR scripts and websockets).
      const csp = [
        "default-src 'none'",
        "script-src 'self'",
        "style-src 'self'",
        "img-src 'self' https: data:",
        `connect-src 'self' ${supabaseUrl}`,
        "base-uri 'none'",
        "form-action 'none'",
      ].join("; ");
      return html.replace("<!--CSP-->", `<meta http-equiv="Content-Security-Policy" content="${csp}" />`);
    },
    generateBundle() {
      // GitHub Pages serves 404.html for unknown paths; hash routing means this is only a safety net.
      this.emitFile({
        type: "asset",
        fileName: "404.html",
        source: `<!doctype html><html lang="en"><head><meta charset="utf-8" />` +
          `<meta name="viewport" content="width=device-width, initial-scale=1" />` +
          `<meta name="robots" content="noindex" /><meta http-equiv="refresh" content="0; url=${base}" />` +
          `<title>Not found</title></head><body><p>Page not found. <a href="${base}">Go to the admin panel</a>.</p></body></html>`,
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "VITE_");
  const base = env.VITE_BASE || "/";
  const supabaseUrl = env.VITE_SUPABASE_URL || "";
  return {
    base,
    plugins: [productionPage(supabaseUrl, base)],
    build: { outDir: "dist", sourcemap: false },
    test: { environment: "node" },
  };
});
