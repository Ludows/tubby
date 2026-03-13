import { defineConfig } from "tsup";

export default [
  defineConfig({
    entry: ["src/index.ts"],
    format: ["cjs", "esm"],
    dts: true,
    clean: true,
    sourcemap: false,
    minify: false,
    target: "es2020",
  }),
  defineConfig({
    entry: ["src/index.ts"],
    format: ["iife"],
    globalName: "Tubby",
    dts: false,
    clean: false,
    sourcemap: false,
    minify: false,
    target: "es2020",
    outExtension: () => ({ js: ".global.js" }),
  }),
  defineConfig({
    entry: ["src/index.ts"],
    format: ["iife"],
    globalName: "Tubby",
    dts: false,
    clean: false,
    sourcemap: false,
    minify: true,
    target: "es2020",
    outExtension: () => ({ js: ".global.min.js" }),
  }),
];
