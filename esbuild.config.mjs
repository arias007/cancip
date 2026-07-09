import { builtinModules } from "node:module";
import { mkdir } from "node:fs/promises";
import esbuild from "esbuild";
import process from "process";

const prod = process.argv[2] === "production";

await mkdir("outputs/build", { recursive: true });
await mkdir("outputs/cancip", { recursive: true });

await esbuild.build({
  entryPoints: ["src/primeTtsWorker.ts"],
  bundle: true,
  format: "iife",
  target: "es2020",
  platform: "browser",
  logLevel: "silent",
  treeShaking: true,
  minify: prod,
  outfile: "outputs/cancip/prime-tts-worker.js"
});

await esbuild.build({
  banner: {
    js: "/* Cancip */"
  },
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtinModules,
    ...builtinModules.map((name) => `node:${name}`)
  ],
  format: "cjs",
  target: "es2020",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "outputs/cancip/main.js",
  minify: prod
});
