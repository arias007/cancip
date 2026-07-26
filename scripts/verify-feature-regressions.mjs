import { readFile } from "node:fs/promises";
import process from "node:process";

const source = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
const styles = await readFile(new URL("../outputs/cancip/styles.css", import.meta.url), "utf8");

const checks = [
  ["OCR command", source.includes('id: "recognize-active-file-ocr"')],
  ["OCR file-menu action", source.includes('setIcon("scan-text")') && source.includes("void this.openOcrResult(file)")],
  ["manual PDF OCR requests every page", source.includes("readOcrForVaultFile(file, false, undefined, true)") && source.includes("Number.MAX_SAFE_INTEGER")],
  ["OCR cache keeps every page", /const pages = Array\.isArray\(raw\.pages\)[\s\S]*?\}\)\) : undefined;/.test(source)],
  ["OCR modal exposes rename and Markdown extraction", source.includes("class CancipOcrResultModal") && source.includes("renameFileFromOcr") && source.includes("extractOcrMarkdown")],
  ["OCR Markdown keeps one visible source link and hidden data", source.includes("[${visibleName}](<${file.path}>)") && source.includes('"<!-- cancip-ocr"')],
  ["search UI has no hard-result pane", !source.includes('const hardSection = results.createEl("details"') && !source.includes("renderHits(hardResults")],
  ["AI search checkbox is visible and enabled by default", source.includes('const aiEnabled = aiLabel.createEl("input"') && source.includes("aiEnabled.checked = true") && source.includes('aiEnabled.addEventListener("change"')],
  ["one search pane also renders base results when AI is off", source.includes("if (!aiEnabled.checked)") && source.includes("renderHits(aiResults, hardHits)")],
  ["single search pane overrides the legacy split grid and scrolls", styles.includes("grid-template-rows: minmax(0, 1fr) !important") && styles.includes(".obcc-search-section.is-ai .obcc-search-section-body") && styles.includes("grid-template-rows: auto minmax(0, 1fr) !important") && styles.includes(".obcc-search-section.is-ai .obcc-search-section-results") && styles.includes("overflow-y: auto")],
  ["AI search renders text matches before attachment-aware semantic expansion", source.includes("includeAttachments: !aiEnabled.checked") && source.includes("renderHits(aiResults, exactHits)") && source.includes('aiExplanation.setText(isChineseLanguage(this.plugin.language()) ? "正在理解查询含义…"')],
  ["AI expansion re-enters Vault content search", source.includes("softQueries: expandedSignals") && source.includes("alwaysRunOnDemand: true") && source.includes("alwaysRunAttachments: true")],
  ["unindexed documents receive on-demand priority", source.includes("const unindexedPaths = new Set(") && source.includes("preferredPaths.has(normalizePath(file.path))")],
  ["on-demand search scans every eligible text file and full content", source.includes("Scan every eligible text") && source.includes("const contents = await Promise.all(batch.map") && source.includes("scoreSearchText(file.path, file.basename, content, tokens)")],
  ["total timer is second-only", source.includes("function formatElapsedSeconds") && source.includes("const seconds = Math.max(0, Math.floor(ms / 1000))")],
  ["numbered process steps have right-aligned bordered one-decimal timers", source.includes('cls: "obcc-process-step-timer"') && source.includes("(safe / 1000).toFixed(1)") && styles.includes(".obcc-process-step-timer") && styles.includes("min-width: 46px") && styles.includes("justify-self: end") && styles.includes("grid-template-columns: 14px 20px minmax(0, 1fr) max-content")],
  ["live progress avoids unconditional Markdown rerender", source.includes("signature !== renderedSignature && now >= nextRenderAt")],
  ["subagents launch concurrently", source.includes("await Promise.allSettled(specs.map((spec)")],
  ["parallel subagents distribute configured models", source.includes("const availableProfiles = this.availableSubagentProfiles(requestedModels)") && source.includes("model: assignedProfile.model")],
  ["failed subagent models fall back automatically", source.includes("private subagentFallbackProfiles") && source.includes("Retrying with fallback model") && source.includes("completedProfile")],
  ["parallel subagents infer a missing top-level goal", source.includes("const inferredAgentGoal = uniqueStrings(requestedRows") && source.includes('this.resolveTaskGoal("").trim()')],
  ["successful parallel subagents complete their linked Plan step", source.includes("private async completeSuccessfulSubagentPlanStep") && source.includes('terminal.some((entry) => entry.status !== "completed")') && source.includes("todo.completedAt = completedAt")],
  ["subagent consensus falls back without erasing completed child work", source.indexOf("await this.completeSuccessfulSubagentPlanStep(") < source.indexOf("const consensusRequested = args.consensus") && source.includes("for (const candidateProfile of [profile, ...this.subagentFallbackProfiles(profile)])") && source.includes('status: "subagent-consensus-model-unavailable"')],
  ["non-terminal continuation text is not flashed as a final answer", source.includes("A continuation reply without a terminal marker") && source.includes("const terminalAnswer = visibleAnswer && terminalStatus")],
  ["accepted final messages retain terminal metadata", source.includes("const finalAnswerContent = acceptedVisibleAnswer && reviewStatus") && source.includes("JSON.stringify({ status: reviewStatus })")],
  ["explicit recommendation counts are part of terminal validation", source.includes("private finalChoiceRequirementFailure") && source.includes("function requestedFinalChoiceCount") && source.includes("const requirementFailure = nonChoiceFailure || choiceFailure") && source.includes("Count the array items before returning") && source.includes("const required = requestedFinalChoiceCount(originalPrompt) || 3")],
  ["terminal recommendation repair preserves one final message", source.includes("private async repairFinalChoicesForCandidate") && source.includes("repaired terminal recommendations") && source.includes("this.attachChoiceSource(assistantMessage, choiceSource)")],
  ["parallel session index writes are merged", source.includes("sessionHistoryWriteQueue: Promise<void>") && source.includes("const run = this.sessionHistoryWriteQueue.then")],
  ["subagent cards render as a horizontal track", source.includes("obcc-subagent-track") && styles.includes(".obcc-subagent-track") && styles.includes("overflow-x: auto")],
  ["composer add-menu buttons have stable IDs", source.includes('id: "interactive-html"') && source.includes('id: "multi-agent"') && source.includes("row.dataset.cancipButtonId = `composer:${kind}:${item.id")],
  ["nested icon/label targets resolve to the stable button host", source.includes('el.closest<HTMLElement>("[data-cancip-button-id]")')],
  ["disconnected stable Cancip buttons remain verifiable", source.includes("const stableDescriptor = Boolean(stableSelectorId") && source.includes("connectedTarget || stableDescriptor")],
  ["legacy button rules remain compatible", source.includes('legacyTargetKey: ["v2"') && source.includes("legacyTargetKeyV1")]
];

const failed = checks.filter(([, passed]) => !passed).map(([name]) => name);
for (const [name, passed] of checks) console.log(`${passed ? "PASS" : "FAIL"} ${name}`);

if (failed.length) {
  console.error(`Feature regression verification failed: ${failed.join(", ")}`);
  process.exitCode = 1;
} else {
  console.log(`Feature regression verification passed (${checks.length}/${checks.length}).`);
}
