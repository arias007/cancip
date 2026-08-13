import { readFile } from "node:fs/promises";
import process from "node:process";
import ts from "typescript";
import { gunzipSync, gzipSync, strFromU8, strToU8, unzipSync, zipSync } from "fflate";

const source = (await readFile(new URL("../src/main.ts", import.meta.url), "utf8")).replace(/\r\n?/g, "\n");
const styles = (await readFile(new URL("../outputs/cancip/styles.css", import.meta.url), "utf8")).replace(/\r\n?/g, "\n");
const localGreetingSource = source.slice(
  source.indexOf("function localPersonalizationCache("),
  source.indexOf("function normalizePersonalizationCache(")
);
const workbenchSource = source.slice(
  source.indexOf("class CancipDocumentWorkbenchView"),
  source.indexOf("class CancipReviewLeafView")
);
const inlineEmbedSource = source.slice(
  source.indexOf("private processMarkdownWorkbenchEmbeds"),
  source.indexOf("private async reviewGateVaultStateFingerprint")
);
const workbenchShareSource = workbenchSource.slice(
  workbenchSource.indexOf("private async shareOriginalDocument"),
  workbenchSource.indexOf("private async openOriginalWithObsidian")
);
const documentZoomSurfaceSource = workbenchSource.slice(
  workbenchSource.indexOf("private documentZoomSurfaceSelector"),
  workbenchSource.indexOf("private syncDocumentZoomSurfaces")
);
const htmlVaultBridgeSource = workbenchSource.slice(
  workbenchSource.indexOf("private async handleHtmlVaultRequest"),
  workbenchSource.indexOf("private async executeHtmlPreviewCommand")
);
const aiOverviewSource = source.slice(
  source.indexOf("private renderAiOverview"),
  source.indexOf("private renderMessages(", source.indexOf("private renderAiOverview"))
);
const settingsModuleSource = source.slice(
  source.indexOf("const SETTINGS_PAGE_KEYS"),
  source.indexOf("private displayCommonSettings", source.indexOf("const SETTINGS_PAGE_KEYS"))
);

const parsedSource = ts.createSourceFile("main.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const settingsModuleCoveragePassed = (() => {
  const settingsKeys = [];
  const mappedKeys = [];
  const visit = (node) => {
    if (ts.isTypeAliasDeclaration(node) && node.name.text === "Settings" && ts.isTypeLiteralNode(node.type)) {
      for (const member of node.type.members) {
        if (member.name) settingsKeys.push(member.name.getText(parsedSource).replace(/^["']|["']$/g, ""));
      }
    }
    if (ts.isVariableDeclaration(node) && node.name.getText(parsedSource) === "SETTINGS_PAGE_KEYS" && ts.isObjectLiteralExpression(node.initializer)) {
      for (const property of node.initializer.properties) {
        if (!ts.isPropertyAssignment(property) || !ts.isArrayLiteralExpression(property.initializer)) continue;
        for (const item of property.initializer.elements) if (ts.isStringLiteral(item)) mappedKeys.push(item.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parsedSource);
  return settingsKeys.length > 0
    && settingsKeys.every((key) => key === "agentBridgeToken" || mappedKeys.includes(key))
    && !mappedKeys.includes("agentBridgeToken");
})();
const functionSource = (name) => {
  let match = "";
  const visit = (node) => {
    if (!match && ts.isFunctionDeclaration(node) && node.name?.text === name) match = node.getText(parsedSource);
    if (!match) ts.forEachChild(node, visit);
  };
  visit(parsedSource);
  if (!match) throw new Error(`Missing source function: ${name}`);
  return match;
};
const greetingCacheModule = ts.transpileModule([
  "type Language = string;",
  "const trimContext = (value: string, maxLength: number) => value.length <= maxLength ? value : value.slice(0, maxLength);",
  "const redactSensitiveText = (value: string) => value;",
  "const isChineseLanguage = (language: string) => language === 'zh';",
  functionSource("escapeRegExp"),
  functionSource("sanitizePersonalizationText"),
  functionSource("sanitizePersonalizationName"),
  functionSource("personalizationPeriodLabel"),
  functionSource("personalizationGreetingCacheIsFresh"),
  functionSource("personalizationGreetingBody"),
  functionSource("composePersonalizationGreeting"),
  "export { personalizationGreetingCacheIsFresh, composePersonalizationGreeting };"
].join("\n\n"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 }
}).outputText;
const greetingCacheApi = await import(`data:text/javascript;base64,${Buffer.from(greetingCacheModule).toString("base64")}`);
const greetingNow = new Date(2026, 6, 28, 20, 0, 0, 0);
const greetingNowMs = greetingNow.getTime();
const reusedGreeting = greetingCacheApi.composePersonalizationGreeting(
  greetingNow,
  "zh",
  "Murat",
  "Murat，上午好。昨晚的日记里还剩一个复盘待办。"
);
const greetingCachePassed = reusedGreeting === "Murat，晚上好。昨晚的日记里还剩一个复盘待办。"
  && greetingCacheApi.composePersonalizationGreeting(greetingNow, "zh", "Murat", "Murat，你好。") === "Murat，晚上好。"
  && greetingCacheApi.composePersonalizationGreeting(
    greetingNow,
    "zh",
    "Murat",
    "Murat，下午快五点了，最近整理的国际音标笔记里保留了复习标签。"
  ) === "Murat，晚上好。最近整理的国际音标笔记里保留了复习标签。"
  && greetingCacheApi.composePersonalizationGreeting(
    greetingNow,
    "zh",
    "木拉提",
    "下午好，木拉提。今天的日记列着医务科远程与转诊、交易日志等未勾选事项。"
  ) === "木拉提，晚上好。今天的日记列着医务科远程与转诊、交易日志等未勾选事项。"
  && greetingCacheApi.personalizationGreetingCacheIsFresh(new Date(greetingNowMs - 47 * 60 * 60 * 1000).toISOString(), 48, greetingNowMs)
  && !greetingCacheApi.personalizationGreetingCacheIsFresh(new Date(greetingNowMs - 49 * 60 * 60 * 1000).toISOString(), 48, greetingNowMs);
const ocrSemanticModule = ts.transpileModule([
  "const OCR_CACHE_SCHEMA_VERSION = 3;",
  functionSource("uniqueStrings"),
  functionSource("inferOcrSemanticTags"),
  functionSource("migrateOcrIndexEntry"),
  "export { inferOcrSemanticTags, migrateOcrIndexEntry };"
].join("\n\n"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 }
}).outputText;
const ocrSemanticApi = await import(`data:text/javascript;base64,${Buffer.from(ocrSemanticModule).toString("base64")}`);
const identityCardTags = ocrSemanticApi.inferOcrSemanticTags(
  "中华人民共和国居民身份证\n姓名 张三\n性别 男 民族 汉\n住址 北京市朝阳区\n公民身份号码 110101199001011234\n签发机关 北京市公安局\n有效期限 2020.01.01-2040.01.01",
  "附件/IMG_20260727.jpg",
  856,
  540,
  [
    { text: "姓名 张三", confidence: 96, x: 0.15, y: 0.2, width: 0.3, height: 0.08 },
    { text: "公民身份号码 110101199001011234", confidence: 94, x: 0.1, y: 0.72, width: 0.72, height: 0.08 }
  ]
);
const migratedIdentityCache = ocrSemanticApi.migrateOcrIndexEntry({
  schemaVersion: 2,
  engineVersion: "1",
  source: "vault",
  path: "附件/IMG_20260727.jpg",
  sourceKey: "附件/IMG_20260727.jpg",
  mtime: 1,
  size: 1,
  indexedAt: "",
  languages: "chi_sim+eng",
  confidence: 95,
  width: 856,
  height: 540,
  text: "中华人民共和国居民身份证\n公民身份号码 110101199001011234",
  description: "",
  semanticTags: [],
  blocks: [],
  pages: []
});
const searchIntentModule = ts.transpileModule([
  "const normalizePath = (value: string) => value.replace(/\\\\/g, '/');",
  "const trimContext = (value: string, maxLength: number) => value.length <= maxLength ? value : value.slice(0, Math.max(0, maxLength - 3)).trimEnd() + '...';",
  functionSource("uniqueStrings"),
  functionSource("tokenize"),
  functionSource("searchWordRootVariants"),
  functionSource("searchHighlightTerms"),
  functionSource("universalSearchQueryTerms"),
  functionSource("parseSearchQueryIntent"),
  functionSource("searchHitMatchesRequestedKind"),
  functionSource("searchIntentTextTier"),
  functionSource("searchHitIntentRank"),
  functionSource("rankSearchHitsForIntent"),
  functionSource("originalSearchQueryGroups"),
  functionSource("searchHitOriginalContent"),
  functionSource("searchHitMatchesOriginalQuery"),
  functionSource("searchHitStrictKey"),
  functionSource("partitionSearchHitsByOriginalQuery"),
  functionSource("searchHitExplanationSignals"),
  functionSource("compactSearchExplanationText"),
  functionSource("searchHitEvidenceSnippet"),
  functionSource("searchHitEvidenceQuality"),
  functionSource("mergeSearchHitEvidence"),
  functionSource("searchDocumentSpecificEvidence"),
  functionSource("reviewFileName"),
  functionSource("isChineseLanguage"),
  functionSource("aiSearchRelationLabel"),
  functionSource("nonStrictSearchHitExplanation"),
  functionSource("searchResultCategoryForHit"),
  functionSource("searchHitsForCategory"),
  "export { parseSearchQueryIntent, rankSearchHitsForIntent, searchHitStrictKey, partitionSearchHitsByOriginalQuery, mergeSearchHitEvidence, searchDocumentSpecificEvidence, nonStrictSearchHitExplanation, searchResultCategoryForHit, searchHitsForCategory };"
].join("\n\n"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 }
}).outputText;
const searchIntentApi = await import(`data:text/javascript;base64,${Buffer.from(searchIntentModule).toString("base64")}`);
globalThis.__cancipArchiveTestFflate = { gunzipSync, gzipSync, unzipSync, zipSync };
const archiveModule = ts.transpileModule([
  "const { gunzipSync, gzipSync, unzipSync, zipSync } = globalThis.__cancipArchiveTestFflate;",
  "const DOCUMENT_ARCHIVE_EDIT_MAX_BYTES = 64 * 1024 * 1024;",
  "const DOCUMENT_ARCHIVE_EDIT_MAX_EXPANDED_BYTES = 192 * 1024 * 1024;",
  "const DOCUMENT_ARCHIVE_EDIT_MAX_ENTRIES = 4000;",
  "const normalizePath = (value: string) => value.replace(/\\\\/g, '/');",
  "const decodeDocumentText = (bytes: Uint8Array) => ({ text: new TextDecoder().decode(bytes) });",
  functionSource("utf8Decode"),
  functionSource("readUint16"),
  functionSource("readUint32"),
  functionSource("normalizeDocumentArchiveEntryPath"),
  functionSource("documentArchiveFormat"),
  functionSource("documentArchiveCanRebuild"),
  functionSource("readZipEntries"),
  functionSource("tarHeaderText"),
  functionSource("tarHeaderNumber"),
  functionSource("tarPaxPath"),
  functionSource("readTarEntries"),
  functionSource("writeTarOctal"),
  functionSource("concatenateDocumentBytes"),
  functionSource("replaceTarEntryBytes"),
  functionSource("documentArchiveSingleGzipEntryPath"),
  functionSource("replaceDocumentArchiveEntryBytes"),
  "export { readTarEntries, replaceDocumentArchiveEntryBytes };"
].join("\n\n"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 }
}).outputText;
const archiveApi = await import(`data:text/javascript;base64,${Buffer.from(archiveModule).toString("base64")}`);
const zipFixture = zipSync({ "docs/note.md": strToU8("before"), "image.bin": new Uint8Array([1, 2, 3]) });
const updatedZip = archiveApi.replaceDocumentArchiveEntryBytes(
  { name: "fixture.zip", extension: "zip", basename: "fixture" },
  zipFixture,
  "docs/note.md",
  strToU8("after")
);
const zipFixturePassed = strFromU8(unzipSync(updatedZip)["docs/note.md"]) === "after"
  && [...unzipSync(updatedZip)["image.bin"]].join(",") === "1,2,3";
const tarHeader = new Uint8Array(512);
tarHeader.set(strToU8("docs/note.md"), 0);
tarHeader.set(strToU8("00000000000\0"), 100);
tarHeader.set(strToU8("00000000000\0"), 112);
tarHeader.set(strToU8("00000000000\0"), 124);
tarHeader.set(strToU8("00000000000\0"), 136);
tarHeader.fill(0x20, 148, 156);
tarHeader[156] = "0".charCodeAt(0);
const tarBefore = strToU8("before");
tarHeader.set(strToU8(tarBefore.length.toString(8).padStart(11, "0") + "\0"), 124);
const tarChecksum = tarHeader.reduce((sum, value) => sum + value, 0).toString(8).padStart(6, "0");
tarHeader.set(strToU8(tarChecksum + "\0 "), 148);
const tarFixture = new Uint8Array(512 + 512 + 1024);
tarFixture.set(tarHeader, 0);
tarFixture.set(tarBefore, 512);
const updatedTar = archiveApi.replaceDocumentArchiveEntryBytes(
  { name: "fixture.tar", extension: "tar", basename: "fixture" },
  tarFixture,
  "docs/note.md",
  strToU8("tar after")
);
const tarEntry = archiveApi.readTarEntries(updatedTar, [])[0];
const tarFixturePassed = tarEntry?.size === 9
  && strFromU8(updatedTar.slice(tarEntry.dataOffset, tarEntry.dataOffset + tarEntry.size)) === "tar after";
const gzipFixture = gzipSync(strToU8("before"));
const updatedGzip = archiveApi.replaceDocumentArchiveEntryBytes(
  { name: "note.md.gz", extension: "gz", basename: "note.md" },
  gzipFixture,
  "note.md",
  strToU8("gzip after")
);
const gzipFixturePassed = strFromU8(gunzipSync(updatedGzip)) === "gzip after";
const searchHistoryModule = ts.transpileModule([
  "const VAULT_SEARCH_HISTORY_LIMIT = 40;",
  "const trimContext = (value: string, maxLength: number) => value.length <= maxLength ? value : value.slice(0, maxLength);",
  "const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));",
  functionSource("normalizeVaultSearchHistory"),
  "export { normalizeVaultSearchHistory };"
].join("\n\n"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 }
}).outputText;
const searchHistoryApi = await import(`data:text/javascript;base64,${Buffer.from(searchHistoryModule).toString("base64")}`);
const normalizedSearchHistory = searchHistoryApi.normalizeVaultSearchHistory({ entries: [
  { query: "  爸爸  笔记 ", searchedAt: "2026-07-27T12:00:00.000Z", ai: true },
  { query: "爸爸 笔记", searchedAt: "2026-07-26T12:00:00.000Z", ai: false },
  { query: "PDF 健康", searchedAt: "2026-07-27T13:00:00.000Z", includeArchived: true }
] });
const imageIntent = searchIntentApi.parseSearchQueryIntent("身份证图片");
const imageSearchHits = [
  { path: "附件/身份证-正面.jpg", title: "身份证-正面", excerpt: "OCR semantic tags: 身份证, 证件", score: 10, kind: "image", route: "hard" },
  { path: "笔记/图片整理.md", title: "图片整理", excerpt: "身份证图片归档说明", score: 100, kind: "note", route: "hard" },
  { path: "附件/风景.jpg", title: "风景", excerpt: "海边照片", score: 80, kind: "image", route: "hard" }
];
const strictSearchHits = [
  { path: "日记/爸爸.md", title: "爸爸", excerpt: "今天和爸爸吃饭", score: 10, kind: "note", route: "hard" },
  { path: "日记/爸妈.md", title: "爸妈", excerpt: "家庭记录", score: 9, kind: "note", route: "hard" },
  { path: "人物/父亲.md", title: "父亲", excerpt: "语义相近", score: 30, kind: "note", route: "soft" }
];
const strictSearchKeys = new Set(
  strictSearchHits
    .filter((hit) => hit.route === "hard")
    .map(searchIntentApi.searchHitStrictKey)
);
const strictSearchGroups = searchIntentApi.partitionSearchHitsByOriginalQuery("爸爸", strictSearchHits, strictSearchKeys);
const specificHardExplanation = searchIntentApi.nonStrictSearchHitExplanation("爸爸 旅行", {
  path: "日记/爸爸.md",
  title: "爸爸",
  excerpt: "今天和爸爸吃饭，讨论了下次体检安排。",
  score: 9,
  kind: "note",
  route: "hard"
}, "zh");
const specificSemanticExplanation = searchIntentApi.nonStrictSearchHitExplanation("家庭关心", {
  path: "人物/父亲.md",
  title: "父亲",
  excerpt: "记录父亲最近的睡眠和血压变化。",
  score: 30,
  kind: "note",
  route: "soft",
  relation: "context",
  reason: "记录了需要持续关心的家庭健康情况"
}, "zh");
const genericSemanticExplanation = searchIntentApi.nonStrictSearchHitExplanation("日记 健康", {
  path: "生活/身体/身体概览.md",
  title: "身体概览",
  excerpt: "身体概览：身高体重、饮食、眼睛保健和核心体质训练记录。",
  score: 28,
  kind: "note",
  route: "soft",
  relation: "concept",
  reason: "索引内容关联：身体状态追踪、运动与眼睛保健、饮食及体重管理"
}, "zh");
const upgradedSearchEvidence = searchIntentApi.mergeSearchHitEvidence({
  path: "生活/身体/健康.md",
  title: "健康.md",
  excerpt: "生活/身体/健康.md",
  score: 338,
  kind: "note",
  route: "hard"
}, {
  path: "生活/身体/健康.md",
  title: "健康.md",
  excerpt: "硬搜索 · 笔记 · on-demand\n身体保暖、饮食、眼睛和减肥记录。",
  score: 386,
  kind: "note",
  route: "hard"
});
const diarySpecificEvidence = searchIntentApi.searchDocumentSpecificEvidence([
  "---",
  "tags:",
  "- 日记",
  "cancip_diary_update: \"今天调试了朗读按钮并理清规则优先级。\"",
  "---",
  "## 今日计划",
  "- [ ] 晚间22，周5 #日记 运动、口语",
  "- [ ] 日记待办"
].join("\n"), ["日记"], "常用/日记/2026-07-24.md");
const categorizedSearchHits = [
  ...imageSearchHits,
  { path: "媒体/访谈.mp4", title: "访谈", excerpt: "视频", score: 8, kind: "file", route: "hard" },
  { path: "媒体/录音.flac", title: "录音", excerpt: "音频", score: 7, kind: "file", route: "hard" },
  { path: "资料/报告.pdf", title: "报告", excerpt: "PDF", score: 6, kind: "pdf", route: "hard" },
  { path: "资料/统计.xlsx", title: "统计", excerpt: "工作簿", score: 5, kind: "office", route: "hard" }
];
const finalFailureModule = ts.transpileModule([
  functionSource("promptRequestsResultOnly"),
  functionSource("explicitlyRequestsMultiAgentExecution"),
  functionSource("requestedMultiAgentCount"),
  functionSource("concreteFinalActionLabel"),
  functionSource("conciseFinalRequirementFailure"),
  functionSource("concreteFailedFinalFallback"),
  functionSource("deterministicFinalChoiceFallback"),
  functionSource("exactFinalChoiceOptionsFromTexts"),
  "export { promptRequestsResultOnly, explicitlyRequestsMultiAgentExecution, concreteFailedFinalFallback, deterministicFinalChoiceFallback, exactFinalChoiceOptionsFromTexts };"
].join("\n\n"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 }
}).outputText;
const finalFailureApi = await import(`data:text/javascript;base64,${Buffer.from(finalFailureModule).toString("base64")}`);
const failedMultiAgentPrompt = "请用两个子 Agent 分别独立计算 12+30 并互相核对，最终只回答结果，并给出3个与本题直接相关的推荐项。";
const failedMultiAgentFallback = finalFailureApi.concreteFailedFinalFallback(
  failedMultiAgentPrompt,
  "42",
  [{
    id: "fixture-index-run",
    action: { type: "command", command: "cancip.tools.index", args: { query: "subagents" } },
    summary: "command cancip.tools.index",
    status: "executed",
    createdAt: "2026-07-27T23:28:05.079Z",
    result: "能力解析（只读索引，不替模型决定动作）"
  }],
  "missing hidden final-review status",
  true
);
const failedMultiAgentChoices = finalFailureApi.deterministicFinalChoiceFallback(failedMultiAgentPrompt, "42", 3);
const exactMultiAgentChoices = finalFailureApi.exactFinalChoiceOptionsFromTexts(failedMultiAgentChoices);
const documentInlineModule = ts.transpileModule([
  functionSource("escapeHtml"),
  functionSource("escapeHtmlAttribute"),
  functionSource("safeDocumentMarkdownHref"),
  functionSource("renderDocumentMarkdownInlineText"),
  functionSource("renderDocumentMarkdownInline"),
  "export { renderDocumentMarkdownInline };"
].join("\n\n"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 }
}).outputText;
const documentInlineApi = await import(`data:text/javascript;base64,${Buffer.from(documentInlineModule).toString("base64")}`);
const safeOfficeLink = documentInlineApi.renderDocumentMarkdownInline("**粗体**，[Obsidian 链接](https://obsidian.md?a=1&b=2)。");
const unsafeOfficeLink = documentInlineApi.renderDocumentMarkdownInline("[危险](javascript:alert(1))");
const markdownEmbedModule = ts.transpileModule([
  functionSource("decodeUriComponentSafely"),
  functionSource("markdownEmbedLinkpaths"),
  functionSource("markdownEmbedResourceCandidates"),
  "export { markdownEmbedLinkpaths, markdownEmbedResourceCandidates };"
].join("\n\n"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 }
}).outputText;
const markdownEmbedApi = await import(`data:text/javascript;base64,${Buffer.from(markdownEmbedModule).toString("base64")}`);
const parsedMarkdownEmbedTargets = markdownEmbedApi.markdownEmbedLinkpaths([
  "![](文档/报告.docx)",
  "![表格](文档/统计.xlsx)",
  "![](文档/项目说明.pptx)",
  "![[文档/演示.html|网页]]",
  "![](书籍/交易心理分析.epub)",
  "![](归档/日记2026-02.zip)"
].join("\n"));
const desktopMarkdownEmbedCandidates = markdownEmbedApi.markdownEmbedResourceCandidates(
  "app://local/D:/Vault/%E6%96%87%E6%A1%A3/%E6%8A%A5%E5%91%8A.docx?mtime=1",
  "D:/Vault"
);
const encodedDesktopMarkdownEmbedCandidates = markdownEmbedApi.markdownEmbedResourceCandidates(
  "app://obsidian.md/D%3A/Vault/%E6%96%87%E6%A1%A3/%E7%BB%9F%E8%AE%A1.xlsx#page=1",
  "D:/Vault"
);

const checks = [
  ["session notifications prefer the Ntfy hub and keep direct ntfy as unavailable-plugin fallback", source.includes("type NotificationHubApi") && source.includes("notificationHubApi(): NotificationHubApi | null") && source.includes('runtime.api.send !== "function"') && source.includes('source: "cancip"') && source.includes('event: `session-${input.status}`') && source.indexOf("const hub = this.notificationHubApi()") < source.indexOf('const topic = settings.ntfyTopic.trim()') && source.includes('if (!result || result.ok !== true)')],
  ["LAN synchronization is owned by Ntfy and absent from Cancip", !source.includes("lanSync") && !source.includes("CancipLanSync") && !source.includes("settingsLanSync") && !styles.includes("obcc-lan")],
  ["OCR command", source.includes('id: "recognize-active-file-ocr"')],
  ["OCR file-menu action", source.includes('setIcon("scan-text")') && source.includes("void this.openOcrResult(file)")],
  ["manual PDF OCR requests every page", source.includes("readOcrForVaultFile(file, false, undefined, true)") && source.includes("Number.MAX_SAFE_INTEGER")],
  ["OCR cache keeps every page", /const pages = Array\.isArray\(raw\.pages\)[\s\S]*?\}\)\) : undefined;/.test(source)],
  ["OCR modal exposes rename and Markdown extraction", source.includes("class CancipOcrResultModal") && source.includes("renameFileFromOcr") && source.includes("extractOcrMarkdown")],
  ["OCR Markdown keeps one visible source link and hidden data", source.includes("[${visibleName}](<${file.path}>)") && source.includes('"<!-- cancip-ocr"')],
  ["OCR semantic index recognizes identity cards and optional local faces", identityCardTags.includes("身份证") && identityCardTags.includes("ID card") && identityCardTags.includes("证件") && source.includes("detectBrowserVisualSemanticTags") && source.includes('tags.push("人物", "人脸", "肖像"') && source.includes("entry.semanticTags.join")],
  ["PDF OCR preserves page visual semantics in its searchable index", source.includes("semanticTags: pageEntry.semanticTags") && source.includes("pages.flatMap((page) => page.semanticTags)") && source.includes("allBlocks, pageSemanticTags")],
  ["legacy OCR caches gain semantic tags without repeating recognition", migratedIdentityCache.schemaVersion === 3 && migratedIdentityCache.semanticTags.includes("身份证") && source.includes("entry.schemaVersion !== OCR_CACHE_SCHEMA_VERSION - 1") && source.includes("await adapter.write(path")],
  ["described image queries preserve explicit image intent", imageIntent.requestedKinds.includes("image") && imageIntent.subjectQuery === "身份证" && source.includes("parseSearchQueryIntent")],
  ["strict search contains only actual original-keyword matches", strictSearchGroups.precise.length === 1 && strictSearchGroups.precise[0].path === "日记/爸爸.md" && strictSearchGroups.more.some((hit) => hit.path === "日记/爸妈.md") && strictSearchGroups.more.some((hit) => hit.path === "人物/父亲.md") && source.includes("partitionSearchHitsByOriginalQuery(input.value, hits, strictHitKeys)")],
  ["search categories preserve all-results first and classify media by extension", source.includes('{ id: "all", icon: "library-big" }') && source.indexOf('{ id: "image", icon: "image" }') < source.indexOf('{ id: "video", icon: "video" }') && searchIntentApi.searchHitsForCategory(categorizedSearchHits, "all").length === categorizedSearchHits.length && searchIntentApi.searchHitsForCategory(categorizedSearchHits, "image").length === 2 && searchIntentApi.searchHitsForCategory(categorizedSearchHits, "video")[0]?.path.endsWith(".mp4") && searchIntentApi.searchHitsForCategory(categorizedSearchHits, "audio")[0]?.path.endsWith(".flac")],
  ["empty search catalogs the Vault by category and keeps config filters explicit", source.includes("async allVaultSearchHits(options") && source.includes("includeConfigs: configs.checked") && source.includes("setSearchStatus(\"complete\", searchStatusWithCount(this.t(\"searchCatalogReady\")") && source.includes("!input.value.trim()")],
  ["search results use bounded thumbnails for images and file-type fallback markers", source.includes('cls: "obcc-search-result-thumb"') && source.includes('cls: "obcc-search-result-thumbnail"') && source.includes('image.loading = "lazy"') || (source.includes('cls: "obcc-search-result-thumbnail"') && styles.includes(".obcc-search-result-thumb") && styles.includes("object-fit: cover"))],
  ["native Markdown PDF image audio and video embeds stay native while unsupported files use the workbench", source.includes("registerMarkdownPostProcessor") && source.includes('kind !== "markdown"') && source.includes('kind !== "pdf"') && source.includes('kind !== "image"') && source.includes('kind !== "audio"') && source.includes('kind !== "video"') && inlineEmbedSource.includes("!this.isUnsupportedMarkdownWorkbenchFile(file, sourcePath)") && !source.includes('"a.internal-link"') && inlineEmbedSource.includes("renderMarkdownWorkbenchEmbed")],
  ["standard Markdown embeds including EPUB and archives resolve without angle-bracket syntax", parsedMarkdownEmbedTargets.join("|") === "文档/报告.docx|文档/统计.xlsx|文档/项目说明.pptx|文档/演示.html|书籍/交易心理分析.epub|归档/日记2026-02.zip" && desktopMarkdownEmbedCandidates.includes("文档/报告.docx") && encodedDesktopMarkdownEmbedCandidates.includes("文档/统计.xlsx") && source.includes("context.getSectionInfo(element)?.text") && inlineEmbedSource.includes("fallbackTarget")],
  ["cold Markdown embeds render from detached fragments without blocking on a warmed workbench", !inlineEmbedSource.includes("if (!element.isConnected) return") && inlineEmbedSource.includes("private processMarkdownWorkbenchEmbeds(element: HTMLElement, context: MarkdownPostProcessorContext): void") && inlineEmbedSource.includes("root.replaceWith(wrapper)") && inlineEmbedSource.includes("const lifecycle = new MarkdownRenderChild(wrapper)") && inlineEmbedSource.includes("void this.renderMarkdownWorkbenchEmbed(wrapper, file, lifecycle)") && !inlineEmbedSource.includes("await this.renderMarkdownWorkbenchEmbed(wrapper, file, context)") && inlineEmbedSource.includes("const snapshot = await this.loadDocumentSnapshot(file)")],
  ["concurrent cold and hydration previews share one document snapshot build", source.includes("private documentSnapshotBuilds = new Map<string, Promise<DocumentSnapshot>>()") && source.includes("const pending = this.documentSnapshotBuilds.get(key)") && source.includes("if (pending) return await pending") && source.includes("this.documentSnapshotBuilds.set(key, build)") && source.includes("this.documentSnapshotBuilds.get(key) === build")],
  ["cached Markdown reading views hydrate unsupported generic embeds once per leaf file revision", source.includes("scheduleMarkdownWorkbenchHydrationForOpenLeaves") && source.includes('on("active-leaf-change"') && source.includes('on("file-open"') && source.includes('view.getMode() !== "preview"') && source.includes('view.contentEl.querySelector<HTMLElement>(".markdown-preview-view")') && source.includes('".internal-embed.file-embed.mod-generic[src]"') && source.includes("renderCachedMarkdownWorkbenchEmbeds(view, genericEmbeds)") && source.includes("markdownWorkbenchHydratedKeys.get(leaf) === key")],
  ["cached generic embeds render directly inside the real Markdown view lifecycle", source.includes("private async renderCachedMarkdownWorkbenchEmbeds(view: MarkdownView") && source.includes("const lifecycle = new MarkdownRenderChild(view.contentEl)") && source.includes("view.addChild(lifecycle)") && source.includes("await this.renderMarkdownWorkbenchEmbed(wrapper, target, lifecycle)") && source.includes("if (rendered === 0) view.removeChild(lifecycle)") && !source.includes("previewMode.rerender.call(previewMode, true)")],
  ["cached embed hydration waits for stable native nodes and repairs loader overwrites", source.includes("markdownWorkbenchGenericSeenAt") && source.includes("now - firstSeenAt < 500") && source.includes("scheduleMarkdownWorkbenchHydrationVerification(leaf, key)") && source.includes("const hasRemainingGeneric") && source.includes("this.markdownWorkbenchHydratedKeys.delete(leaf)") && source.includes("this.scheduleMarkdownWorkbenchHydration(leaf)")],
  ["cached Markdown hydration stays bounded and leaves native embeds untouched", source.includes("const delays = [0, 80, 240, 600, 1400, 3000] as const") && source.includes("markdownFileMayNeedWorkbenchHydration") && source.includes("isUnsupportedMarkdownWorkbenchFile") && source.includes('kind !== "markdown"') && source.includes('kind !== "pdf"') && source.includes('kind !== "image"') && source.includes('kind !== "audio"') && source.includes('kind !== "video"')],
  ["cached Markdown hydration timers are cancelled on unload", source.includes("for (const timer of this.markdownWorkbenchHydrationTimers.values()) window.clearTimeout(timer)") && source.includes("this.markdownWorkbenchHydrationTimers.clear()")],
  ["embedded attachment file-open events cannot replace the active Markdown note with a workbench", source.includes("private scheduleDefaultDocumentWorkbench(file: TFile)") && source.includes("const activeFile = (activeLeaf?.view as unknown as { file?: TFile } | undefined)?.file") && source.includes("activeFile instanceof TFile && normalizePath(activeFile.path) !== normalizePath(file.path)")],
  ["unsupported inline workbench previews fit short content and cap long iframe content", source.includes("inlineWorkbenchPreviewWithHeightReporter") && source.includes('cancip-inline-workbench-height-v1') && inlineEmbedSource.includes("Math.ceil(reportedHeight) + 2") && styles.includes("height: auto;") && styles.includes("max-height: min(68vh, 660px);") && styles.includes("height: clamp(160px, 34vh, 360px);")],
  ["inline workbench previews use one native two-axis scroller without full-workbench gesture capture", source.includes('name="cancip-inline-workbench"') && source.includes('html{height:100%!important;overflow:hidden!important}') && source.includes('body{height:100%!important;min-height:100%!important;overflow:auto!important;overscroll-behavior-x:contain!important;overscroll-behavior-y:auto!important') && source.includes('const pptxMode = kind === "pptx"') && source.includes('.cancip-mpe-office-pages{display:flex!important;flex-direction:column!important;align-items:center!important') && source.includes('.cancip-office-preview{overflow:visible!important') && source.includes('.cancip-office-preview table{width:max-content!important;min-width:100%!important;max-width:none!important}') && !source.includes('overflow-x:auto!important;overflow-y:visible!important') && source.includes('const inlineWorkbench=document.querySelector') && source.includes('if(!inlineWorkbench&&typeof PointerEvent==="function")') && source.includes('}else if(!inlineWorkbench){') && inlineEmbedSource.includes('inlineWorkbenchPreviewWithHeightReporter(snapshot.previewHtml, heightToken, snapshot.kind)') && inlineEmbedSource.includes('frame.setAttribute("scrolling", "yes")') && styles.includes("touch-action: pan-x pan-y;")],
  ["workbench viewport state persists scroll, zoom, and editor caret per file", source.includes("document-viewports.json") && source.includes("documentViewportStateFor") && source.includes("rememberDocumentViewport") && source.includes("caretStart") && source.includes("scrollLeft") && workbenchSource.includes("restoreDocumentViewport(body)")],
  ["search categories sort by live result count while all-results stays first", source.includes('orderedSearchCategories = [') && source.includes('"all",') && source.includes('(hitCounts.get(right) ?? 0) - (hitCounts.get(left) ?? 0)') && source.includes('view.button.style.order = String(order)') && source.includes('view.page.style.order = String(order)')],
  ["search category pages support tabs, swipe snapping, and independent vertical scrolling", source.includes('cls: "obcc-search-category-tabs"') && source.includes('cls: "obcc-search-page-viewport"') && source.includes("const categoryTrack = categoryViewport") && source.includes('categoryViewport.addEventListener("scroll"') && source.includes("setActiveSearchCategory(definition.id, true, true)") && source.includes('event.key === "ArrowRight"') && styles.includes("scroll-snap-type: x mandatory") && styles.includes("scroll-snap-align: start") && styles.includes(".obcc-search-page") && styles.includes("overflow-y: auto")],
  ["explicit attachment types receive an early index ranking boost", source.includes("const kindBoost = intent.requestedKinds.length") && source.includes("const queryIntent = parseSearchQueryIntent(normalizedQuery)") && source.includes("? 1800 : 0")],
  ["background index shares automation startup grace and only fills missing image OCR", source.includes("Math.max(delayMs, UNIVERSAL_SEARCH_MOBILE_BACKGROUND_DELAY_MS, startupDelay)") && source.includes("missingImageOcr") && source.includes("ocrIndexed: true") && source.includes("rescheduleUniversalSearchBuildForStartupGrace")],
  ["background indexing stays bounded while OCR is hidden-only, low-resolution, and one-file-at-a-time", source.includes("const UNIVERSAL_SEARCH_TEXT_BUILD_BATCH = 8") && source.includes("const UNIVERSAL_SEARCH_BACKGROUND_DELAY_MS = 30000") && source.includes("scheduleUniversalSearchBackgroundOcr") && source.includes("UNIVERSAL_SEARCH_BACKGROUND_OCR_IDLE_MS") && source.includes('doc.visibilityState !== "hidden"') && source.includes("readBackgroundOcrForVaultImage") && source.includes("Math.min(960, this.settings.ocrMaxImageDimension)") && source.includes("await this.disposeOcrRuntime()") && source.includes("processed = true") && source.includes("universalSearchDocumentText(item.path, item.kind, maxTextChars, full)")],
  ["background binary extraction runs only while Obsidian is hidden", source.includes("UNIVERSAL_SEARCH_BACKGROUND_BINARY_DELAY_MS") && source.includes("allowBackgroundBinary") && source.includes('doc.visibilityState === "hidden"') && source.includes("universalSearchBinaryDeferred") && source.includes("fairUniversalSearchBuildBatch(binaryPending, binaryBatchLimit)")],
  ["session and config metadata finish in cheap background batches", source.includes("UNIVERSAL_SEARCH_BACKGROUND_METADATA_BATCH = 240") && source.includes('item.kind === "session" || item.kind === "config"') && source.includes("...metadataPending")],
  ["unchanged search shards avoid repeated large JSON writes", source.includes("complete: documents.every((document) => Boolean(document.bloom))") && source.includes("cursor: 0") && source.includes("writeUniversalSearchIndexFileIfChanged")],
  ["search UI has no hard-result pane", !source.includes('const hardSection = results.createEl("details"') && !source.includes("renderHits(hardResults")],
  ["AI search history persists deduplicated queries and restores search options", normalizedSearchHistory.length === 2 && normalizedSearchHistory[0].query === "PDF 健康" && normalizedSearchHistory[1].query === "爸爸 笔记" && source.includes("VAULT_SEARCH_HISTORY_PATH") && source.includes("rememberVaultSearch") && source.includes("removeVaultSearchHistory") && source.includes("clearVaultSearchHistory") && source.includes('cls: "obcc-search-history"') && source.includes("aiEnabled.checked = entry.ai") && styles.includes(".obcc-search-history-list") && styles.includes("overflow-y: auto")],
  ["search history switches between five closed rows and six non-overlapping open rows", source.includes('popover.toggleClass("has-search-history", open)') && /\.obcc-search-popover\s*\{[^}]*grid-template-rows:\s*auto auto auto auto minmax\(0, 1fr\) !important/s.test(styles) && /\.obcc-search-popover\.has-search-history\s*\{[^}]*grid-template-rows:\s*auto auto auto auto auto minmax\(0, 1fr\) !important/s.test(styles) && styles.includes(".obcc-search-history.is-open") && styles.includes("grid-template-rows: auto minmax(0, 1fr)") && /\.obcc-search-history-row\s*\{[^}]*min-height:\s*50px/s.test(styles) && /\.obcc-search-history-apply\s*\{[^}]*height:\s*auto !important;[^}]*min-height:\s*50px/s.test(styles) && styles.includes("grid-template-rows: auto auto;")],
  ["AI search checkbox is visible and enabled by default", source.includes('const aiEnabled = aiLabel.createEl("input"') && source.includes("aiEnabled.checked = true") && source.includes('aiEnabled.addEventListener("change"')],
  ["one search pane also renders base results when AI is off", source.includes("if (!aiEnabled.checked)") && source.includes("rememberKeywordHits(hardHits)") && source.includes("renderSearchPages(visibleSearchHits())")],
  ["single titleless search pane fills the result area and scrolls", source.includes("const aiSection = results.createDiv") && source.includes('cls: "obcc-search-section is-ai is-titleless"') && !source.includes("const aiSummary =") && !source.includes("aiSummaryLabel") && !source.includes('results.createEl("details", { cls: "obcc-search-section is-ai is-titleless"') && styles.includes(".obcc-search-section.is-ai.is-titleless") && styles.includes("max-height: 100% !important") && styles.includes("overflow: hidden !important") && styles.includes("grid-template-rows: minmax(0, 1fr) !important") && styles.includes(".obcc-search-section.is-ai .obcc-search-section-results") && styles.includes("overflow-y: auto")],
  ["AI search keeps keyword results first and only appends semantic/RAG hits", source.includes("includeAttachments: !aiEnabled.checked") && source.includes("rememberKeywordHits(exactHits)") && source.includes("rememberSemanticHits(progress.hits)") && source.includes("visibleSearchHits") && source.includes('setAiExplanation([aiSearch.expansion.intent, terms]')],
  ["AI search shows loading and completion states with a spinner", source.includes('setIcon(statusIcon, state === "searching" ? "loader-circle"') && source.includes('setSearchStatus("searching", this.t("searchSearching"))') && source.includes('setSearchStatus("complete", searchStatusWithCount(this.t("searchCompleted")') && styles.includes("obcc-search-status-spin")],
  ["completed AI explanation is independently collapsible", source.includes('createEl("details", { cls: "obcc-search-section-explanation is-empty"') && source.includes('cls: "obcc-search-explanation-summary"') && source.includes("const setAiExplanation") && styles.includes(".obcc-search-section-explanation[open]")],
  ["related search results stay expanded with a plain divider", source.includes('const more = parent.createDiv({ cls: "obcc-search-more" })') && source.includes('cls: "obcc-search-more-divider"') && !source.includes('const more = parent.createEl("details", { cls: "obcc-search-more"') && !source.includes("obcc-search-more-divider-icon") && !styles.includes(".obcc-search-more-divider::after") && !styles.includes(".obcc-search-more-divider-icon")],
  ["every non-strict result receives a relationship explanation", source.includes("const explanation = secondary") && source.includes("nonStrictSearchHitExplanation(input.value, hit, this.plugin.language())") && source.includes("renderRows(moreRows, groups.more, true)") && source.includes("searchHitEvidenceSnippet")],
  ["non-strict explanations share one short shell with file-specific evidence", specificHardExplanation.startsWith("匹配：正文“爸爸”｜依据：") && specificHardExplanation.includes("今天和爸爸吃饭") && !specificHardExplanation.includes("《爸爸》") && !specificHardExplanation.includes("未完整匹配") && specificSemanticExplanation.startsWith("匹配：记录了需要持续关心的家庭健康情况｜依据：") && specificSemanticExplanation.includes("睡眠和血压变化") && !specificSemanticExplanation.includes("《父亲》") && genericSemanticExplanation.startsWith("匹配：概念相关｜依据：身体概览") && !genericSemanticExplanation.includes("索引内容关联") && specificHardExplanation.length < 90 && specificSemanticExplanation.length < 100 && genericSemanticExplanation.length < 90],
  ["later full-text hits upgrade path-only evidence for the same file", upgradedSearchEvidence.excerpt.includes("身体保暖、饮食") && upgradedSearchEvidence.score === 386 && source.includes("mergeSearchHitEvidence(existing, hit)")],
  ["keyword hits hydrate file-specific evidence in bounded batches", diarySpecificEvidence === "今天调试了朗读按钮并理清规则优先级。" && source.includes("const hydrateKeywordHitEvidence = async") && source.includes("const candidates = [...keywordHits]") && source.includes("candidates.slice(offset, offset + 6)") && source.includes("this.plugin.universalSearchDocumentText(hit.path, hit.kind, 12000)") && source.includes("searchDocumentSpecificEvidence(content, terms, hit.path)") && source.includes("replacement ? { ...hit, excerpt: replacement.excerpt } : hit") && source.includes("await evidenceUpgradePromise")],
  ["all search explanations use the theme blue color", /\.obcc-search-result-reason\s*\{[^}]*color:\s*var\(--color-blue/s.test(styles) && /\.obcc-search-explanation-summary\s*\{[^}]*color:\s*var\(--color-blue/s.test(styles) && /\.obcc-search-explanation-text\s*\{[^}]*color:\s*var\(--color-blue/s.test(styles)],
  ["search renders fast local hits then incremental AI/RAG phases", source.includes("private async fastIndexedVaultSearchHits") && source.includes('phase: "expansion"') && source.includes('phase: "retrieval"') && source.includes("onProgress?.({ phase: \"ranked\"") && source.includes("expansion.styleSignals.slice(0, 2)") && source.includes("Math.ceil(resultLimit / 2)")],
  ["search highlights multi-character and word-root matches", source.includes("function searchHighlightTerms") && source.includes("function searchWordRootVariants") && source.includes("appendHighlightedSearchText") && styles.includes(".obcc-search-match")],
  ["AI expansion re-enters Vault content search", source.includes("softQueries: expandedSignals") && source.includes("alwaysRunOnDemand: true") && source.includes("alwaysRunAttachments: true")],
  ["lightweight local RAG ranks bounded cached chunks", source.includes("private async lightweightRagHits") && source.includes("lightweightRagTextChunks") && source.includes("rankLightweightRagChunks") && source.includes("lightweightRagDocumentCache") && source.includes("includeRag: true")],
  ["unindexed documents receive on-demand priority", source.includes("const unindexedPaths = new Set(") && source.includes("preferredPaths.has(normalizePath(file.path))")],
  ["on-demand search scans every eligible text file and full content", source.includes("Scan every eligible text") && source.includes("const contents = await Promise.all(batch.map") && source.includes("scoreSearchText(file.path, file.basename, content, tokens)")],
  ["search requests stay bound to the popover instance that created them", source.includes("const isRequestActive = (expectedRequestId: number)") && source.includes("this.searchPopoverEl === popover") && source.includes("if (!isRequestActive(currentRequestId)) return")],
  ["closing search invalidates in-flight local and AI work", source.includes("closed = true;") && source.includes("requestId += 1;") && source.includes("cancelled: () => !isRequestActive(currentRequestId)") && source.includes("}, () => !isRequestActive(currentRequestId));")],
  ["cancelled on-demand batches stop before and after asynchronous reads", /private async onDemandVaultSearchHits[\s\S]*?cancelled: \(\) => boolean = \(\) => false[\s\S]*?for \(let offset[\s\S]*?if \(cancelled\(\)\) return \[\];[\s\S]*?Promise\.all[\s\S]*?if \(cancelled\(\)\) return \[\];/.test(source)],
  ["archive workbench browses folders and opens entries in the same workbench", source.includes("private renderArchiveDirectory") && source.includes("private renderArchiveBreadcrumbs") && source.includes("private async openArchiveEntry") && source.includes("await this.renderArchiveWorkbench(parent, snapshot)") && source.includes('setIcon(root, "archive")') && styles.includes(".obcc-archive-list") && styles.includes(".obcc-archive-breadcrumbs")],
  ["ZIP TAR and GZIP text entries rebuild safely without losing sibling ZIP files", zipFixturePassed && tarFixturePassed && gzipFixturePassed && source.includes("DOCUMENT_ARCHIVE_EDIT_MAX_EXPANDED_BYTES") && source.includes("Encrypted ZIP archives cannot be safely rebuilt") && source.includes("Archive entry save verification failed") && source.includes("await this.app.vault.modifyBinary(file, rollback)")],
  ["archive entries preview text Markdown HTML images PDF audio and video", source.includes('type DocumentArchiveEntryPreviewKind = "markdown" | "html" | "text" | "pdf" | "image" | "audio" | "video" | "binary"') && source.includes('content.previewKind === "markdown"') && source.includes('content.previewKind === "html"') && source.includes('["image", "pdf", "audio", "video"].includes(content.previewKind)') && source.includes("URL.createObjectURL") && styles.includes(".obcc-archive-entry-surface")],
  ["special ZIP containers plus RAR and 7Z stay explicit read-only formats", source.includes('if (format === "zip") return file.extension.toLowerCase() === "zip"') && source.includes('if (extension === "rar") return "rar"') && source.includes('if (extension === "7z") return "7z"') && source.includes("content preview requires a compatible decompressor") && source.includes("containers are preview-only to preserve their package structure") && source.includes("archives are read-only in this runtime")],
  ["total timer starts synchronously and cannot trail a running step", source.includes("this.ensureCurrentSessionTimelineStatus(status, now)") && source.indexOf("this.ensureCurrentSessionTimelineStatus(status, now)") < source.indexOf("const index = await this.readSessionHistoryIndex({ mergeFiles: false })") && source.includes("private headerSessionTimerStartMs")],
  ["timers use milliseconds below one second, tenths below one minute, and whole seconds after one minute", source.includes('if (safe < 1000) return `${safe}ms`') && source.includes("(safe / 1000).toFixed(1)") && source.includes('String(Math.floor((safe % 60000) / 1000)).padStart(2, "0")')],
  ["numbered process steps have right-aligned bordered timers", source.includes('cls: "obcc-process-step-timer"') && styles.includes(".obcc-process-step-timer") && styles.includes("min-width: 46px") && styles.includes("justify-self: end") && styles.includes("grid-template-columns: 14px 20px minmax(0, 1fr) max-content max-content")],
  ["live progress avoids unconditional Markdown rerender", source.includes("signature !== renderedSignature && now >= nextRenderAt")],
  ["subagents launch concurrently", source.includes("await Promise.allSettled(specs.map((spec)")],
  ["explicit multi-agent lets the main agent choose strategy but requires real children", source.includes("Your first executable action batch must call cancip.subagents.parallel with at least 2 real child sessions") && source.includes("price, latency, capability, recent success, and current availability") && source.includes("!responseStartsParallelSubagents(answer, 2)")],
  ["explicit textual multi-agent requests also require the real parallel route", finalFailureApi.explicitlyRequestsMultiAgentExecution(failedMultiAgentPrompt) && !finalFailureApi.explicitlyRequestsMultiAgentExecution("修复多 Agent 设置里的按钮样式") && source.includes("|| explicitlyRequestsMultiAgentExecution(rawPrompt)")],
  ["parallel subagents distribute configured models", source.includes("const availableProfiles = this.availableSubagentProfiles(requestedModels)") && source.includes("model: assignedProfile.model")],
  ["failed subagent models fall back automatically", source.includes("private subagentFallbackProfiles") && source.includes("Retrying with fallback model") && source.includes("completedProfile")],
  ["parallel subagents infer a missing top-level goal", source.includes("const inferredAgentGoal = uniqueStrings(requestedRows") && source.includes('this.resolveTaskGoal("").trim()')],
  ["successful parallel subagents complete their linked Plan step", source.includes("private async completeSuccessfulSubagentPlanStep") && source.includes('terminal.some((entry) => entry.status !== "completed")') && source.includes("todo.completedAt = completedAt")],
  ["subagent consensus falls back without erasing completed child work", source.indexOf("await this.completeSuccessfulSubagentPlanStep(") < source.indexOf("const consensusRequested = args.consensus") && source.includes("for (const candidateProfile of [profile, ...this.subagentFallbackProfiles(profile)])") && source.includes('status: "subagent-consensus-model-unavailable"')],
  ["non-terminal continuation text is not flashed as a final answer", source.includes("A continuation reply without a terminal marker") && source.includes("const terminalAnswer = visibleAnswer && terminalStatus")],
  ["accepted final messages retain terminal metadata", source.includes("const finalAnswerContent = acceptedVisibleAnswer && reviewStatus") && source.includes("JSON.stringify({ status: reviewStatus })")],
  ["explicit recommendation counts are part of terminal validation", source.includes("private finalChoiceRequirementFailure") && source.includes("function requestedFinalChoiceCount") && source.includes("const requirementFailure = nonChoiceFailure || choiceFailure") && source.includes("Count the array items before returning") && source.includes("const required = requestedFinalChoiceCount(originalPrompt) || 3")],
  ["terminal recommendation repair preserves one final message", source.includes("private async repairFinalChoicesForCandidate") && source.includes("repaired terminal recommendations") && source.includes("this.attachChoiceSource(assistantMessage, choiceSource)")],
  ["failed terminal review preserves concrete AI output and exact real-session evidence", failedMultiAgentFallback.startsWith("42") && /两个真实子\s*Agent未启动/i.test(failedMultiAgentFallback) && failedMultiAgentFallback.includes("cancip.tools.index") && !failedMultiAgentFallback.includes("请用两个") && !failedMultiAgentFallback.includes("patch/write") && source.includes("private async concreteFailureConclusion") && source.includes("prompt.final_concrete_failure_summary") && source.includes("failedCandidateState.value = candidate")],
  ["verified protocol candidates complete with exact local recommendation fallback", failedMultiAgentChoices.length === 3 && failedMultiAgentChoices.every((choice) => choice.includes("12+30") || choice.includes("12 + 30")) && failedMultiAgentChoices.some((choice) => choice.includes("42")) && source.includes("private canConcludeProtocolCandidate") && source.includes("Preserved the concrete model candidate after verified tool completion")],
  ["result-only requests keep the visible answer free of programmatic audit prose", finalFailureApi.promptRequestsResultOnly(failedMultiAgentPrompt) && finalFailureApi.promptRequestsResultOnly("Only answer the result") && finalFailureApi.promptRequestsResultOnly("最后只回答该文件第一个 Markdown 标题") && !finalFailureApi.promptRequestsResultOnly("请解释结果并给出验证过程") && source.includes("promptRequestsResultOnly(originalPrompt)") && source.includes("? visibleAfterTools.content")],
  ["verified final recommendations preserve every exact structured choice", exactMultiAgentChoices.length === 3 && exactMultiAgentChoices.map((choice) => choice.text).join("\n") === failedMultiAgentChoices.join("\n") && source.includes("private attachExactFinalChoices") && source.includes("this.attachExactFinalChoices(message, choices)") && source.includes("this.attachExactFinalChoices(message, conclusion.choices)") && source.includes("message.choiceOptions = storedChoices.length ? mergedChoices")],
  ["parallel session index writes are merged without rescanning or frozen timer waits", source.includes("sessionHistoryWriteQueue: Promise<void>") && source.includes("const run = this.sessionHistoryWriteQueue.then") && source.includes("readSessionHistoryIndexUncached(false)") && !source.includes("Math.max(0, 650 - (Date.now() - this.sessionSaveLastAt))")],
  ["subagent cards render inside their launching process step, not the Plan panel", source.includes("obcc-process-subagent-cards") && source.includes("hydrateProcessSubagentCards") && !source.includes("data-subagent-step-id") && styles.includes(".obcc-subagent-track") && styles.includes("overflow-x: auto")],
  ["subagent cards appear as soon as child sessions are created", source.includes("Make the child visible in the parent process record before its model call finishes") && source.includes("if (parentSessionId === this.sessionId) this.renderMessagesAfterMutation()")],
  ["completed process details default folded and Plan button stays on its numbered step", source.includes('this.wireDetails(step, `process-step:${stepFoldKey}`, isLiveStep || needsIntervention, false, true)') && source.includes("processStepPlanReference") && source.includes("obcc-process-step-plan-button") && source.includes('text: `#${index + 1}`') && !source.includes('cls: "obcc-process-record-meta-button is-plan"')],
  ["every process step keeps a concise auditable reasoning/action/result/next trace", source.includes("type ProcessStepBrief =") && source.includes("processBrief?: ProcessStepBrief") && source.includes("private progressStepBrief(") && source.includes("private toolRunProcessBrief(") && source.includes("private renderProcessStepBrief(") && source.includes("Previous step trace:") && source.includes("normalizeProcessStepBrief") && styles.includes(".obcc-process-step-brief-row")],
  ["model labels preserve both ends when narrow and retain the full accessible value", source.includes("function setMiddleEllipsisText(") && source.includes("middleEllipsisByChars(full)") && source.includes('element.setAttr("aria-label", full)') && source.includes("setMiddleEllipsisText(modelTitle") && source.includes("setMiddleEllipsisText(name") && source.includes("return compact;") && !source.includes("compact.slice(0, 18)") && styles.includes("flex: 0 1 clamp(96px, 42vw, 168px)") && styles.includes("width: clamp(96px, 42vw, 168px)") && styles.includes(".obcc-model-name")],
  ["numbered process titles show task-specific auditable reasoning while fixed runtime states stay folded", source.includes("private processStepTitleFromBrief(") && source.includes("const candidates = [brief.reasoning, fallback, brief.action]") && source.includes("this.processStepTitleFromBrief(stepInfo.brief, stepInfo.headline)") && source.includes("if (!taskSource.trim()) return") && source.includes("模型生成回复") && source.includes("this.renderProcessStepBrief(stepBody, brief)") && !source.includes('stepHead.createSpan({ cls: "obcc-process-step-title", text: this.t("preparingContext") })')],
  ["legacy process traces bind to their own concise user turn and reject unrelated Plan items", source.includes("private taskPromptBeforeMessage(") && source.includes("planNext: null") && source.includes("private processPlanStepMatchesTask(") && source.includes("sourceTokens.some((token) => planTokens.has(token))") && source.includes("private conciseProcessTask(") && source.includes("自动化任务：${automation")],
  ["live and approval steps expand while completed steps respect manual fold state", source.includes("const isLiveStep = this.progressStepTimers.has") && source.includes("const needsIntervention = stepRuns.some") && source.includes("isLiveStep || needsIntervention, false, true")],
  ["composer add-menu buttons have stable IDs", source.includes('id: "interactive-html"') && source.includes('id: "multi-agent"') && source.includes("row.dataset.cancipButtonId = `composer:${kind}:${item.id")],
  ["nested icon/label targets resolve to the stable button host", source.includes('el.closest<HTMLElement>("[data-cancip-button-id]")')],
  ["disconnected stable Cancip buttons remain verifiable", source.includes("const stableDescriptor = Boolean(stableSelectorId") && source.includes("connectedTarget || stableDescriptor")],
  ["legacy button rules remain compatible", source.includes('legacyTargetKey: ["v2"') && source.includes("legacyTargetKeyV1")],
  ["running sessions coalesce one foreground mirror without recursively opening views", source.includes("private sessionOpenRequests = new Map<string, Promise<boolean>>()") && source.includes("const pending = this.sessionOpenRequests.get(entry.id)") && source.includes("allowRunningMirror: true") && source.includes("options.allowRunningMirror !== true") && source.includes("prepareForExplicitSessionLoad()") && source.includes("leaf.view.prepareForExplicitSessionLoad()")],
  ["automatic blank chat views do not persist empty session files", source.includes("private hasPersistableSessionState(): boolean") && source.match(/if \(!this\.hasPersistableSessionState\(\)\) return;/g)?.length >= 2 && source.includes("ensureCurrentSessionRecord(false)") && !source.includes("ensureCurrentSessionRecord(true)")],
  ["new-chat AI overview stays local, lightweight, configurable, and optional", source.includes('aiOverviewEnabled: true') && source.includes('aiOverviewCards: ["sessions", "reviews", "automations", "vault"]') && source.includes("this.renderAiOverview(empty)") && aiOverviewSource.includes("readSessionHistoryIndex({ mergeFiles: false })") && aiOverviewSource.includes("pendingReviewGateAttentionCount(50)") && aiOverviewSource.includes("loadAutomations()") && aiOverviewSource.includes("this.app.vault.getFiles().length") && !aiOverviewSource.includes("buildContext(") && !aiOverviewSource.includes("callModel") && source.includes("if (!Array.isArray(raw) && typeof raw !== \"string\")") && source.includes("return normalized;") && styles.includes(".obcc-ai-overview-card")],
  ["every non-secret setting belongs to a reviewed AI-adjustable and independently resettable module", settingsModuleCoveragePassed && source.includes('id: "overview", label: this.plugin.t("settingsGroupOverview")') && settingsModuleSource.includes("displaySettingsModuleActions(body, active.id, active.label)") && settingsModuleSource.includes("SETTINGS_PAGE_KEYS[pageId]") && settingsModuleSource.includes("settingsModuleAiPrompt") && settingsModuleSource.includes("submitExternalPrompt(prompt)") && settingsModuleSource.includes("confirmCancipAction(") && settingsModuleSource.includes("cloneSettingsModuleValue(DEFAULT_SETTINGS[key])") && settingsModuleSource.includes("normalizeSettings(next)") && source.includes("AI overview management:") && source.includes("Never apply it silently") && styles.includes(".obcc-settings-module-actions")],
  ["HTML mini-app panel lists every Vault HTML file with newest discovery, pinning, manual order, and workbench opening", source.includes('data-cancip-button-id": "header:html-apps"') && source.includes('setIcon(htmlAppsButton, "app-window")') && source.includes("async htmlAppsForPanel()") && source.includes("right.stat.ctime || right.stat.mtime") && source.includes("setHtmlAppPinned") && source.includes("moveHtmlApp") && source.includes("groupPositions") && source.includes('activateDocumentWorkbench(app.file, "preview")') && styles.includes(".obcc-history-popover.is-html-apps") && styles.includes(".obcc-html-app-list")],
  ["HTML mini apps receive a safe Vault interaction library without bypassing Cancip review", source.includes("const vault={") && source.includes('read(path,options={}){return vaultRequest("read"') && source.includes('search(query,options={}){return vaultRequest("search"') && source.includes('write(path,content,options={}){return vaultRequest("write"') && workbenchSource.includes('event.data.type === "vault-request"') && htmlVaultBridgeSource.includes('const path = operation === "search" ? ""') && htmlVaultBridgeSource.includes("readUniversalSearchIndex()") && !htmlVaultBridgeSource.includes(".slice(0, 1200)") && htmlVaultBridgeSource.includes("submitBridgeRawActions([action])") && !htmlVaultBridgeSource.includes("adapter.write") && source.includes("htmlMiniAppVaultPathAllowed") && source.includes("segment.startsWith(\".\")") && source.includes("Cancip.vault.list(folder?")],
  ["TTS highlight uses one strict sentence key while playback remains micro-chunked", source.includes("splitPrimeTtsSentenceFragments(normalized)") && source.includes('const key = `${this.activeTtsSourcePath}:${displayIndex}') && source.includes("highlightActiveRenderedTtsPart(displayText)") && !source.includes("for (const candidate of ttsHighlightCandidateTexts(playText, displayText")],
  ["TTS reads properties and expands embedded Markdown notes", source.includes("ttsSourceWithReadableFrontmatter") && source.includes("expandMarkdownTtsEmbeds") && source.includes("markdownTtsEmbedReferences")],
  ["TTS disabled state blocks reading and local package auto-download", source.includes("ttsEnabled: true") && source.includes('if (!this.settings.ttsEnabled) throw new Error(this.t("ttsDisabled"))') && source.includes('if (!this.settings.ttsEnabled) return this.t("ttsDisabled")') && source.includes("ttsEnabled: settings.ttsEnabled") && source.includes('if (typeof raw.ttsEnabled === "boolean") config.ttsEnabled = raw.ttsEnabled')],
  ["PrimeTTS installs and loads only for actual reading instead of plugin startup", !source.includes("scheduleBuiltinPrimeTtsWarmup") && !source.includes("prewarmBuiltinPrimeTts") && source.includes("await this.assertBuiltinPrimeTtsAssets()") && source.includes("await this.installBuiltinPrimeTtsPackage(false)")],
  ["OCR auto-installs on first use but respects the OCR disabled switch", source.includes("private async ensureOcrPackageForUse(showNotice = false): Promise<boolean>") && source.includes('const message = this.t("ocrDisabled")') && source.includes("await this.installOcrPackage(showNotice)") && source.includes("if (!(await this.ensureOcrPackageForUse(false))) return null")],
  ["new-file and greeting automations stay silent and notification-free by default", source.includes("notifyMode: schemaVersion < 12 && dedicated.notifyMode === \"inherit\" ? \"never\" : dedicated.notifyMode") && source.includes('id: VAULT_CURATION_AUTOMATION_ID') && source.includes('notifyMode: "never",\n      silent: true') && source.includes('id: "auto-personalized-greeting-refresh"') && source.includes('notifyMode: "never",\n      silent: true')],
  ["context edit stays off in native reading view while workbench anchors remain tracked", source.includes("startContextEditAnchorTracking") && source.includes("refreshContextualEditAnchorGeometry") && source.includes('containingLeaf?.view instanceof MarkdownView && element.closest(".markdown-preview-view, .markdown-rendered")') && source.includes("resolvedWorkbenchContext.isEnabled?.() === false")],
  ["context edit defaults to Markdown live preview while pure source requires the spread switch", source.includes("contextualEditSpreadToOtherInputs: false") && source.includes("settingsContextualEditSpreadToOtherInputs") && source.includes('classList.contains("is-live-preview")') && source.includes("if (!this.settings.contextualEditSpreadToOtherInputs && !isMarkdownLivePreviewEdit) return null") && source.includes("contextEditAnchorIsMarkdownSource") && source.includes("!this.settings.contextualEditSpreadToOtherInputs || !frame.isConnected")],
  ["context edit covers main and archive workbench text surfaces with entry identity", source.includes('const CONTEXTUAL_EDIT_TEXTAREA_SELECTOR = "textarea.obcc-document-editor, textarea.obcc-archive-entry-editor"') && source.includes(".obcc-archive-entry-surface, .obcc-archive-entry-editor") && source.includes("contextualEditWorkbenchContext(element: Element)") && source.includes('"data-cancip-archive-entry-path": content.path') && source.includes("registerContextEditFrame(iframe, snapshot.file, {") && source.includes("entryPath: content.path")],
  ["workbench preview contextual edits require the live magic-wand edit mode", source.includes("isEnabled?: () => boolean") && source.includes("resolvedWorkbenchContext.isEnabled?.() === false") && source.includes("isEnabled: () => this.noteDrawMarkdownEditMode") && source.match(/isEnabled: \(\) => this\.noteDrawMarkdownEditMode/g)?.length >= 4],
  ["explicit workbench opening accepts every file type without changing default routing", source.includes('const DOCUMENT_EXPORT_FORMATS = ["md", "html", "pdf", "docx", "png", "pptx"]') && source.includes("canAcceptExtension(extension: string)") && source.includes("void extension") && source.includes("return true;") && source.includes("isDocumentWorkbenchExtension(file.extension)") && source.includes('if (normalized === "md" || normalized === "markdown") return false')],
  ["deferred workbench restoration cannot block explicit opening", !source.includes("    void this.restoreDocumentWorkbenchLeaves();\n    this.ensureDocumentWorkbenchExtensions();") && source.includes("document workbench deferred restore timed out") && source.includes("document workbench leaf restore timed out") && source.match(/sleep\(1500\)/g)?.length >= 2],
  ["workbench export menu exposes all six real document formats", source.includes('this.plugin.t("documentExportMenu")') && source.includes('format: "md"') && source.includes('format: "html"') && source.includes('format: "pdf"') && source.includes('format: "docx"') && source.includes('format: "png"') && source.includes('format: "pptx"') && source.includes("this.exportConversion(item.format)")],
  ["workbench toolbar uses the Cancip icon and omits redundant save and converted-Markdown buttons", workbenchSource.includes('this.addIconButton(actions, "bot", this.plugin.t("documentSendToCancip")') && workbenchSource.includes('this.addIconButton(actions, "ellipsis", this.plugin.t("moreMenu")') && !workbenchSource.includes('this.addIconButton(actions, "save"') && !workbenchSource.includes("documentOpenConvertedMarkdown")],
  ["workbench keeps one NoteDraw wand by using the registered surface action and only rendering a Cancip fallback without a surface", workbenchSource.includes("if (!this.nativeNoteDrawSurfaceHandle)") && workbenchSource.includes('this.addIconButton(actions, "wand-sparkles", this.plugin.t("documentDrawWithNoteDraw")') && workbenchSource.includes("actions.insertBefore(noteDrawButton, exportButton)") && workbenchSource.includes("private noteDrawPublicApi()") && workbenchSource.includes("registerSurface") && workbenchSource.includes("noteDrawWorkbenchViewport") && workbenchSource.includes("registeredSurface.toggle") && workbenchSource.includes("runtime.syncWorkspaceControllers?.()") && workbenchSource.includes('surface.surface === "workspace"') && workbenchSource.includes("private async toggleNoteDrawWorkbenchSurface") && workbenchSource.includes("api.toggle({")],
  ["workbench identifies and removes only Cancip's NoteDraw fallback", workbenchSource.includes('data-cancip-notedraw-fallback') && workbenchSource.includes("private removeNoteDrawFallbackButtons") && workbenchSource.includes("this.removeNoteDrawFallbackButtons(actions)") && workbenchSource.includes("this.removeNoteDrawFallbackButtons(this.contentEl)") && !workbenchSource.includes('querySelectorAll(".notedraw-header-button")')],
  ["inline workbench preview stays in a shadow root outside NoteDraw webview discovery", inlineEmbedSource.includes('head.className = "obcc-inline-workbench-embed-head"') && !inlineEmbedSource.includes("mwv-note-actions") && inlineEmbedSource.includes('className = "obcc-inline-workbench-embed-frame-host"') && inlineEmbedSource.includes('frameHost.attachShadow({ mode: "open" })') && inlineEmbedSource.includes("shadow.appendChild(frame)") && inlineEmbedSource.includes("actual NoteDraw wand remains available")],
  ["workbench More menu exposes share, native opening, properties, and in-place source/Markdown-reading switching", workbenchSource.includes('this.plugin.t("documentShare")') && workbenchSource.includes('this.plugin.t("documentOpenInObsidian")') && workbenchSource.includes('this.plugin.t("documentProperties")') && workbenchSource.includes('this.plugin.t("documentMarkdownReading")') && workbenchSource.includes('this.plugin.t("documentBackToSourceMarkdown")') && workbenchSource.includes('sourceMode ? "markdown-reading" : "markdown"') && workbenchSource.includes("const menuWidth = Math.min(360") && workbenchSource.includes("hostWindow.innerWidth - menuWidth - 8") && source.includes("openDocumentWithObsidianDefault(file: TFile)") && source.includes("registeredOwner === CANCIP_DOCUMENT_VIEW_TYPE")],
  ["workbench zoom persists and exposes bounded menu, wheel, keyboard, capture-phase pinch, sandbox pinch, and mode-aware touch panning", workbenchSource.includes("zoom: this.documentZoom") && workbenchSource.includes("normalizeDocumentWorkbenchZoom(value.zoom)") && workbenchSource.includes('this.plugin.t("documentZoomOut"') && workbenchSource.includes('this.plugin.t("documentZoomReset"') && workbenchSource.includes('this.plugin.t("documentZoomIn"') && workbenchSource.includes('body.addEventListener("wheel"') && workbenchSource.includes('shell.addEventListener("keydown"') && workbenchSource.includes('target.addEventListener("pointerdown"') && workbenchSource.includes('target.addEventListener("pointermove"') && workbenchSource.includes('target.addEventListener("touchstart"') && workbenchSource.includes('target.addEventListener("touchmove"') && workbenchSource.includes("if (!pointerZoomInstalled)") && workbenchSource.match(/passive: false, capture: true/g)?.length >= 8 && workbenchSource.includes("Math.hypot") && workbenchSource.includes("installDocumentZoomFrameInput") && workbenchSource.includes('event.data.type === "pan"') && workbenchSource.includes("noteDrawOwnsSingleTouch") && workbenchSource.includes("bridgePendingDelta") && workbenchSource.includes("body.scrollLeft - (pendingCenter.x - lastCenter.x)") && source.includes('post("pinch",{phase') && source.includes('post("pan",{phase:"start"') && source.includes("const movePan=point=>") && source.includes('if(!inlineWorkbench&&typeof PointerEvent==="function")') && workbenchSource.includes("DOCUMENT_WORKBENCH_ZOOM_MIN") && workbenchSource.includes("DOCUMENT_WORKBENCH_ZOOM_MAX") && styles.includes(".obcc-document-body.is-zoomed") && styles.includes("touch-action: pan-x pan-y")],
  ["sandbox workbench panning consumes real inner horizontal overflow before forwarding the remainder", source.includes("let panScrollTarget=null") && source.includes("horizontalScrollerFor(target)") && source.includes("consumeHorizontalPan(panScrollTarget,localDeltaX)") && source.includes("remainingMotionX") && source.includes("deltaX-(before-after)") && source.includes('const touchClass=inlineWorkbench?"cancip-preview-touch-inline":"cancip-preview-touch-guard"') && source.includes('if(!inlineWorkbench&&typeof PointerEvent==="function")')],
  ["workbench pointer pinch pairs moving fingers without breaking stationary-finger zoom", workbenchSource.includes("const movedTouches = new Set<number>()") && workbenchSource.includes("const pairedMove = gesturePointerIds.length === 2") && workbenchSource.includes("const stationaryFingerPinch = alreadyMoved && moveAt - unpairedMoveAt >= 32") && workbenchSource.includes("gestureZoom * pendingDistance / lastDistance") && source.includes("const movedPinchPointers=new Set()") && source.includes("const stationaryFingerPinch=alreadyMoved&&moveAt-unpairedPinchMoveAt>=32") && workbenchSource.includes("bridgeGestureZoom * bridgePendingDistance / bridgeLastDistance")],
  ["zoomed workbench keeps monotonic two-dimensional layout extents instead of relying on transform overflow", workbenchSource.includes("private documentHorizontalExtentWidth = 0") && workbenchSource.includes("private documentVerticalExtentHeight = 0") && workbenchSource.includes("private syncDocumentHorizontalExtent(body: HTMLElement, reset = false)") && workbenchSource.includes("Math.ceil(body.clientWidth * this.documentZoom)") && workbenchSource.includes("Math.ceil(body.clientHeight * this.documentZoom)") && workbenchSource.includes("body.scrollTop + rect.bottom - bodyRect.top + paddingBottom") && workbenchSource.includes('cls: "obcc-document-horizontal-extent"') && workbenchSource.includes("this.documentHorizontalExtentWidth,") && workbenchSource.includes("this.documentVerticalExtentHeight,") && workbenchSource.includes("extent.setCssStyles({ width, height })") && workbenchSource.includes("this.installDocumentHorizontalExtentTracking(body)") && workbenchSource.includes("body.addEventListener(\"scroll\", () => this.syncDocumentHorizontalExtent(body)")],
  ["zoomed outer workbench directly pans one captured touch unless NoteDraw owns drawing", workbenchSource.includes("let panPointerId: number | null = null") && workbenchSource.includes("const noteDrawOwnsSingleTouch = (): boolean") && workbenchSource.includes("if (this.documentZoom <= 1 || noteDrawOwnsSingleTouch()) return") && workbenchSource.includes("if (panPointerId === event.pointerId)") && workbenchSource.includes("captureTarget.setPointerCapture?.(event.pointerId)") && workbenchSource.includes("body.scrollLeft = Math.max(0, body.scrollLeft - (point.x - panLast.x))") && workbenchSource.includes("const wasPanning = event.pointerId === panPointerId && panStarted") && styles.includes(".obcc-document-body.is-zoomed") && styles.includes("touch-action: none") && workbenchSource.includes('data-cancip-document-touch-guard') && workbenchSource.includes('classList.add("cancip-document-touch-guard")')],
  ["workbench zoom keeps NoteDraw controls fixed while every content surface, drawing, and text layer shares visible coordinates", workbenchSource.includes('const content = stage.createDiv({ cls: "obcc-document-zoom-content" })') && documentZoomSurfaceSource.includes('".obcc-document-archive-zoom-content"') && documentZoomSurfaceSource.includes('".notedraw-canvas"') && documentZoomSurfaceSource.includes('".notedraw-static-canvas"') && documentZoomSurfaceSource.includes('".notedraw-embed-layer"') && !documentZoomSurfaceSource.includes('".notedraw-toolbar"') && !workbenchSource.includes("this.applyDocumentZoomSurface(stage)") && workbenchSource.includes('zoom: ""') && workbenchSource.includes('`scale(${this.documentZoom})`') && workbenchSource.includes('transformOrigin: this.documentZoom === 1 ? "" : "top left"') && workbenchSource.includes("installNativeNoteDrawZoomAdapter") && workbenchSource.includes("rect.left + (event.clientX - rect.left) / zoom") && workbenchSource.includes("previousZoom") && workbenchSource.includes('transform: ""') && workbenchSource.includes("controller.resizeCanvas?.()") && workbenchSource.includes('cls: "obcc-archive-list obcc-document-archive-zoom-content"') && workbenchSource.includes("obcc-archive-entry-surface obcc-document-archive-zoom-content") && styles.includes(".obcc-document-zoom-content") && styles.includes(".obcc-document-zoom-content > .obcc-document-preview-host")],
  ["workbench toolbar keeps preview, source, and actions in one horizontal scroll row", styles.includes(".obcc-document-toolbar::-webkit-scrollbar") && styles.includes("flex-wrap: nowrap") && styles.includes("overflow-x: auto") && !styles.includes("3.3.29: keep workbench actions reachable") && !styles.includes("grid-template-columns: repeat(3, 28px)")],
  ["workbench share copies the current file Obsidian link without reading or sharing the file", workbenchShareSource.includes("obsidian://open") && workbenchShareSource.includes("navigator.clipboard.writeText(uri)") && workbenchShareSource.includes("documentShareCopied") && !workbenchShareSource.includes("shareNavigator.share") && !workbenchShareSource.includes("vault.readBinary(file)")],
  ["source Markdown reading renders the live Markdown inside the workbench without returning to the original preview", workbenchSource.includes('this.mode === "markdown-reading"') && workbenchSource.includes("private async renderMarkdownReading") && workbenchSource.includes("MarkdownRenderer.render(this.app, this.currentMarkdown(), content, snapshot.file.path, this)") && workbenchSource.includes('this.switchDocumentMode(markdownReadingMode ? "markdown"') && workbenchSource.includes('this.addModeButton(modes, "preview"')],
  ["source Markdown is autosaved only when editable and file metadata stays in Properties", workbenchSource.includes("const sourceReadOnly = this.snapshot?.rawSourceEditable !== true") && workbenchSource.includes("mode === \"markdown\" && this.snapshot.rawSourceEditable") && workbenchSource.includes("if (this.snapshot?.rawSourceEditable) this.scheduleRawSourceAutosave()") && workbenchSource.includes('new CancipDocumentPropertiesModal(this.app, this.plugin, snapshot).open()') && functionSource("documentEmbedMarkdown").includes('![[${file.path}]]') && !functionSource("documentEmbedMarkdown").includes("formatFileSize") && !functionSource("documentEmbedMarkdown").includes("file.stat.mtime") && styles.includes(".obcc-document-properties-list") && styles.includes(".obcc-document-editor.is-readonly")],
  ["document exports capture a precise original surface before any verified semantic fallback", source.includes("async exportDocumentAs(file: TFile, markdown: string, format: DocumentExportFormat)") && source.includes("prepareDocumentExportSurface") && source.includes("prepareNativePdfExportSurface") && source.includes("prepareExportSurface()") && source.includes("workbench-${snapshot.kind}-document") && source.includes("original ${sourceKind.toUpperCase()} capture failed; semantic Markdown fallback was not used") && source.match(/noteDrawSourcePath: file\.path/g)?.length >= 2 && source.includes("Retain a semantic fallback") && source.includes("candidate.stat.size > 0") && source.includes("outputDeadline") && source.includes("includeGlobalFiles") && source.includes("Mobile PDF Exporter")],
  ["standalone HTML task checkboxes stay aligned with their text row", source.includes("ul.contains-task-list{padding-inline-start:0;list-style:none}") && source.includes(".task-list-item-checkbox{box-sizing:border-box;width:1em;height:1em;min-height:0") && source.includes("vertical-align:-.12em")],
  ["same-format workbench exports are byte-identical instead of lossy re-encodes", source.includes("copyDocumentForSameFormatExport") && source.includes("documentExportFormatForFile(file) === format") && source.includes("sha256ArrayBuffer(source) !== await sha256ArrayBuffer(verified)")],
  ["PDF workbench snapshots use PDF.js text layers before lightweight fallback", source.includes("await extractPdfText(webFile, DOCUMENT_MARKDOWN_MAX_CHARS - 1000, warnings, Number.MAX_SAFE_INTEGER)") && !source.includes("const slice = bytes.subarray(0, Math.min(bytes.byteLength, 8 * 1024 * 1024))")],
  ["explicit scanned-PDF conversion can use the existing all-page local OCR path", source.includes("buildDocumentSnapshot(this.app, file, this, true)") && source.includes("readOcrForVaultFile(file, false, undefined, true)") && source.includes("ocrEntryFullText(ocr)")],
  ["DOCX Markdown extraction ignores wrapper runs around nested editable text boxes", source.includes('descendantsByLocalName(paragraph, "r")') && source.includes('.filter((run) => descendantsByLocalName(run, "r").length === 0)')],
  ["Mobile PDF Exporter DOCX rebuilds positioned and flowed page rows without affecting ordinary DOCX", source.includes("Obsidian Mobile PDF Exporter") && source.includes("docxPositionedTextMarkdown(body, relationships)") && source.includes("docxMobileExporterFlowMarkdown(body, relationships)") && source.includes("rowHeight * index") && source.includes("split(/\\t+/)") && source.includes("gap > 600_000") && source.includes("markdownTable(tableLines[0].cells")],
  ["Mobile PDF Exporter DOCX preserves external relationships and rejoins only exporter soft wraps", source.includes("officePartRelationships(entries, bytes, documentEntry, warnings)") && source.includes('run.parentElement?.localName === "hyperlink"') && source.includes("line.spacingBefore === 0") && source.includes("Math.abs(previous.indent - line.indent) <= 2") && source.includes("mergeAdjacentMarkdownLinks")],
  ["Mobile PDF Exporter Office previews avoid duplicate filename shells", source.includes("const hasDocumentHeading = lines.some") && source.includes("mobilePdfExporterDocument && blocks.length")],
  ["Office previews render safe ordinary Markdown links", safeOfficeLink.includes('<strong>粗体</strong>') && safeOfficeLink.includes('<a href="https://obsidian.md?a=1&amp;b=2">Obsidian 链接</a>') && !unsafeOfficeLink.includes("<a ") && unsafeOfficeLink.includes("javascript:alert(1)")],
  ["Office previews retain original page images with selectable exact XML text layers", source.includes("mobilePdfExporterOfficePreviewHtml(entries, bytes, warnings, kind)") && source.includes('mpe/preview/manifest.json') && source.includes("cancip-mpe-office-pages") && source.includes("cancip-office-text-layer is-overlay") && source.includes("data-cancip-office-part") && source.includes("data-cancip-office-index") && source.includes("persistLocatedDocumentPreviewTextEdit") && !source.includes("cancip-office-semantic-preview")],
  ["workbench control sizing does not stretch checkboxes away from their line", source.includes('input:not([type="checkbox"]):not([type="radio"])') && source.includes('input[type="checkbox"],input[type="radio"]{width:1em;height:1em;min-height:0}')],
  ["PPTX Markdown fallback rebuilds positioned rows, wrapped text, links, and tables for ordinary files too", source.includes("const positionedSlides: string[] = []") && source.includes("pptxPositionedSlideMarkdown") && source.includes("pptxSlideRelationships") && source.includes("pptxPositionedCellMarkdown") && source.includes("line.y - previous.y <= Math.max(previous.height, line.height) * 1.08") && source.includes("markdownTable(tableLines[0].cells")],
  ["workbench previews constrain narrow layouts and request PDF page-width zoom", source.includes("#view=FitH&zoom=page-width") && styles.includes("contain: inline-size") && styles.includes(".obcc-document-stage.markdown-preview-view :is(") && styles.includes("object-position: top center")],
  ["PDF to binary document conversion does not render both the embed and extracted text", source.includes('documentFormatKind(file) === "pdf" && format !== "md" && format !== "html"') && source.includes("conversionMarkdown.slice(extractedAt + marker.length).trim()")],
  ["exported files are read back and opened in the workbench", source.includes("waitForDocumentExportFile(path)") && source.includes("activateDocumentWorkbench(output, \"preview\")") && source.includes("documentExportFormatDone")],
  ["document conversion command validates formats then opens verified output", source.includes("DOCUMENT_EXPORT_FORMATS.includes(rawFormat as DocumentExportFormat)") && source.includes("format must be one of") && source.includes("format=md|html|pdf|docx|png|pptx") && source.includes("const outputPath = await this.exportDocumentAs(file, snapshot.markdown, format)") && source.includes('activateDocumentWorkbench(output, "preview")')],
  ["closing the workbench magic wand exits NoteDraw text editing", source.includes("const closedByMagicWand = controllerWasActive && !controllerActive") && source.includes("const enabled = controllerActive && editing") && source.includes('callController("setToolFromApi", "select")') && source.includes("leaveMarkdownEditMode();")],
  ["workbench magic-wand mode lets preview text receive pointer input", styles.includes(".obcc-document-stage.is-edit-md-mode > .notedraw-canvas,") && styles.includes("pointer-events: none !important;")],
  ["workbench NoteDraw Markdown editing captures the tapped caret before focus and preserves native reselection", workbenchSource.includes("private noteDrawDraftCaretRange") && workbenchSource.includes("private placeNoteDrawDraftCaret") && workbenchSource.includes("caretPositionFromPoint") && workbenchSource.includes("caretRangeFromPoint") && workbenchSource.includes("capturedRange.cloneRange()") && workbenchSource.includes("selection.addRange(range)") && workbenchSource.includes("const alreadyEditing = editable.dataset.cancipNoteDrawOriginal !== undefined") && workbenchSource.includes("const capturedRange = alreadyEditing ? null : this.noteDrawDraftCaretRange") && workbenchSource.includes("if (!alreadyEditing) editable.dataset.cancipNoteDrawOriginal = text") && workbenchSource.includes("this.placeNoteDrawDraftCaret(editable, event.clientX, event.clientY, capturedRange)")],
  ["interactive HTML and Office previews stay isolated while the scriptless export frame is readable", source.includes('post("context-edit",{kind:selectedText.trim()?"selection":"position"') && source.includes('event.data.type === "context-edit"') && source.includes("showContextEditFramePayload(iframe, snapshot.file, event.data)") && source.includes("workbenchFrameGeometry") && source.includes('iframe.setAttr("sandbox", "allow-scripts allow-forms allow-pointer-lock allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads")') && source.includes('frame.setAttribute("sandbox", "allow-same-origin")') && !source.includes("allow-scripts allow-same-origin") && !source.includes("allow-same-origin allow-scripts")],
  ["workbench iframe selection changes refresh the exact red anchor", source.includes("const syncContextSelection=()") && source.includes('document.addEventListener("selectionchange",syncContextSelection)') && source.includes('addEventListener("pointerup",()=>{const pending=pendingEdit') && source.includes('if(pending)begin(pending.element,pending.x,pending.y)') && source.includes("this.contextEditBubbleEl.hasClass(\"is-loading\") || this.contextEditBubbleEl.querySelector(\".obcc-context-edit-proposal\")") && source.includes("this.placeContextEditBubbleAtAnchor(bubble, refreshed)")],
  ["Office preview tables keep visible spreadsheet-style cell boundaries", source.includes('data-cancip-office-tables') && source.includes('.cancip-office-preview table{display:table!important') && source.includes('border-collapse:collapse!important') && source.includes('.cancip-office-preview th,.cancip-office-preview td{display:table-cell;border:1px solid')],
  ["DOCX anchored text boxes retain native page coordinates", source.includes('officeMoveTag: "anchor"') && source.includes('positionH') && source.includes('positionV') && source.includes('cancip-office-anchor') && source.includes('positionedAnchorCount > 0') && source.includes('pageBlocks.flat().join("")')],
  ["DOCX text and table layers use source page geometry plus declared page margins", source.includes("widthTwips: number") && source.includes('firstDescendantByLocalName(section, "pgMar")') && source.includes("const contentWidthTwips = Math.max(240, pageWidthTwips - dimensions.marginLeft - dimensions.marginRight)") && source.includes("let cursorY = dimensions.marginTop") && source.includes("cursorY = dimensions.marginTop") && source.includes("dimensions.marginLeft + metrics.left") && source.includes("dimensions.marginLeft / pageWidthTwips * 100") && !source.includes("const style = `position:absolute;left:6%;")],
  ["DOCX overlay coordinates stay tied to OOXML dimensions when a raster preview supplies display dimensions", source.includes("const pageWidthTwips = dimensions.widthTwips") && source.includes("const pageHeightTwips = dimensions.heightTwips") && source.includes("const pageWidthEmu = pageWidthTwips * 635") && source.includes("const pageHeightEmu = pageHeightTwips * 635")],
  ["DOCX flow layout accounts for wrapped text, line breaks, inline images, and measured table rows", source.includes("function docxPreviewEstimatedTextWidthTwips") && source.includes("function docxPreviewInlineHeightTwips") && source.includes("function docxPreviewParagraphFlowHeight") && source.includes("function docxPreviewTableHeightTwips") && source.includes('officeAttribute(extent, "cy")') && source.includes("Math.max(explicitBreaks + 1, wrappedLines)") && source.includes("cursorY = resolvedTop + flowHeight + metrics.after") && source.includes("const estimatedHeight = docxPreviewTableHeightTwips(child, contentWidthTwips)")],
  ["DOCX section breaks retain image-only pages instead of moving later text onto the raster image", source.includes("const pageHasFlowLayout: boolean[] = [false]") && source.includes("!pageHasFlowLayout[pageIndex]") && source.includes("pageHasFlowLayout[pageIndex] = true") && source.includes("pageHasFlowLayout[pageIndex] = false")],
  ["DOCX outer paragraphs do not duplicate nested text box runs", source.includes('nearestAncestorByLocalName(run, "p") === paragraph') && source.includes('const html = childAnchors.length ? "" : officePreviewParagraphHtml')],
  ["HTML preview edits preserve a fixed rendered range and verify source readback", source.includes('route: "source" | "document" | "office" | "located" | "archive" | "html" | "pdf"') && source.includes("replaceHtmlRenderedTextRange(") && source.includes('normalized === "cancip.documents.editHtmlText"') && source.includes("HTML source changed before approval") && source.includes("HTML contextual edit readback failed")],
  ["workbench textarea anchors use measured caret and selection geometry", source.includes("private contextualEditTextareaGeometry(") && source.includes("marker.getClientRects()") && source.includes("textarea.scrollTop") && source.includes("screenRects: textareaGeometry.screenRects") && source.includes("const geometry = this.contextualEditTextareaGeometry(textarea, from, to)")],
  ["context edit source and archive writes are bound to an exact verified contract", source.includes('type ContextualEditContract =') && source.includes('route: "source" | "document" | "office" | "located" | "archive" | "html" | "pdf"') && source.includes('command === "cancip.contextualEdit.apply"') && source.includes('command === "cancip.documents.editArchiveText"') && source.includes("Contextual edit source changed before approval") && source.includes("Archive entry anchor no longer matches") && source.includes("verified.text !== nextText")],
  ["Office contextual acceptance replaces the captured XML range without overlay fallback", source.includes("persistOfficeContextualTextEdit(") && source.includes("Office source changed before approval") && source.includes("Office binary readback verification failed") && source.includes("replaceOfficeArchiveVisibleText(archive, kind, originalText, editedText, contextualAnchor)") && source.includes('contract.route === "office" || contract.route === "located"') && source.includes("contextText.slice(startOffset, endOffset) === originalText")],
  ["EPUB workbench follows spine order and writes exact XHTML blocks back into a valid package", source.includes("buildEpubDocumentPreview(") && source.includes("META-INF/container.xml") && source.includes('data-cancip-source-entry') && source.includes("replaceEpubArchiveTextAtLocator") && source.includes("zipEpubArchive") && source.includes("{ level: 0 }")],
  ["magic-wand block movement persists in HTML, EPUB, DOCX, and PPTX source structures", source.includes('post("move",{moving,target:destination,placeAfter})') && source.includes("moveLocatedDocumentPreviewBlock") && source.includes("moveHtmlDocumentBlock") && source.includes("moveEpubArchiveBlock") && source.includes("moveOfficeArchiveBlock")],
  ["workbench NoteDraw horizontal coordinates follow iframe scrolling and workbench zoom", source.includes('event.data.type === "scroll"') && source.includes("this.noteDrawScrollLeft = left") && source.includes("const viewportWidth = Math.max(1, rect.width / zoom)") && source.includes("this.noteDrawContentWidth)") && source.match(/const scrollLeft = this\.noteDrawScrollLeft;/g)?.length >= 2 && source.includes("(event.clientX - metrics.rect.left) / metrics.zoom") && source.includes("(localX + scrollLeft) / width")],
  ["context edit rejects model actions that alter the captured contract", source.includes("private contextualEditActionContractFailure(") && source.includes("the UTF-16 anchor offsets differ from the captured range") && source.includes("sourceHash differs from the captured source version") && source.includes("the target path differs from the captured file") && source.includes("Only generate the replacementText/editedText value")],
  ["context edit memory retrieval is bounded and keyed by instruction plus local anchor", source.includes("const memoryQuery = [instruction, file.basename, contract?.nearbyText, contract?.expectedText]") && source.includes("this.readMemoryFolder(1100, 2, memoryQuery || rawPrompt)") && source.includes("this.readProjectMemory(memoryQuery || rawPrompt)") && source.includes("never let memory override the latest instruction")],
  ["context edit restores bounded icon-only source clipboard controls", source.includes('this.t("contextEditCopyAll")') && source.includes('this.t("contextEditCopySelection")') && source.includes('this.t("contextEditPaste")') && source.includes('setIcon(copyAll, "copy-check")') && source.includes('setIcon(copySelection, "copy")') && source.includes('setIcon(paste, "clipboard-paste")') && source.includes("contextualEditCopyAllText") && source.includes('withTimeout(navigator.clipboard.readText(), 1500') && source.includes('withTimeout(navigator.clipboard.writeText(text), 1500')],
  ["context paste targets the captured source caret instead of the instruction input", source.includes("pasteContextEditClipboardAtAnchor") && source.includes("markdownView.editor.replaceRange(text, from, to)") && source.includes('workbenchEditor.setRangeText(text, from, to, "end")') && source.includes("await this.app.vault.modify(anchor.file, nextText)") && source.includes("contextualEditPasteRange") && !source.includes("insertContextEditClipboardText(input, text)")],
  ["context edit renders a green Markdown proposal at the source anchor", source.includes("renderContextEditInlinePreview") && source.includes("MarkdownRenderer.render(this.app, markdown, preview, anchor.file.path, component)") && source.includes("this.contextEditInlinePreviewComponent?.unload()") && source.includes("obcc-context-edit-inline-rendered-preview") && styles.includes(".obcc-context-edit-inline-rendered-preview") && styles.includes("var(--color-green)")],
  ["caret and positional context edits stay unmarked until a proposal is ready", source.includes("private showContextEditInputMarker") && source.includes('if (anchor.kind !== "selection")') && source.includes("showContextEditInputMarker(effectiveAnchor, true)") && source.includes("showContextEditMarker(effectiveAnchor, false, this.contextualEditProposalPreviewText(proposal))")],
  ["context edit input and proposal reuse one mobile drag handle", source.includes('setIcon(dragHandle, "grip-horizontal")') && source.includes("this.installContextEditBubbleDrag(bubble, dragHandle)") && source.includes('bubble.querySelector<HTMLElement>(":scope > .obcc-context-edit-drag")') && source.includes("if (dragHandle) bubble.prepend(dragHandle)") && styles.includes(".obcc-context-edit-bubble:not(.is-proposal-ready) > .obcc-context-edit-drag")],
  ["selection context input closes before normal source typing", source.includes("private shouldAutoCloseContextEditForSourceInput(") && source.includes('anchor?.kind !== "selection"') && source.includes('doc.addEventListener("beforeinput", sourceInput, true)') && source.includes('doc.removeEventListener("beforeinput", sourceInput, true)') && source.includes("this.contextEditSelectionContainsPoint(anchor, x, y)")],
  ["context input position lock survives close and follows later dragging", source.includes("contextEditBubblePositionLocked") && source.includes("contextEditBubbleLockedPosition") && source.includes('setIcon(lockPosition, locked ? "lock" : "unlock")') && source.includes('lockPosition.setAttribute("aria-pressed", String(locked))') && source.includes("if (this.contextEditBubblePositionLocked) this.contextEditBubbleLockedPosition = { left, top }") && styles.includes(".obcc-context-edit-lock.is-active")],
  ["context input placement avoids existing floating panels", source.includes("private contextEditBubbleObstructions(") && source.includes("private placeContextEditBubbleNearRect(") && source.includes('".suggestion-container"') && source.includes('".obcc-button-edit-bubble"') && source.includes("obstructions.reduce((sum, obstruction) => sum + overlapArea(candidate, obstruction), 0)")],
  ["context edit result separates keep-hidden from discard-close", source.includes('setIcon(minimize, "minus")') && source.includes('this.t("contextEditMinimize")') && source.includes("if (anchor) this.contextEditPendingProposal = { anchor, instruction, proposal }") && source.includes('this.t("contextEditCloseResult")') && source.includes("this.contextEditPendingProposal = null") && source.includes("this.resolveContextualEditProposal(proposal, false)")],
  ["context edit Cancip button opens the sidebar route", source.includes("sendContextEditToCancip(effectiveAnchor, input.value)") && source.includes("private async sendContextEditToCancip") && source.includes("getOrCreateChatView({ reveal: true, focus: true })") && source.includes("view.addDraftContext") && source.includes("view.submitExternalPrompt(prompt)") && !source.includes('cancip.addEventListener("click", () => void send())')],
  ["source editor green proposal is a layout block", source.includes("setContextEditEditorPreview") && source.includes("ContextEditEditorPreviewWidget") && source.includes("block: true") && source.includes("createContextEditEditorPreviewExtension") && styles.includes(".obcc-context-edit-inline-editor-preview") && styles.includes("overflow: visible")],
  ["non-selection flow previews suppress the duplicate fixed green marker", source.includes("const renderedInFlow = preview") && source.includes('if (renderedInFlow && anchor.kind !== "selection")') && source.includes("marker.remove()") && source.includes("width: Math.max(3, Math.min(rect.width, 6))")],
  ["reading-view selection loading reuses sanitized marker geometry", source.includes("rect.height >= 3") && source.includes("rect.top <= viewportTop + 4") && source.includes("surfaceRect ? surfaceRect.right") && source.includes("loading && this.contextEditMarkerEl?.isConnected") && source.includes('this.contextEditMarkerEl.addClass("is-context-loading")')],
  ["context input typing cannot re-anchor through the global keyup selection route", /const openBubble = this\.contextEditBubbleEl;\r?\n\s*if \(openBubble\?\.contains\(openBubble\.ownerDocument\.activeElement\)\) return;\r?\n\s*const contextAnchor = this\.settings\.contextualEditingEnabled/.test(source)],
  ["context bubble keyup stays isolated from document selection handlers", source.includes('bubble.addEventListener("keyup", stop)')],
  ["context input focus blocks stale selectionchange geometry before anchor refresh", /const bubble = this\.contextEditBubbleEl;\r?\n\s*if \(bubble\?\.contains\(bubble\.ownerDocument\.activeElement\)\) return;\r?\n\s*if \(bubble && this\.contextEditBubbleSurface/.test(source)],
  ["focused or loading source selection follows scroll without remeasuring recycled DOM ranges", source.includes('bubble.hasClass("is-loading") || bubble.contains(bubble.ownerDocument.activeElement)') && source.includes("currentSourceScrollTop - sourceScrollTop") && source.includes("top: rect.top - deltaTop") && source.includes("this.refreshContextEditMarkerGeometry(anchor)")],
  ["full-screen context marker avoids Obsidian's global loading bar", source.includes('${loading ? " is-context-loading" : " is-ready"}') && styles.includes(".obcc-context-edit-marker-group.is-context-loading .obcc-context-edit-marker") && !styles.includes(".obcc-context-edit-marker-group.is-loading")],
  ["full contextual result starts folded", source.includes('cls: "obcc-context-edit-proposal is-collapsed"') && source.includes('setIcon(toggleDetails, "chevron-down")') && source.includes("contextEditExpandResult") && source.includes("contextEditCollapseResult") && styles.includes(".obcc-context-edit-proposal.is-collapsed .obcc-context-edit-diff")],
  ["final verification uses concrete results without generic success filler", source.includes('sections.push(`验证结果：${verificationLines[0]}`)') && source.includes("private concreteVerificationResult") && !source.includes("命令/界面动作已返回成功") && !source.includes("写入/修改已验证成功")],
  ["one conclusion stays unnumbered while multiple Plan results stay numbered", source.includes("if (planTodos.length > 1)") && source.includes("normalizeSingleConclusionNumbering") && source.includes("numbered.length !== 1") && source.includes("Do not number a single conclusion") && source.includes("一个结论不编号")],
  ["greeting fallback is time-only and model greetings reject stock continuation templates", !localGreetingSource.includes("刚看到") && !localGreetingSource.includes("Continue from there") && source.includes("isTemplateLikePersonalizationGreeting") && source.includes("could not be produced from the filename alone")],
  ["greeting immediately combines current time with the latest completed 48-hour body", greetingCachePassed && source.includes("personalizationGreetingCacheHours: 48") && source.includes("current.modelUpdatedAt") && source.includes("await this.personalizationFriendlyNameFromMemory()")],
  ["failed or pending greeting refresh preserves the last successful model result", source.includes("if (!next.modelUpdatedAt && personalizationGreetingCacheIsFresh(") && source.includes("modelUpdatedAt: acceptedModelGreeting ? generatedAt : fallback.modelUpdatedAt")],
  ["automation stays background and 1-2 actions never create a Plan", !source.includes("if (!this.settings.preventAutomaticSessionOpen && !task.silent") && source.includes("1-2 项任务无需计划待办") && source.includes("if (concreteCount < 3) return omitShortPlan()")],
  ["automation process keeps recent raw exchanges and shows a task badge", source.includes("const protectedTail = this.messages.slice(-12)") && source.includes("automationTitle?: string") && source.includes("obcc-process-automation-badge") && styles.includes(".obcc-process-automation-badge")],
  ["subagents are hidden from ordinary history but retained for process cards", !source.includes("const renderSubagentGroup") && source.includes("!entry.parentSessionId") && source.includes("includeSubagents = args.includeSubagents === true") && source.includes("entry.eventOnly || entry.parentSessionId")],
  ["verified successful workflows retain a reusable route", source.includes("Reusable verified route:") && source.includes('run.status === "executed"')],
  ["Mobile Webviewer uses a dedicated versioned Cancip bridge", source.includes("interface MobileWebviewerApiLike") && source.includes("receiveExternalContext(input: CancipExternalContextInput)") && source.includes('normalized.startsWith("cancip.webviewer.")') && source.includes("private async mobileWebviewerCommand") && source.includes('"cancip.webviewer.read"') && source.includes('"cancip.webviewer.send"')],
  ["Mobile Webviewer reads remain approval-free while navigation and sends stay effectful", source.match(/"cancip\.webviewer\.read"/g)?.length >= 4 && source.includes('|| command === "cancip.webviewer.open"') && source.includes('|| command === "cancip.webviewer.send"')],
  ["external web context is attached without an implicit model request", source.includes("view.addDraftContext(label, content") && source.includes("if (prompt && input.submit)") && source.includes("view.setExternalDraft(prompt")],
  ["Obsidian open URIs are intercepted before mobile navigation and stay in the current Vault", source.includes("installObsidianOpenUriInterceptor") && source.includes("this.registerDomEvent(activeWindow, \"click\", handler, true)") && source.includes("event.stopImmediatePropagation?.()") && source.includes("obsidianOpenUriFilePath(href)") && source.includes("obsidianOpenUriVaultName(href)") && source.includes("openObsidianOpenUriPath")],
  ["workbench Obsidian links reuse the safe URI opener", source.includes("await this.plugin.openObsidianOpenUriPath(internalPath)") && source.includes("obsidian://open link is missing file/path")],
  ["workspace tab previews render lightweight active-view summaries and apply cached thumbnails to native tab-list hosts", source.includes("installWorkspaceTabThumbnailSupport") && source.includes("captureActiveWorkspaceTabThumbnail") && source.includes('canvas.getContext("2d")') && source.includes("workspaceTabThumbnailPreviewLines") && source.includes("workspaceTabInfoForThumbnailHost") && source.includes("obcc-workspace-tab-thumbnail") && styles.includes(".obcc-workspace-tab-has-thumbnail") && styles.includes(".obcc-workspace-tab-thumbnail")],
  ["workspace tab thumbnail support is visible-only, bounded, and low-frequency", source.includes("visibleWorkspaceTabThumbnailHosts") && source.includes("workspaceTabThumbnailCache.size > 12") && source.includes("previous.capturedAt < 30000") && source.includes("workspaceTabThumbnailLastCaptureAt < 2000") && source.includes("visited < 160") && source.includes("const inTabList = !host.matches") && !source.slice(source.indexOf("private installWorkspaceTabThumbnailSupport"), source.indexOf("private scheduleWorkspaceTabThumbnailRefresh")).includes('on("active-leaf-change", scheduleCapture)') && !source.slice(source.indexOf("private installWorkspaceTabThumbnailSupport"), source.indexOf("private scheduleWorkspaceTabThumbnailRefresh")).includes("MutationObserver") && !source.slice(source.indexOf("private installWorkspaceTabThumbnailSupport"), source.indexOf("private scheduleWorkspaceTabThumbnailRefresh")).includes("registerInterval") && !source.slice(source.indexOf("private async captureActiveWorkspaceTabThumbnail"), source.indexOf("private workspaceTabThumbnailKey")).includes("html2canvas") && source.includes("clearWorkspaceTabThumbnailDom")]
];

const failed = checks.filter(([, passed]) => !passed).map(([name]) => name);
for (const [name, passed] of checks) console.log(`${passed ? "PASS" : "FAIL"} ${name}`);

if (failed.length) {
  console.error(`Feature regression verification failed: ${failed.join(", ")}`);
  process.exitCode = 1;
} else {
  console.log(`Feature regression verification passed (${checks.length}/${checks.length}).`);
}
