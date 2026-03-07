import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts", "src/runtime/register.ts"],
  format: ["cjs"],
  outDir: "dist",
  clean: true,
  splitting: false,
  sourcemap: true,
  banner: ({ format }) => {
    // Only add shebang to cli.js
    return {};
  },
  esbuildOptions(options, context) {
    if (context.format === "cjs") {
      options.platform = "node";
    }
  },
});
