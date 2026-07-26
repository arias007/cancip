import { readFile } from "node:fs/promises";
import process from "node:process";

const source = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
const styles = await readFile(new URL("../outputs/cancip/styles.css", import.meta.url), "utf8");
const localGreetingSource = source.slice(
  source.indexOf("function localPersonalizationCache("),
  source.indexOf("function normalizePersonalizationCache(")
);

const checks = [
  ["OCR command", source.includes('id: "recognize-active-file-ocr"')],
  ["OCR file-menu action", source.includes('setIcon("scan-text")') && source.includes("void this.openOcrResult(file)")],
  ["manual PDF OCR requests every page", source.includes("readOcrForVaultFile(file, false, undefined, true)") && source.includes("Number.MAX_SAFE_INTEGER")],
  ["OCR cache keeps every page", /const pages = Array\.isArray\(raw\.pages\)[\s\S]*?\}\)\) : undefined;/.test(source)],
  ["OCR modal exposes rename and Markdown extraction", source.includes("class CancipOcrResultModal") && source.includes("renameFileFromOcr") && source.includes("extractOcrMarkdown")],
  ["OCR Markdown keeps one visible source link and hidden data", source.includes("[${visibleName}](<${file.path}>)") && source.includes('"<!-- cancip-ocr"')],
  ["background index shares automation startup grace and only fills missing image OCR", source.includes("Math.max(delayMs, UNIVERSAL_SEARCH_MOBILE_BACKGROUND_DELAY_MS, startupDelay)") && source.includes("missingImageOcr") && source.includes("ocrIndexed: true") && source.includes("rescheduleUniversalSearchBuildForStartupGrace")],
  ["search UI has no hard-result pane", !source.includes('const hardSection = results.createEl("details"') && !source.includes("renderHits(hardResults")],
  ["AI search checkbox is visible and enabled by default", source.includes('const aiEnabled = aiLabel.createEl("input"') && source.includes("aiEnabled.checked = true") && source.includes('aiEnabled.addEventListener("change"')],
  ["one search pane also renders base results when AI is off", source.includes("if (!aiEnabled.checked)") && source.includes("renderHits(aiResults, hardHits)")],
  ["single search pane overrides the legacy split grid and scrolls", styles.includes("grid-template-rows: minmax(0, 1fr) !important") && styles.includes(".obcc-search-section.is-ai .obcc-search-section-body") && styles.includes("grid-template-rows: auto minmax(0, 1fr) !important") && styles.includes(".obcc-search-section.is-ai .obcc-search-section-results") && styles.includes("overflow-y: auto")],
  ["AI search renders text matches before attachment-aware semantic expansion", source.includes("includeAttachments: !aiEnabled.checked") && source.includes("renderHits(aiResults, exactHits)") && source.includes('aiExplanation.setText(isChineseLanguage(this.plugin.language()) ? "正在理解查询含义…"')],
  ["search renders fast local hits then incremental AI/RAG phases", source.includes("private async fastIndexedVaultSearchHits") && source.includes('phase: "expansion"') && source.includes('phase: "retrieval"') && source.includes("onProgress?.({ phase: \"ranked\"") && source.includes("expansion.styleSignals.slice(0, 2)") && source.includes("Math.ceil(resultLimit / 2)")],
  ["search highlights multi-character and word-root matches", source.includes("function searchHighlightTerms") && source.includes("function searchWordRootVariants") && source.includes("appendHighlightedSearchText") && styles.includes(".obcc-search-match")],
  ["AI expansion re-enters Vault content search", source.includes("softQueries: expandedSignals") && source.includes("alwaysRunOnDemand: true") && source.includes("alwaysRunAttachments: true")],
  ["lightweight local RAG ranks bounded cached chunks", source.includes("private async lightweightRagHits") && source.includes("lightweightRagTextChunks") && source.includes("rankLightweightRagChunks") && source.includes("lightweightRagDocumentCache") && source.includes("includeRag: true")],
  ["unindexed documents receive on-demand priority", source.includes("const unindexedPaths = new Set(") && source.includes("preferredPaths.has(normalizePath(file.path))")],
  ["on-demand search scans every eligible text file and full content", source.includes("Scan every eligible text") && source.includes("const contents = await Promise.all(batch.map") && source.includes("scoreSearchText(file.path, file.basename, content, tokens)")],
  ["total timer starts synchronously and cannot trail a running step", source.includes("this.ensureCurrentSessionTimelineStatus(status, now)") && source.indexOf("this.ensureCurrentSessionTimelineStatus(status, now)") < source.indexOf("const index = await this.readSessionHistoryIndex({ mergeFiles: false })") && source.includes("private headerSessionTimerStartMs")],
  ["timers use milliseconds below one second, tenths below one minute, and whole seconds after one minute", source.includes('if (safe < 1000) return `${safe}ms`') && source.includes("(safe / 1000).toFixed(1)") && source.includes('String(Math.floor((safe % 60000) / 1000)).padStart(2, "0")')],
  ["numbered process steps have right-aligned bordered timers", source.includes('cls: "obcc-process-step-timer"') && styles.includes(".obcc-process-step-timer") && styles.includes("min-width: 46px") && styles.includes("justify-self: end") && styles.includes("grid-template-columns: 14px 20px minmax(0, 1fr) max-content")],
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
  ["composer add-menu buttons have stable IDs", source.includes('id: "interactive-html"') && source.includes('id: "multi-agent"') && source.includes("row.dataset.cancipButtonId = `composer:${kind}:${item.id")],
  ["nested icon/label targets resolve to the stable button host", source.includes('el.closest<HTMLElement>("[data-cancip-button-id]")')],
  ["disconnected stable Cancip buttons remain verifiable", source.includes("const stableDescriptor = Boolean(stableSelectorId") && source.includes("connectedTarget || stableDescriptor")],
  ["legacy button rules remain compatible", source.includes('legacyTargetKey: ["v2"') && source.includes("legacyTargetKeyV1")],
  ["TTS highlight records real sequential play-part matches", source.includes("activeTtsLastHighlightPartIndex") && source.includes("findSequentialNormalizedNeedleMatch") && source.includes("recordTtsHighlightMatch(matchStart, matchEnd)") && source.includes("this.activeTtsHighlightPartIndex")],
  ["TTS reads properties and expands embedded Markdown notes", source.includes("ttsSourceWithReadableFrontmatter") && source.includes("expandMarkdownTtsEmbeds") && source.includes("markdownTtsEmbedReferences")],
  ["context edit tracks live anchors and excludes native reading view", source.includes("startContextEditAnchorTracking") && source.includes("refreshContextualEditAnchorGeometry") && source.includes('containingLeaf?.view instanceof MarkdownView && element.closest(".markdown-preview-view, .markdown-rendered")')],
  ["final verification uses concrete results without generic success filler", source.includes('sections.push(`验证结果：${verificationLines[0]}`)') && source.includes("private concreteVerificationResult") && !source.includes("命令/界面动作已返回成功") && !source.includes("写入/修改已验证成功")],
  ["one conclusion stays unnumbered while multiple Plan results stay numbered", source.includes("if (planTodos.length > 1)") && source.includes("Do not number a single conclusion") && source.includes("一个结论不编号")],
  ["greeting fallback is time-only and model greetings reject stock continuation templates", !localGreetingSource.includes("刚看到") && !localGreetingSource.includes("Continue from there") && source.includes("isTemplateLikePersonalizationGreeting") && source.includes("could not be produced from the filename alone")],
  ["automation stays background and omits a one-item Plan", !source.includes("if (!this.settings.preventAutomaticSessionOpen && !task.silent") && source.includes("单动作自动化无需计划待办") && source.includes("items.filter((item) => item.text.trim()).length < 2")],
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
