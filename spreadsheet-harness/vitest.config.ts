import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(process.cwd()) },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // This repo lives on a non-APFS volume, so macOS drops an AppleDouble "._x"
    // sidecar next to every file. They are binary and must never be collected.
    exclude: ["**/node_modules/**", "**/.next/**", "**/._*"],
  },
});
