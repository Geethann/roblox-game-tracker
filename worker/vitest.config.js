// Settings for the backend tests (run with `npm test`).
// Cloudflare's Vitest plugin runs the tests inside the real Workers runtime,
// with a local, throwaway database, so they behave like the live backend
// without touching it.
import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  // The same database migrations the live database uses, so the test database
  // always has exactly the live tables.
  const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: { TEST_MIGRATIONS: migrations },
          // The test runtime can be a little older than the live one. If it
          // doesn't know wrangler.jsonc's compatibility date yet, set this to
          // the newest date it supports (the error message names it).
          compatibilityDate: "2026-10-30",
        },
      }),
    ],
    test: { setupFiles: ["./test/apply-migrations.js"] },
  };
});
