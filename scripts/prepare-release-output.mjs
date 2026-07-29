import { mkdir, readFile, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import esbuild from "esbuild";

const outputDir = "outputs/cancip";
const version = JSON.parse(await readFile("manifest.json", "utf8")).version;
const minAppVersion = JSON.parse(await readFile("manifest.json", "utf8")).minAppVersion;
const versionsPath = "versions.json";
const outputVersionsPath = `${outputDir}/versions.json`;

await mkdir(outputDir, { recursive: true });
await mkdir("src/generated", { recursive: true });

const workerBundle = await esbuild.build({
  entryPoints: ["src/primeTtsWorker.ts"],
  bundle: true,
  banner: { js: `/* Cancip PrimeTTS worker ${version} */` },
  format: "iife",
  target: "es2020",
  platform: "browser",
  logLevel: "silent",
  treeShaking: true,
  minify: true,
  write: false
});
const workerSource = workerBundle.outputFiles[0]?.text ?? "";
const workerGzipBase64 = gzipSync(Buffer.from(workerSource), { level: 9 }).toString("base64");
await writeFile(
  "src/generated/primeTtsWorkerSource.ts",
  `export const PRIME_TTS_WORKER_VERSION = ${JSON.stringify(version)};\nexport const PRIME_TTS_WORKER_GZIP_BASE64 = ${JSON.stringify(workerGzipBase64)};\n`
);

for (const file of ["manifest.json", "README.md"]) {
  await writeFile(`${outputDir}/${file}`, await readFile(file, "utf8"));
}

let versions = {};
try {
  versions = JSON.parse(await readFile(versionsPath, "utf8"));
} catch {
  versions = {};
}
versions[version] = minAppVersion;
const versionsJson = `${JSON.stringify(versions, null, 2)}\n`;
await writeFile(versionsPath, versionsJson);
await writeFile(outputVersionsPath, versionsJson);
