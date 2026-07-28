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
assert.equal(
  bundledWorkerSource.replace(/\r\n/g, "\n"),
  releaseWorkerSource.replace(/\r\n/g, "\n"),
  "Bundled fallback and release PrimeTTS workers must be identical"
);
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
  "cleanTtsText",
  "ttsSourceWithReadableFrontmatter",
  "markdownTtsEmbedReferences",
  "markdownToTtsText",
  "sliceTtsTextFromAnchorToEnd",
  "ttsScrollProgressCursor",
  "splitPrimeTtsMicroPlayText",
  "primeTtsSynthesisText",
  "splitPrimeTtsDisplayText",
  "makeTtsPartPlan",
  "primeTtsPrefetchOrder",
  "findSequentialNormalizedNeedleMatch",
  "normalizeTtsHighlightText",
  "ttsSyntheticTaskPrefixRemainingUnits",
  "ttsHighlightCandidateTexts",
  "ttsRawDisplayCandidateForSpokenPart"
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

assert.match(
  source,
  /activeTtsHighlightKey === key && this\.hasLiveTtsSourceHighlight\(\)/,
  "A virtualized Markdown/PDF node must be repainted when the cached highlight node disappears"
);
assert.match(
  source,
  /this\.activeTtsPrimeCacheSessionId \+= 1;[\s\S]{0,240}this\.activeTtsPrimeCache\.clear\(\);[\s\S]{0,240}this\.activeTtsPrimeDecodedCache\.clear\(\);/,
  "Manual sentence seeking must invalidate stale PrimeTTS synthesis and decode work"
);
assert.ok(
  ["highlightActiveRenderedTtsPart", "highlightTextStreamElementsFromRoots", "highlightRenderedPart", "readActivePdfLayerText"]
    .every((name) => source.slice(source.indexOf(`private ${name}`), source.indexOf("\n  private ", source.indexOf(`private ${name}`) + 12)).includes("isOwnDocumentHTMLElement")),
  "Markdown and PDF TTS nodes must be checked against their own document realm"
);

const repeatedHaystack = "开头重复内容中间重复内容结尾";
const firstRepeated = api.findSequentialNormalizedNeedleMatch(repeatedHaystack, "重复内容", true, 0, 0);
assert.equal(firstRepeated?.index, 2, "Initial highlight should resolve the first matching phrase");
const secondRepeated = api.findSequentialNormalizedNeedleMatch(
  repeatedHaystack,
  "重复内容",
  true,
  (firstRepeated?.index ?? 0) + (firstRepeated?.needle.length ?? 0),
  (firstRepeated?.index ?? 0) + (firstRepeated?.needle.length ?? 0)
);
assert.equal(secondRepeated?.index, 8, "Forward highlight must not jump back to an earlier duplicate");
const backwardRepeated = api.findSequentialNormalizedNeedleMatch(repeatedHaystack, "重复内容", true, 2, 0);
assert.equal(backwardRepeated?.index, 2, "Explicit backward seeking may resolve an earlier duplicate");
const singleCharacterForward = api.findSequentialNormalizedNeedleMatch("今日日记今日计划", "今", true, 4, 4);
assert.equal(singleCharacterForward?.index, 4, "A one-character startup chunk must follow the playback cursor instead of retaining the previous highlight");

const taskParts = ["待", "办晚", "间二十二，周七", "#日记运动"];
const taskMap = [0, 0, 0, 0];
assert.equal(api.ttsSyntheticTaskPrefixRemainingUnits(taskParts, taskMap, 0, 0, "待办晚间22，周7 #日记运动"), 2);
assert.equal(api.ttsSyntheticTaskPrefixRemainingUnits(taskParts, taskMap, 1, 0, "待办晚间22，周7 #日记运动"), 1);
assert.equal(
  api.ttsHighlightCandidateTexts("待", "待办晚间22，周7 #日记运动", 2).length,
  0,
  "A spoken-only task-state chunk must not jump to an unrelated visible occurrence"
);
assert.ok(
  api.ttsHighlightCandidateTexts("办晚", "待办晚间22，周7 #日记运动", 1).includes("晚"),
  "The first visible task character must become the highlight anchor after the spoken-only prefix"
);
assert.equal(
  api.ttsRawDisplayCandidateForSpokenPart("间二十二，周七", "晚间22，周7 #日记运动"),
  "间22，周7",
  "Highlight matching must map spoken Chinese numbers back to the digits rendered by Obsidian"
);

const endMarker = "CANCIP_TTS_REAL_END_MARKER";
const longMarkdown = `${"这是用于验证长文完整朗读的短句。\n".repeat(12000)}${endMarker}`;
const fullText = api.markdownToTtsText(longMarkdown, Number.MAX_SAFE_INTEGER);
assert.ok(fullText.endsWith(endMarker), "Unlimited file capture must retain the real final marker");
assert.ok(!api.markdownToTtsText(longMarkdown).includes(endMarker), "The fixture must exceed the normal message capture budget");

const plan = api.makeTtsPartPlan(fullText, "builtin-prime-tts", 96);
assert.ok(plan.playParts.at(-1)?.includes(endMarker), "PrimeTTS play plan must include the real file ending");
assert.ok(plan.playParts.length < 50000, "Short sentences must not exhaust the PrimeTTS part limit");

const sentenceDisplayParts = Array.from(api.splitPrimeTtsDisplayText("第一句，逗号不能切蓝标。第二句！\n第三行没有句号"));
assert.deepEqual(
  sentenceDisplayParts,
  ["第一句，逗号不能切蓝标。", "第二句！", "第三行没有句号"],
  "PrimeTTS display parts must follow full sentence/newline boundaries instead of micro playback chunks"
);
const sentencePlan = api.makeTtsPartPlan("这是一个包含多个微发声片段但只允许一个整句蓝标的测试句子。下一句。", "builtin-prime-tts", 64);
assert.equal(sentencePlan.displayParts.length, 2, "Two sentences must produce exactly two display highlight parts");
assert.ok(sentencePlan.displayIndexByPlayIndex.filter((index) => index === 0).length > 1, "Multiple micro playback parts must map to the same sentence highlight");

const anchoredFull = `${"前".repeat(300)}游标之后继续朗读。${"中".repeat(300)}${endMarker}`;
const anchored = api.sliceTtsTextFromAnchorToEnd(
  anchoredFull,
  "渲染层里无法匹配的文本",
  Number.MAX_SAFE_INTEGER,
  300
);
assert.ok(anchored.startsWith("游标之后"), "Anchor fallback must use the viewport cursor instead of a DOM-only fragment");
assert.ok(anchored.endsWith(endMarker), "Anchor fallback must still reach the file ending");

const virtualViewportCursor = api.ttsScrollProgressCursor(1000, 240, 800, 1040);
assert.equal(virtualViewportCursor, 230, "A virtualized reading view must preserve its current viewport progress");
const virtualViewportText = api.sliceTtsTextFromAnchorToEnd(
  `${"前".repeat(230)}当前屏幕顶部。${"后".repeat(200)}${endMarker}`,
  "",
  Number.MAX_SAFE_INTEGER,
  virtualViewportCursor
);
assert.ok(virtualViewportText.startsWith("当前屏幕顶部"), "An empty virtualized DOM anchor must not fall back to the file top");
assert.ok(virtualViewportText.endsWith(endMarker), "Virtualized viewport fallback must still read through the file ending");

const journalMarkdown = `## 主体开始
![外部前言](外部前言.md)

## 今日计划
- [ ] **主体任务一**，后续内容不能漏读
- [x] **主体任务二**，完成状态也要朗读

## 交易日志
${endMarker}`;
const journalText = api.markdownToTtsText(journalMarkdown, Number.MAX_SAFE_INTEGER);
assert.ok(!journalText.includes("外部前言"), "External Markdown embeds must not replace the host note body");
assert.ok(journalText.includes("待办 主体任务一"), "Unchecked task state must align with the rendered viewport text");
assert.ok(journalText.includes("已完成 主体任务二"), "Checked task state must align with the rendered viewport text");

const codeMarkdown = [
  "## Code sample",
  "```ts",
  "const answer = 42;",
  "console.log(answer);",
  "```",
  "Inline `npm run build` and indented code:",
  "    return answer;"
].join("\n");
const codeText = api.markdownToTtsText(codeMarkdown, Number.MAX_SAFE_INTEGER);
assert.ok(codeText.includes("const answer = 42;"), "Fenced code contents must remain in the spoken document");
assert.ok(codeText.includes("console.log(answer);"), "Every readable fenced code line must remain available to TTS");
assert.ok(codeText.includes("npm run build"), "Inline code must remain readable");
assert.ok(codeText.includes("return answer;"), "Indented code must remain readable");
assert.ok(!codeText.includes("```") && !codeText.includes("Code sample ts"), "Code fence markers and language metadata must not be pronounced");
const codePlan = api.makeTtsPartPlan(codeText, "builtin-prime-tts", 96);
assert.equal(codePlan.displayIndexByPlayIndex.length, codePlan.playParts.length, "Every spoken code chunk must have a highlight mapping");
assert.equal(
  Array.from(new Set(codePlan.displayIndexByPlayIndex)).join(","),
  Array.from({ length: codePlan.displayParts.length }, (_, index) => index).join(","),
  "Every readable code sentence must remain reachable by sentence-level highlighting"
);

const propertyText = api.markdownToTtsText(`---
tags:
  - 日记
cancip_diary: true
mood: 平静
---
## 正文`, Number.MAX_SAFE_INTEGER);
assert.ok(propertyText.startsWith("tags："), "Visible note properties must be read before the body at the file top");
assert.ok(propertyText.includes("日记"), "Frontmatter list values must remain readable");
assert.ok(propertyText.includes("cancip diary：true"), "Frontmatter property keys must remain pronounceable");

const embedReferences = api.markdownTtsEmbedReferences(`![日记前言](../日记/日记插入/日记前言.md)\n![[领域索引|领域]]`);
assert.equal(
  embedReferences.map((item) => item.target).join("\n"),
  "../日记/日记插入/日记前言.md\n领域索引",
  "Markdown and wikilink note embeds must be discoverable for recursive reading"
);
const journalAnchored = api.sliceTtsTextFromAnchorToEnd(
  journalText,
  "待办 主体任务一，后续内容不能漏读",
  Number.MAX_SAFE_INTEGER,
  0
);
assert.ok(journalAnchored.startsWith("待办 主体任务一"), "A rendered task anchor must resolve to the same task in the source text");
assert.ok(journalAnchored.endsWith(endMarker), "Journal reading must continue through the real host-note ending");

const quotedDocument = api.cleanTtsText(
  `正文开始。\n\n> [!quote] 引用标题\n> 这是必须朗读的引用正文。\n> 引用的第二行也不能丢失。\n\n正文结束。`,
  Number.MAX_SAFE_INTEGER,
  true
);
assert.ok(quotedDocument.includes("引用标题"), "Document TTS must keep the rendered quote title");
assert.ok(quotedDocument.includes("这是必须朗读的引用正文"), "Document TTS must keep quote body text");
assert.ok(quotedDocument.includes("引用的第二行也不能丢失"), "Document TTS must keep multi-line quote content");
assert.ok(!quotedDocument.includes("!quote"), "Obsidian callout metadata must not be pronounced");

const contaminatedAnchor = api.sliceTtsTextFromAnchorToEnd(
  journalText,
  "外部引用中无法匹配主体的文字",
  Number.MAX_SAFE_INTEGER,
  journalText.length + 500
);
assert.ok(contaminatedAnchor.startsWith("主体开始"), "An invalid embedded cursor must fall back to the host-note start");
assert.ok(contaminatedAnchor.endsWith(endMarker), "Embedded fallback must retain the host-note ending");

const journalPlan = api.makeTtsPartPlan(journalText, "builtin-prime-tts", 96);
const readableSequence = (value) => value.replace(/\s+/g, "").replace(/[\p{P}\p{S}]/gu, "");
assert.equal(
  readableSequence(journalPlan.playParts.join("")),
  readableSequence(journalText),
  "PrimeTTS chunking must not omit readable journal characters"
);
assert.ok(journalPlan.playParts.at(-1)?.includes(endMarker), "PrimeTTS journal plan must include the final marker");

const headingBoundaryText = api.markdownToTtsText("## 干成为王\n\n## 领域\n经济", Number.MAX_SAFE_INTEGER);
const headingBoundaryPlan = api.makeTtsPartPlan(headingBoundaryText, "builtin-prime-tts", 96);
assert.ok(headingBoundaryText.includes("干成为王。领域。"), "Markdown headings must preserve a spoken structural pause");
assert.ok(
  headingBoundaryPlan.playParts.every((part) => !api.findSequentialNormalizedNeedleMatch(part, "王领域", false, 0, 0)),
  "PrimeTTS chunks must not cross adjacent Markdown heading boundaries"
);

const english = "PrimeTTS should pronounce internationalization and characteristically complete words without awkward pauses.";
const englishParts = api.splitPrimeTtsMicroPlayText(english, 96);
assert.ok(englishParts[0].trim().split(/\s+/).length >= 2, "English startup audio must use a natural phrase");
for (const word of ["internationalization", "characteristically"]) {
  assert.ok(englishParts.some((part) => part.toLowerCase().includes(word)), `English word was split: ${word}`);
}
assert.ok(englishParts.at(-1)?.endsWith("."), "English punctuation must remain on the final phrase");

const chinese = "朗读开始需要快。后续每一句都应该连续自然，不要反复停顿。最后一句必须完整到达文件结尾。";
const chineseParts = api.splitPrimeTtsMicroPlayText(chinese, 96);
assert.equal(chineseParts[0], "朗", "Chinese startup should use one character for the earliest possible first sound");
const secondSentenceIndex = chineseParts.findIndex((part) => part.startsWith("后"));
assert.ok(secondSentenceIndex > 0, "The second sentence must remain in the playback plan");
assert.ok(chineseParts[secondSentenceIndex].length > 1, "Later sentences must use prefetched phrases instead of restarting with a one-character handoff");
assert.equal(chineseParts.filter((part) => api.normalizeTtsHighlightText(part).length === 1).length, 1, "Only the document startup may use a one-character audio chunk");
assert.ok(chineseParts.every((part) => part.length <= 32), "Chinese steady chunks must stay short enough for continuous prefetch");
assert.ok(chineseParts.length <= 18, "Sentence handoff chunks must stay bounded");
assert.ok(chineseParts.at(-1)?.endsWith("结尾。"), "Chinese final sentence must remain complete");

const transitionPrefetchOrder = Array.from(api.primeTtsPrefetchOrder(
  12,
  0,
  [0, 0, 0, 0, 1, 1, 1, 2, 2, 2, 2, 2],
  5,
  2,
  12
));
assert.deepEqual(
  transitionPrefetchOrder,
  [0, 1, 2, 4, 3, 5],
  "PrimeTTS must synthesize the next sentence start before non-immediate linear lookahead"
);
assert.deepEqual(
  Array.from(api.primeTtsPrefetchOrder(5, 3, [0, 0, 1, 1, 1], 5, 2, 12)),
  [3, 4],
  "PrimeTTS prefetch ordering must stay within the remaining playback chunks"
);

const mixedJournalLine = "领域：💰经济 · 💻计算机 · 📖知识\n📅 2026-07-26，继续朗读引用和主体。";
const mixedJournalPlan = api.makeTtsPartPlan(mixedJournalLine, "builtin-prime-tts", 96);
assert.ok(mixedJournalPlan.playParts.length > 0, "Mixed journal text must produce playable chunks");
assert.ok(
  mixedJournalPlan.playParts.every((part) => !/[\ud800-\udbff]$/.test(part) && !/^[\udc00-\udfff]/.test(part)),
  "PrimeTTS chunks must not split surrogate pairs"
);
assert.equal(
  readableSequence(mixedJournalPlan.playParts.join("")),
  readableSequence(mixedJournalLine),
  "Emoji handling must not omit readable journal text"
);

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
for (const part of mixedJournalPlan.playParts) {
  const synthesisText = api.primeTtsSynthesisText(part);
  assert.ok(!/[\ud800-\udfff]/.test(synthesisText), `Synthesis text retained an invalid surrogate: ${JSON.stringify(synthesisText)}`);
  assert.ok(frontendModule.primeTtsTextToIds(synthesisText).phoneIds.length > 0, `Mixed journal chunk produced no phones: ${JSON.stringify(part)}`);
}

console.log(JSON.stringify({
  longTextChars: fullText.length,
  longTextParts: plan.playParts.length,
  englishParts,
  chineseParts,
  englishDictionaryPhones: becauseIds.phoneIds.slice(0, 5)
}, null, 2));
