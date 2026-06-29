import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";

const root = process.cwd();
const outDir = join(root, "outputs", "cancip", "tts", "prime-tts");
const ortOutDir = join(outDir, "ort");
const cacheDir = join(root, "reports", "tts-prime-investigation", "prime-models-v3");
const baseUrl = process.env.CANCIP_PRIME_TTS_BASE_URL || "https://hf-mirror.com/Luigi/PrimeTTS/resolve/main";

const files = [
  { remote: "v3_4.6M/acoustic_encoder.onnx", local: "acoustic_encoder.onnx" },
  { remote: "v3_4.6M/acoustic_decoder.onnx", local: "acoustic_decoder.onnx" },
  { remote: "v3_4.6M/vocoder.onnx", local: "vocoder.onnx" },
  { remote: "v3_4.6M/meta.json", local: "meta.json" },
  { remote: "symbol_table.json", local: "symbol_table.json" }
];

await mkdir(outDir, { recursive: true });
await mkdir(ortOutDir, { recursive: true });
await mkdir(cacheDir, { recursive: true });

for (const file of files) {
  const cached = join(cacheDir, file.local);
  const output = join(outDir, file.local);
  if (!(await exists(cached))) {
    await download(`${baseUrl}/${file.remote}`, cached);
  }
  await copyFile(cached, output);
}

const ortFiles = [
  "ort-wasm-simd-threaded.mjs",
  "ort-wasm-simd-threaded.wasm"
];

for (const file of ortFiles) {
  await copyFile(join(root, "node_modules", "onnxruntime-web", "dist", file), join(ortOutDir, file));
}

await writeFile(join(outDir, "README.md"), [
  "# PrimeTTS v3_4.6M",
  "",
  "Bundled for Cancip as a small offline Chinese/English TTS package.",
  "",
  "- Source: https://huggingface.co/Luigi/PrimeTTS",
  "- License: Apache-2.0",
  "- Model: v3_4.6M, 24 kHz, Mandarin zh-TW + English/code-mix",
  "- Model files: acoustic_encoder.onnx, acoustic_decoder.onnx, vocoder.onnx, meta.json, symbol_table.json",
  "- Runtime files: ort/ort-wasm-simd-threaded.mjs, ort/ort-wasm-simd-threaded.wasm",
  ""
].join("\n"), "utf8");

const manifest = {
  source: "Luigi/PrimeTTS",
  sourceUrl: "https://huggingface.co/Luigi/PrimeTTS",
  license: "Apache-2.0",
  variant: "v3_4.6M",
  language: ["zh-TW", "en"],
  sampleRate: 24000,
  preparedAt: new Date().toISOString(),
  modelFiles: await Promise.all(files.map(async (file) => ({
    path: file.local,
    bytes: (await stat(join(outDir, file.local))).size
  }))),
  runtimeFiles: await Promise.all(ortFiles.map(async (file) => ({
    path: `ort/${file}`,
    bytes: (await stat(join(ortOutDir, file))).size
  })))
};
await writeFile(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");

const modelTotal = manifest.modelFiles.reduce((sum, file) => sum + file.bytes, 0);
const runtimeTotal = manifest.runtimeFiles.reduce((sum, file) => sum + file.bytes, 0);
console.log(`PrimeTTS assets ready: ${outDir} (model=${modelTotal} bytes, runtime=${runtimeTotal} bytes, total=${modelTotal + runtimeTotal} bytes)`);

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function download(url, output) {
  console.log(`Downloading ${url}`);
  await mkdir(dirname(output), { recursive: true });
  const response = await fetch(url, {
    headers: { "User-Agent": "Cancip PrimeTTS asset preparer" },
    redirect: "follow"
  });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed ${response.status}: ${url}`);
  }
  await pipeline(response.body, createWriteStream(output));
  // Fail early if an HTTP error page was saved by an intermediary.
  if (output.endsWith(".json")) {
    JSON.parse(await readFile(output, "utf8"));
  }
}
