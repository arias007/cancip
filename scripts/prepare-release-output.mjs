import { mkdir, readFile, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import esbuild from "esbuild";

const outputDir = "outputs/cancip";
const version = JSON.parse(await readFile("manifest.json", "utf8")).version;
const minAppVersion = JSON.parse(await readFile("manifest.json", "utf8")).minAppVersion;
const versionsPath = "versions.json";
const outputVersionsPath = `${outputDir}/versions.json`;

function portableGzipBase64(source) {
  const compressed = gzipSync(Buffer.from(source), { level: 9 });
  // Node writes the host OS into the gzip header, which otherwise changes the
  // embedded payload between Windows and Linux release builds.
  if (compressed.length >= 10) compressed[9] = 3;
  return compressed.toString("base64");
}

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
const workerGzipBase64 = portableGzipBase64(workerSource);
await writeFile(
  "src/generated/primeTtsWorkerSource.ts",
  `export const PRIME_TTS_WORKER_VERSION = ${JSON.stringify(version)};\nexport const PRIME_TTS_WORKER_GZIP_BASE64 = ${JSON.stringify(workerGzipBase64)};\n`
);

const cliSource = await readFile("cli/cancip-cli.mjs", "utf8");
const cliVersion = cliSource.match(/const CLI_VERSION = "([^"]+)";/)?.[1] ?? "";
if (cliVersion !== version) throw new Error(`Cancip CLI version ${cliVersion || "missing"} does not match plugin ${version}`);
const cliGzipBase64 = portableGzipBase64(cliSource);
await writeFile(
  "src/generated/cancipCliSource.ts",
  `export const CANCIP_CLI_VERSION = ${JSON.stringify(version)};\nexport const CANCIP_CLI_GZIP_BASE64 = ${JSON.stringify(cliGzipBase64)};\n`
);
await writeFile(`${outputDir}/cancip-cli.mjs`, cliSource);

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
