import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs", "esm"],
  dts: true,
  clean: true,
  sourcemap: false,
  target: "es2020",
  external: ["react", "@ludoows/tubby"],
  banner: {
    js: "'use client';",
  },
});
