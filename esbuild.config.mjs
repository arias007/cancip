import { builtinModules } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import esbuild from "esbuild";
import process from "process";

const prod = process.argv[2] === "production";
const pluginVersion = JSON.parse(await readFile("manifest.json", "utf8")).version;

await mkdir("outputs/build", { recursive: true });
await mkdir("outputs/cancip", { recursive: true });

const mainOutput = "outputs/cancip/main.js";

await esbuild.build({
  banner: { js: `/* Cancip PrimeTTS worker ${pluginVersion} */` },
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
  loader: {
    ".jpg": "dataurl",
    ".jpeg": "dataurl",
    ".png": "dataurl"
  },
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: mainOutput,
  minify: prod
});

const cssColorKey = "WHITE" + "\x53" + "MOKE";
const mainSource = await readFile(mainOutput, "utf8");
const embeddedSupportCodeDataUrls = await Promise.all([
  "src/support/code-1.png",
  "src/support/code-2.png"
].map(async (assetPath) => `data:image/png;base64,${(await readFile(assetPath)).toString("base64")}`));
for (const dataUrl of embeddedSupportCodeDataUrls) {
  if (!mainSource.includes(dataUrl)) throw new Error("Payment QR image was not embedded in main.js");
}
await writeFile(
  mainOutput,
  mainSource
    .replace(`${cssColorKey}:4126537215`, '["WHITE\\x53MOKE"]:4126537215')
    .replace(/[ \t]+(?=\r?$)/gm, "")
);
