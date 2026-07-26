import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import vm from "node:vm";
import { build } from "esbuild";
import ts from "typescript";

const source = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
const generatedWorker = await readFile(new URL("../src/generated/primeTtsWorkerSource.ts", import.meta.url), "utf8");
const workerVersionMatch = generatedWorker.match(/PRIME_TTS_WORKER_VERSION = ("(?:[^"\\]|\\.)*")/);
const workerGzipMatch = generatedWorker.match(/PRIME_TTS_WORKER_GZIP_BASE64 = ("(?:[^"\\]|\\.)*")/);
assert.ok(workerVersionMatch && workerGzipMatch, "Generated PrimeTTS worker fallback is incomplete");
const workerVersion = JSON.parse(workerVersionMatch[1]);
const bundledWorkerSource = gunzipSync(Buffer.from(JSON.parse(workerGzipMatch[1]), "base64")).toString("utf8");
const releaseWorkerSource = await readFile(new URL("../outputs/cancip/prime-tts-worker.js", import.meta.url), "utf8");
const workerMarker = `/* Cancip PrimeTTS worker ${manifest.version} */`;
assert.equal(workerVersion, manifest.version, "Bundled PrimeTTS worker version must match manifest.json");
assert.ok(bundledWorkerSource.startsWith(workerMarker), "Bundled PrimeTTS worker marker is stale");
assert.ok(releaseWorkerSource.startsWith(workerMarker), "Release PrimeTTS worker marker is stale");
assert.equal(bundledWorkerSource, releaseWorkerSource, "Bundled fallback and release PrimeTTS workers must be identical");
const sourceFile = ts.createSourceFile("main.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const declarations = new Map();

for (const statement of sourceFile.statements) {
  if (ts.isFunctionDeclaration(statement) && statement.name) {
    declarations.set(statement.name.text, statement);
    continue;
  }
  if (!ts.isVariableStatement(statement)) continue;
  for (const declaration of statement.declarationList.declarations) {
    if (ts.isIdentifier(declaration.name)) declarations.set(declaration.name.text, statement);
  }
}

const roots = [
  "markdownToTtsText",
  "sliceTtsTextFromAnchorToEnd",
  "splitPrimeTtsMicroPlayText",
  "makeTtsPartPlan"
];
const selected = new Set();
const pending = [...roots];

while (pending.length) {
  const name = pending.pop();
  const statement = declarations.get(name);
  if (!statement || selected.has(statement)) continue;
  selected.add(statement);
  const visit = (node) => {
    if (ts.isIdentifier(node) && declarations.has(node.text)) pending.push(node.text);
    ts.forEachChild(node, visit);
  };
  visit(statement);
}

for (const root of roots) assert.ok(declarations.has(root), `Missing TTS test root: ${root}`);

const runtimeSource = [...selected]
  .sort((a, b) => a.getStart(sourceFile) - b.getStart(sourceFile))
  .map((statement) => statement.getText(sourceFile))
  .join("\n\n");
const expose = `\nglobalThis.__cancipTtsTest = { ${roots.join(", ")} };`;
const transpiled = ts.transpileModule(runtimeSource + expose, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
}).outputText;
const sandbox = { console };
vm.runInNewContext(transpiled, sandbox, { filename: "cancip-tts-regression-runtime.js" });
const api = sandbox.__cancipTtsTest;

const endMarker = "CANCIP_TTS_REAL_END_MARKER";
const longMarkdown = `${"这是用于验证长文完整朗读的短句。\n".repeat(12000)}${endMarker}`;
const fullText = api.markdownToTtsText(longMarkdown, Number.MAX_SAFE_INTEGER);
assert.ok(fullText.endsWith(endMarker), "Unlimited file capture must retain the real final marker");
assert.ok(!api.markdownToTtsText(longMarkdown).includes(endMarker), "The fixture must exceed the normal message capture budget");

const plan = api.makeTtsPartPlan(fullText, "builtin-prime-tts", 96);
assert.ok(plan.playParts.at(-1)?.includes(endMarker), "PrimeTTS play plan must include the real file ending");
assert.ok(plan.playParts.length < 50000, "Short sentences must not exhaust the PrimeTTS part limit");

const anchoredFull = `${"前".repeat(300)}游标之后继续朗读。${"中".repeat(300)}${endMarker}`;
const anchored = api.sliceTtsTextFromAnchorToEnd(
  anchoredFull,
  "渲染层里无法匹配的文本",
  Number.MAX_SAFE_INTEGER,
  300
);
assert.ok(anchored.startsWith("游标之后"), "Anchor fallback must use the viewport cursor instead of a DOM-only fragment");
assert.ok(anchored.endsWith(endMarker), "Anchor fallback must still reach the file ending");

const english = "PrimeTTS should pronounce internationalization and characteristically complete words without awkward pauses.";
const englishParts = api.splitPrimeTtsMicroPlayText(english, 96);
assert.ok(englishParts[0].trim().split(/\s+/).length >= 2, "English startup audio must use a natural phrase");
for (const word of ["internationalization", "characteristically"]) {
  assert.ok(englishParts.some((part) => part.toLowerCase().includes(word)), `English word was split: ${word}`);
}
assert.ok(englishParts.at(-1)?.endsWith("."), "English punctuation must remain on the final phrase");

const chinese = "朗读开始需要快。后续每一句都应该连续自然，不要反复停顿。最后一句必须完整到达文件结尾。";
const chineseParts = api.splitPrimeTtsMicroPlayText(chinese, 96);
assert.equal(chineseParts[0], "朗", "Only the initial Chinese block should use the one-character fast start");
assert.ok(chineseParts.length <= 6, "Later Chinese sentences must not restart the micro-chunk ladder");
assert.ok(chineseParts.at(-1)?.endsWith("结尾。"), "Chinese final sentence must remain complete");

const frontendBundle = await build({
  stdin: {
    contents: 'export { primeTtsTextToIds } from "./src/primeTtsFrontend.ts";',
    resolveDir: new URL("..", import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (value) => value.slice(1))
  },
  bundle: true,
  format: "esm",
  platform: "node",
  target: "es2022",
  write: false
});
const frontendModule = await import(`data:text/javascript;base64,${Buffer.from(frontendBundle.outputFiles[0].contents).toString("base64")}`);
const becauseIds = frontendModule.primeTtsTextToIds("because");
assert.deepEqual(becauseIds.phoneIds.slice(0, 5), [47, 57, 60, 44, 78], "Common English words must use CMU phonemes");
assert.ok(becauseIds.langIds.slice(0, 5).every((lang) => lang === 1), "English phonemes must keep the English language id");

console.log(JSON.stringify({
  longTextChars: fullText.length,
  longTextParts: plan.playParts.length,
  englishParts,
  chineseParts,
  englishDictionaryPhones: becauseIds.phoneIds.slice(0, 5)
}, null, 2));
