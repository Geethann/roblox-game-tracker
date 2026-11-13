import { createHash } from "node:crypto";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const DEFAULT_API = "https://roblox-game-tracker.roblox-game-tracker-worker.workers.dev";

/**
 * Adds a Content Security Policy to the built page: a list telling browsers
 * exactly where the site may load code, data, images and fonts from. Anything
 * else is refused, which limits the damage if malicious code ever got in.
 * (GitHub Pages can't send custom headers, so it goes in a <meta> tag.)
 */
function contentSecurityPolicy(apiUrl) {
  return {
    name: "content-security-policy",
    apply: "build", // only the real site; the dev server needs looser rules for live reloading
    transformIndexHtml: {
      order: "post", // run last, so the page is in its final form
      handler(html) {
        // The page's one inline script (the light/dark theme) is allowed by its
        // exact fingerprint, so it runs but no other inline script can. The
        // fingerprint is worked out here, so editing that script can't break the policy.
        // Browsers turn Windows line endings (\r\n) into \n while reading a page,
        // before fingerprinting, so we do the same - otherwise a build made on
        // Windows would block its own script.
        const inlineScripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
          .map(([, code]) => code.replace(/\r\n?/g, "\n"))
          .map((code) => `'sha256-${createHash("sha256").update(code).digest("base64")}'`);

        const policy = [
          "default-src 'self'",
          `script-src 'self' ${inlineScripts.join(" ")} https://static.cloudflareinsights.com`,
          "style-src 'self'",
          "img-src 'self' data: https://*.rbxcdn.com",     // game icons come from Roblox's image servers
          "font-src 'self'",
          `connect-src 'self' ${new URL(apiUrl).origin} https://cloudflareinsights.com`,
          "object-src 'none'",
          "base-uri 'self'",
          "form-action 'self'",
          "upgrade-insecure-requests",
        ].join("; ");

        // It must come before any script, so it goes straight after <meta charset>.
        return html.replace(
          '<meta charset="UTF-8" />',
          `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`,
        );
      },
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  return {
    // GitHub Pages serves the site at https://geethann.github.io/roblox-game-tracker/,
    // so every link and file path needs that folder in front of it.
    base: "/roblox-game-tracker/",
    plugins: [react(), contentSecurityPolicy(process.env.VITE_API_URL || env.VITE_API_URL || DEFAULT_API)],
  };
});
