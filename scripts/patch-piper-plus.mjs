import { readFile, writeFile } from "node:fs/promises";

const file = "node_modules/piper-plus/src/index.js";
const before = `              wasmUrl: options.wasmG2pUrl || '../../dist/rust-wasm/piper_plus_wasm.js',
              wasmLoader: options.wasmLoader,`;
const after = `              wasmUrl: options.wasmG2pUrl || '../../dist/rust-wasm/piper_plus_wasm.js',
              wasmLoader: options.wasmLoader,
              zhDictBaseUrl: options.zhDictBaseUrl,`;

const text = await readFile(file, "utf8");
if (text.includes(after)) {
  process.exit(0);
}
if (!text.includes(before)) {
  throw new Error("piper-plus patch target not found");
}
await writeFile(file, text.replace(before, after), "utf8");
