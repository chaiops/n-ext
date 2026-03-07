import { defineConfig, Plugin } from "vite";
import { resolve } from "path";

/**
 * renderjson@1.4.0 shadows `window`, `module`, and `define` with local vars,
 * breaking both CJS and window assignment when bundled.
 * This plugin rewrites the problematic lines to produce a clean ESM export.
 */
function fixRenderjson(): Plugin {
  return {
    name: "fix-renderjson",
    transform(code, id) {
      if (!id.includes("renderjson")) return null;
      return code
        .replace(
          /^var module, window, define, renderjson=/m,
          "var renderjson="
        )
        .replace(
          /if \(define\) define\(\{renderjson:renderjson\}\)\s*\nelse \(module\|\|\{\}\)\.exports = \(window\|\|\{\}\)\.renderjson = renderjson;/,
          "export default renderjson;"
        );
    },
  };
}

export default defineConfig({
  root: ".",
  plugins: [fixRenderjson()],
  build: {
    outDir: "dist",
    emptyDirFirst: true,
    rollupOptions: {
      input: {
        panel: resolve(__dirname, "panel.html"),
        devtools: resolve(__dirname, "devtools.html"),
      },
    },
  },
  publicDir: "public",
});
