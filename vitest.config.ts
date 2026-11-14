import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Only the repository's own tests. Local toolchains under .tools/ can carry copies of the sources.
    include: ["src/tests/**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**", ".tools/**", "dist/**", "server/provider-runtime/node_modules/**"],
  },
});
