import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, "outputs", "ocr-package", "cancip-ocr-lite-zh-en.zip");
const maxBytes = 30 * 1024 * 1024;
const languageUrls = {
  "chi_sim.traineddata.gz": "https://cdn.jsdelivr.net/npm/@tesseract.js-data/chi_sim@1.0.0/4.0.0_best_int/chi_sim.traineddata.gz",
  "eng.traineddata.gz": "https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int/eng.traineddata.gz"
};

async function download(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

const files = {
  "worker.min.js": new Uint8Array(await readFile(join(root, "node_modules", "tesseract.js", "dist", "worker.min.js"))),
  "tesseract-core-lstm.wasm.js": new Uint8Array(await readFile(join(root, "node_modules", "tesseract.js-core", "tesseract-core-lstm.wasm.js"))),
  "tesseract-core-simd-lstm.wasm.js": new Uint8Array(await readFile(join(root, "node_modules", "tesseract.js-core", "tesseract-core-simd-lstm.wasm.js"))),
  "chi_sim.traineddata.gz": await download(languageUrls["chi_sim.traineddata.gz"]),
  "eng.traineddata.gz": await download(languageUrls["eng.traineddata.gz"]),
  "manifest.json": new TextEncoder().encode(`${JSON.stringify({
    id: "cancip-ocr-lite-zh-en",
    name: "Cancip lightweight Chinese/English OCR",
    engine: "tesseract.js",
    version: "1",
    languages: ["chi_sim", "eng"],
    runtime: "lazy-worker",
    idleDisposeSeconds: 30,
    source: "Tesseract.js 6.0.1 / tesseract.js-core 6.1.2 / tessdata best_int",
    license: "Apache-2.0"
  }, null, 2)}\n`)
};

const archive = zipSync(files, { level: 6, mtime: new Date("2020-01-01T00:00:00.000Z") });
if (archive.byteLength > maxBytes) {
  throw new Error(`OCR package is ${(archive.byteLength / 1024 / 1024).toFixed(2)} MB; expected less than 30 MB`);
}
await mkdir(dirname(output), { recursive: true });
await writeFile(output, archive);
process.stdout.write(`${output}\n${archive.byteLength} bytes\n`);
