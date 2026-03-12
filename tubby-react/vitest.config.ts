import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts", "src/types.ts"],
      thresholds: {
        statements: 100,
        branches: 90,
        functions: 90,
        lines: 100,
      },
    },
  },
});
