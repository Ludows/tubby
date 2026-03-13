import { defineConfig } from "tsup";

export default [
  defineConfig({
    entry: ["src/index.ts"],
    format: ["cjs", "esm"],
    dts: true,
    clean: true,
    sourcemap: false,
    target: "es2020",
    external: ["react", "@ludoows/tubby"],
    banner: { js: "'use client';" },
  }),
  defineConfig({
    entry: ["src/index.ts"],
    format: ["iife"],
    globalName: "TubbyReact",
    dts: false,
    clean: false,
    sourcemap: false,
    minify: false,
    target: "es2020",
    external: ["react", "@ludoows/tubby"],
    outExtension: () => ({ js: ".global.js" }),
  }),
  defineConfig({
    entry: ["src/index.ts"],
    format: ["iife"],
    globalName: "TubbyReact",
    dts: false,
    clean: false,
    sourcemap: false,
    minify: true,
    target: "es2020",
    external: ["react", "@ludoows/tubby"],
    outExtension: () => ({ js: ".global.min.js" }),
  }),
];
