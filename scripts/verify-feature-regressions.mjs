import { readFile } from "node:fs/promises";
import process from "node:process";
import ts from "typescript";

const source = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
const styles = await readFile(new URL("../outputs/cancip/styles.css", import.meta.url), "utf8");
const localGreetingSource = source.slice(
  source.indexOf("function localPersonalizationCache("),
  source.indexOf("function normalizePersonalizationCache(")
);

const parsedSource = ts.createSourceFile("main.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
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
  functionSource("uniqueStrings"),
  functionSource("tokenize"),
  functionSource("searchWordRootVariants"),
  functionSource("universalSearchQueryTerms"),
  functionSource("parseSearchQueryIntent"),
  functionSource("searchHitMatchesRequestedKind"),
  functionSource("searchIntentTextTier"),
  functionSource("searchHitIntentRank"),
  functionSource("rankSearchHitsForIntent"),
  functionSource("partitionSearchHitsForIntent"),
  functionSource("searchResultCategoryForHit"),
  functionSource("searchHitsForCategory"),
  "export { parseSearchQueryIntent, rankSearchHitsForIntent, partitionSearchHitsForIntent, searchResultCategoryForHit, searchHitsForCategory };"
].join("\n\n"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 }
}).outputText;
const searchIntentApi = await import(`data:text/javascript;base64,${Buffer.from(searchIntentModule).toString("base64")}`);
const imageIntent = searchIntentApi.parseSearchQueryIntent("身份证图片");
const imageSearchHits = [
  { path: "附件/身份证-正面.jpg", title: "身份证-正面", excerpt: "OCR semantic tags: 身份证, 证件", score: 10, kind: "image", route: "hard" },
  { path: "笔记/图片整理.md", title: "图片整理", excerpt: "身份证图片归档说明", score: 100, kind: "note", route: "hard" },
  { path: "附件/风景.jpg", title: "风景", excerpt: "海边照片", score: 80, kind: "image", route: "hard" }
];
const imageSearchGroups = searchIntentApi.partitionSearchHitsForIntent("身份证图片", imageSearchHits);
const categorizedSearchHits = [
  ...imageSearchHits,
  { path: "媒体/访谈.mp4", title: "访谈", excerpt: "视频", score: 8, kind: "file", route: "hard" },
  { path: "媒体/录音.flac", title: "录音", excerpt: "音频", score: 7, kind: "file", route: "hard" },
  { path: "资料/报告.pdf", title: "报告", excerpt: "PDF", score: 6, kind: "pdf", route: "hard" },
  { path: "资料/统计.xlsx", title: "统计", excerpt: "工作簿", score: 5, kind: "office", route: "hard" }
];

const checks = [
  ["OCR command", source.includes('id: "recognize-active-file-ocr"')],
  ["OCR file-menu action", source.includes('setIcon("scan-text")') && source.includes("void this.openOcrResult(file)")],
  ["manual PDF OCR requests every page", source.includes("readOcrForVaultFile(file, false, undefined, true)") && source.includes("Number.MAX_SAFE_INTEGER")],
  ["OCR cache keeps every page", /const pages = Array\.isArray\(raw\.pages\)[\s\S]*?\}\)\) : undefined;/.test(source)],
  ["OCR modal exposes rename and Markdown extraction", source.includes("class CancipOcrResultModal") && source.includes("renameFileFromOcr") && source.includes("extractOcrMarkdown")],
  ["OCR Markdown keeps one visible source link and hidden data", source.includes("[${visibleName}](<${file.path}>)") && source.includes('"<!-- cancip-ocr"')],
  ["OCR semantic index recognizes identity cards and optional local faces", identityCardTags.includes("身份证") && identityCardTags.includes("ID card") && identityCardTags.includes("证件") && source.includes("detectBrowserVisualSemanticTags") && source.includes('tags.push("人物", "人脸", "肖像"') && source.includes("entry.semanticTags.join")],
  ["PDF OCR preserves page visual semantics in its searchable index", source.includes("semanticTags: pageEntry.semanticTags") && source.includes("pages.flatMap((page) => page.semanticTags)") && source.includes("allBlocks, pageSemanticTags")],
  ["legacy OCR caches gain semantic tags without repeating recognition", migratedIdentityCache.schemaVersion === 3 && migratedIdentityCache.semanticTags.includes("身份证") && source.includes("entry.schemaVersion !== OCR_CACHE_SCHEMA_VERSION - 1") && source.includes("await adapter.write(path")],
  ["described image queries rank exact image matches and separate weak text matches", imageIntent.requestedKinds.includes("image") && imageIntent.subjectQuery === "身份证" && imageSearchGroups.precise.length === 1 && imageSearchGroups.precise[0].path.endsWith("身份证-正面.jpg") && imageSearchGroups.more.some((hit) => hit.kind === "note") && source.includes("parseSearchQueryIntent") && source.includes("partitionSearchHitsForIntent") && source.includes('cls: "obcc-search-more-divider"')],
  ["search categories preserve all-results first and classify media by extension", source.includes('{ id: "all", icon: "library-big" }') && source.indexOf('{ id: "image", icon: "image" }') < source.indexOf('{ id: "video", icon: "video" }') && searchIntentApi.searchHitsForCategory(categorizedSearchHits, "all").length === categorizedSearchHits.length && searchIntentApi.searchHitsForCategory(categorizedSearchHits, "image").length === 2 && searchIntentApi.searchHitsForCategory(categorizedSearchHits, "video")[0]?.path.endsWith(".mp4") && searchIntentApi.searchHitsForCategory(categorizedSearchHits, "audio")[0]?.path.endsWith(".flac")],
  ["search categories sort by live result count while all-results stays first", source.includes('orderedSearchCategories = [') && source.includes('"all",') && source.includes('(hitCounts.get(right) ?? 0) - (hitCounts.get(left) ?? 0)') && source.includes('view.button.style.order = String(order)') && source.includes('view.page.style.order = String(order)')],
  ["search category pages support tabs, swipe snapping, and independent vertical scrolling", source.includes('cls: "obcc-search-category-tabs"') && source.includes('cls: "obcc-search-page-viewport"') && source.includes("const categoryTrack = categoryViewport") && source.includes('categoryViewport.addEventListener("scroll"') && source.includes("setActiveSearchCategory(definition.id, true, true)") && source.includes('event.key === "ArrowRight"') && styles.includes("scroll-snap-type: x mandatory") && styles.includes("scroll-snap-align: start") && styles.includes(".obcc-search-page") && styles.includes("overflow-y: auto")],
  ["explicit attachment types receive an early index ranking boost", source.includes("const kindBoost = intent.requestedKinds.length") && source.includes("const queryIntent = parseSearchQueryIntent(normalizedQuery)") && source.includes("? 1800 : 0")],
  ["background index shares automation startup grace and only fills missing image OCR", source.includes("Math.max(delayMs, UNIVERSAL_SEARCH_MOBILE_BACKGROUND_DELAY_MS, startupDelay)") && source.includes("missingImageOcr") && source.includes("ocrIndexed: true") && source.includes("rescheduleUniversalSearchBuildForStartupGrace")],
  ["search UI has no hard-result pane", !source.includes('const hardSection = results.createEl("details"') && !source.includes("renderHits(hardResults")],
  ["AI search checkbox is visible and enabled by default", source.includes('const aiEnabled = aiLabel.createEl("input"') && source.includes("aiEnabled.checked = true") && source.includes('aiEnabled.addEventListener("change"')],
  ["one search pane also renders base results when AI is off", source.includes("if (!aiEnabled.checked)") && source.includes("rememberKeywordHits(hardHits)") && source.includes("renderSearchPages(visibleSearchHits())")],
  ["single search pane overrides the legacy split grid and scrolls", styles.includes("grid-template-rows: minmax(0, 1fr) !important") && styles.includes(".obcc-search-section.is-ai .obcc-search-section-body") && styles.includes("grid-template-rows: auto auto minmax(0, 1fr) !important") && styles.includes(".obcc-search-section.is-ai .obcc-search-section-results") && styles.includes("overflow-y: auto")],
  ["AI search keeps keyword results first and only appends semantic/RAG hits", source.includes("includeAttachments: !aiEnabled.checked") && source.includes("rememberKeywordHits(exactHits)") && source.includes("rememberSemanticHits(progress.hits)") && source.includes("visibleSearchHits") && source.includes('setAiExplanation([aiSearch.expansion.intent, terms]')],
  ["AI search shows loading and completion states with a spinner", source.includes('setIcon(statusIcon, state === "searching" ? "loader-circle"') && source.includes('setSearchStatus("searching", this.t("searchSearching"))') && source.includes('setSearchStatus("complete", searchStatusWithCount(this.t("searchCompleted")') && styles.includes("obcc-search-status-spin")],
  ["completed AI explanation is independently collapsible", source.includes('createEl("details", { cls: "obcc-search-section-explanation is-empty"') && source.includes('cls: "obcc-search-explanation-summary"') && source.includes("const setAiExplanation") && styles.includes(".obcc-search-section-explanation[open]")],
  ["related search results stay expanded behind an AI divider", source.includes('const more = parent.createDiv({ cls: "obcc-search-more" })') && source.includes('cls: "obcc-search-more-divider"') && !source.includes('const more = parent.createEl("details", { cls: "obcc-search-more"') && styles.includes(".obcc-search-more-divider::after")],
  ["search renders fast local hits then incremental AI/RAG phases", source.includes("private async fastIndexedVaultSearchHits") && source.includes('phase: "expansion"') && source.includes('phase: "retrieval"') && source.includes("onProgress?.({ phase: \"ranked\"") && source.includes("expansion.styleSignals.slice(0, 2)") && source.includes("Math.ceil(resultLimit / 2)")],
  ["search highlights multi-character and word-root matches", source.includes("function searchHighlightTerms") && source.includes("function searchWordRootVariants") && source.includes("appendHighlightedSearchText") && styles.includes(".obcc-search-match")],
  ["AI expansion re-enters Vault content search", source.includes("softQueries: expandedSignals") && source.includes("alwaysRunOnDemand: true") && source.includes("alwaysRunAttachments: true")],
  ["lightweight local RAG ranks bounded cached chunks", source.includes("private async lightweightRagHits") && source.includes("lightweightRagTextChunks") && source.includes("rankLightweightRagChunks") && source.includes("lightweightRagDocumentCache") && source.includes("includeRag: true")],
  ["unindexed documents receive on-demand priority", source.includes("const unindexedPaths = new Set(") && source.includes("preferredPaths.has(normalizePath(file.path))")],
  ["on-demand search scans every eligible text file and full content", source.includes("Scan every eligible text") && source.includes("const contents = await Promise.all(batch.map") && source.includes("scoreSearchText(file.path, file.basename, content, tokens)")],
  ["total timer starts synchronously and cannot trail a running step", source.includes("this.ensureCurrentSessionTimelineStatus(status, now)") && source.indexOf("this.ensureCurrentSessionTimelineStatus(status, now)") < source.indexOf("const index = await this.readSessionHistoryIndex({ mergeFiles: false })") && source.includes("private headerSessionTimerStartMs")],
  ["timers use milliseconds below one second, tenths below one minute, and whole seconds after one minute", source.includes('if (safe < 1000) return `${safe}ms`') && source.includes("(safe / 1000).toFixed(1)") && source.includes('String(Math.floor((safe % 60000) / 1000)).padStart(2, "0")')],
  ["numbered process steps have right-aligned bordered timers", source.includes('cls: "obcc-process-step-timer"') && styles.includes(".obcc-process-step-timer") && styles.includes("min-width: 46px") && styles.includes("justify-self: end") && styles.includes("grid-template-columns: 14px 20px minmax(0, 1fr) max-content max-content")],
  ["live progress avoids unconditional Markdown rerender", source.includes("signature !== renderedSignature && now >= nextRenderAt")],
  ["subagents launch concurrently", source.includes("await Promise.allSettled(specs.map((spec)")],
  ["explicit multi-agent lets the main agent choose strategy but requires real children", source.includes("Your first executable action batch must call cancip.subagents.parallel with at least 2 real child sessions") && source.includes("price, latency, capability, recent success, and current availability") && source.includes("!responseStartsParallelSubagents(answer, 2)")],
  ["parallel subagents distribute configured models", source.includes("const availableProfiles = this.availableSubagentProfiles(requestedModels)") && source.includes("model: assignedProfile.model")],
  ["failed subagent models fall back automatically", source.includes("private subagentFallbackProfiles") && source.includes("Retrying with fallback model") && source.includes("completedProfile")],
  ["parallel subagents infer a missing top-level goal", source.includes("const inferredAgentGoal = uniqueStrings(requestedRows") && source.includes('this.resolveTaskGoal("").trim()')],
  ["successful parallel subagents complete their linked Plan step", source.includes("private async completeSuccessfulSubagentPlanStep") && source.includes('terminal.some((entry) => entry.status !== "completed")') && source.includes("todo.completedAt = completedAt")],
  ["subagent consensus falls back without erasing completed child work", source.indexOf("await this.completeSuccessfulSubagentPlanStep(") < source.indexOf("const consensusRequested = args.consensus") && source.includes("for (const candidateProfile of [profile, ...this.subagentFallbackProfiles(profile)])") && source.includes('status: "subagent-consensus-model-unavailable"')],
  ["non-terminal continuation text is not flashed as a final answer", source.includes("A continuation reply without a terminal marker") && source.includes("const terminalAnswer = visibleAnswer && terminalStatus")],
  ["accepted final messages retain terminal metadata", source.includes("const finalAnswerContent = acceptedVisibleAnswer && reviewStatus") && source.includes("JSON.stringify({ status: reviewStatus })")],
  ["explicit recommendation counts are part of terminal validation", source.includes("private finalChoiceRequirementFailure") && source.includes("function requestedFinalChoiceCount") && source.includes("const requirementFailure = nonChoiceFailure || choiceFailure") && source.includes("Count the array items before returning") && source.includes("const required = requestedFinalChoiceCount(originalPrompt) || 3")],
  ["terminal recommendation repair preserves one final message", source.includes("private async repairFinalChoicesForCandidate") && source.includes("repaired terminal recommendations") && source.includes("this.attachChoiceSource(assistantMessage, choiceSource)")],
  ["parallel session index writes are merged without rescanning or frozen timer waits", source.includes("sessionHistoryWriteQueue: Promise<void>") && source.includes("const run = this.sessionHistoryWriteQueue.then") && source.includes("readSessionHistoryIndexUncached(false)") && !source.includes("Math.max(0, 650 - (Date.now() - this.sessionSaveLastAt))")],
  ["subagent cards render inside their launching process step, not the Plan panel", source.includes("obcc-process-subagent-cards") && source.includes("hydrateProcessSubagentCards") && !source.includes("data-subagent-step-id") && styles.includes(".obcc-subagent-track") && styles.includes("overflow-x: auto")],
  ["subagent cards appear as soon as child sessions are created", source.includes("Make the child visible in the parent process record before its model call finishes") && source.includes("if (parentSessionId === this.sessionId) this.renderMessagesAfterMutation()")],
  ["completed process details default folded and Plan button stays on its numbered step", source.includes('this.wireDetails(step, `process-step:${stepFoldKey}`, isLiveStep || needsIntervention, false, true)') && source.includes("processStepPlanReference") && source.includes("obcc-process-step-plan-button") && source.includes('text: `#${index + 1}`') && !source.includes('cls: "obcc-process-record-meta-button is-plan"')],
  ["every process step keeps a concise auditable reasoning/action/result/next trace", source.includes("type ProcessStepBrief =") && source.includes("processBrief?: ProcessStepBrief") && source.includes("private progressStepBrief(") && source.includes("private toolRunProcessBrief(") && source.includes("private renderProcessStepBrief(") && source.includes("Previous step trace:") && source.includes("normalizeProcessStepBrief") && styles.includes(".obcc-process-step-brief-row")],
  ["legacy process traces bind to their own concise user turn and reject unrelated Plan items", source.includes("private taskPromptBeforeMessage(") && source.includes("planNext: null") && source.includes("private processPlanStepMatchesTask(") && source.includes("sourceTokens.some((token) => planTokens.has(token))") && source.includes("private conciseProcessTask(") && source.includes("自动化任务：${automation")],
  ["live and approval steps expand while completed steps respect manual fold state", source.includes("const isLiveStep = this.progressStepTimers.has") && source.includes("const needsIntervention = stepRuns.some") && source.includes("isLiveStep || needsIntervention, false, true")],
  ["composer add-menu buttons have stable IDs", source.includes('id: "interactive-html"') && source.includes('id: "multi-agent"') && source.includes("row.dataset.cancipButtonId = `composer:${kind}:${item.id")],
  ["nested icon/label targets resolve to the stable button host", source.includes('el.closest<HTMLElement>("[data-cancip-button-id]")')],
  ["disconnected stable Cancip buttons remain verifiable", source.includes("const stableDescriptor = Boolean(stableSelectorId") && source.includes("connectedTarget || stableDescriptor")],
  ["legacy button rules remain compatible", source.includes('legacyTargetKey: ["v2"') && source.includes("legacyTargetKeyV1")],
  ["TTS highlight uses one strict sentence key while playback remains micro-chunked", source.includes("splitPrimeTtsSentenceFragments(normalized)") && source.includes('const key = `${this.activeTtsSourcePath}:${displayIndex}') && source.includes("highlightActiveRenderedTtsPart(displayText)") && !source.includes("for (const candidate of ttsHighlightCandidateTexts(playText, displayText")],
  ["TTS reads properties and expands embedded Markdown notes", source.includes("ttsSourceWithReadableFrontmatter") && source.includes("expandMarkdownTtsEmbeds") && source.includes("markdownTtsEmbedReferences")],
  ["context edit tracks live anchors and excludes native reading view", source.includes("startContextEditAnchorTracking") && source.includes("refreshContextualEditAnchorGeometry") && source.includes('containingLeaf?.view instanceof MarkdownView && element.closest(".markdown-preview-view, .markdown-rendered")')],
  ["context edit preserves native selection copy menus", source.includes("private nativeSelectionToolbarUntil") && source.includes("private isNativeSelectionToolbarProtected") && source.includes("Android dismiss Copy shortly after it appears") && source.includes('if (contextAnchor.kind === "selection")') && source.includes('if (anchor.kind === "selection") return;')],
  ["caret and positional context edits stay unmarked until a proposal is ready", source.includes("private showContextEditInputMarker") && source.includes('if (anchor.kind !== "selection")') && source.includes("showContextEditInputMarker(effectiveAnchor, true)") && source.includes("showContextEditMarker(effectiveAnchor, false, this.contextualEditProposalPreviewText(proposal))")],
  ["final verification uses concrete results without generic success filler", source.includes('sections.push(`验证结果：${verificationLines[0]}`)') && source.includes("private concreteVerificationResult") && !source.includes("命令/界面动作已返回成功") && !source.includes("写入/修改已验证成功")],
  ["one conclusion stays unnumbered while multiple Plan results stay numbered", source.includes("if (planTodos.length > 1)") && source.includes("normalizeSingleConclusionNumbering") && source.includes("numbered.length !== 1") && source.includes("Do not number a single conclusion") && source.includes("一个结论不编号")],
  ["greeting fallback is time-only and model greetings reject stock continuation templates", !localGreetingSource.includes("刚看到") && !localGreetingSource.includes("Continue from there") && source.includes("isTemplateLikePersonalizationGreeting") && source.includes("could not be produced from the filename alone")],
  ["automation stays background and 1-2 actions never create a Plan", !source.includes("if (!this.settings.preventAutomaticSessionOpen && !task.silent") && source.includes("1-2 项任务无需计划待办") && source.includes("if (concreteCount < 3) return omitShortPlan()")],
  ["automation process keeps recent raw exchanges and shows a task badge", source.includes("const protectedTail = this.messages.slice(-12)") && source.includes("automationTitle?: string") && source.includes("obcc-process-automation-badge") && styles.includes(".obcc-process-automation-badge")],
  ["subagents are hidden from ordinary history but retained for process cards", !source.includes("const renderSubagentGroup") && source.includes("!entry.parentSessionId") && source.includes("includeSubagents = args.includeSubagents === true") && source.includes("entry.eventOnly || entry.parentSessionId")],
  ["verified successful workflows retain a reusable route", source.includes("Reusable verified route:") && source.includes('run.status === "executed"')]
];

const failed = checks.filter(([, passed]) => !passed).map(([name]) => name);
for (const [name, passed] of checks) console.log(`${passed ? "PASS" : "FAIL"} ${name}`);

if (failed.length) {
  console.error(`Feature regression verification failed: ${failed.join(", ")}`);
  process.exitCode = 1;
} else {
  console.log(`Feature regression verification passed (${checks.length}/${checks.length}).`);
}
