// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { createRequire } from "node:module";
import path from "node:path";

import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { loadEnv } from "vite";

// Server routes (e.g. transactional email) need non-VITE_ env vars in process.env.
const serverEnv = loadEnv(process.env["NODE_ENV"] === "production" ? "production" : "development", process.cwd(), "");
Object.assign(process.env, serverEnv);

// `entities` (pulled in by @react-email/render) must resolve to real files.
// Resolve through Node instead of hardcoding node_modules paths so the build works
// with any installer layout (hoisted or symlinked/nested).
const require = createRequire(import.meta.url);
// entities' "exports" map hides ./package.json, so resolve the CJS entry (lib/index.js)
// and walk up one level to get the package root.
const entitiesDir = path.resolve(path.dirname(require.resolve("entities")), "..");


export default defineConfig({
  vite: {
    resolve: {
      alias: {
        "entities/lib/decode.js": path.join(entitiesDir, "lib/decode.js"),
        "entities/lib/encode.js": path.join(entitiesDir, "lib/encode.js"),
        entities: entitiesDir,
      },
    },
  },

  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
