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
  ["AI expansion re-enters Vault content search", source.includes("softQueries: expandedSignals") && source.includes("alwaysRunOnDemand: true") && source.includes("alwaysRunAttachments: true")],
  ["unindexed documents receive on-demand priority", source.includes("const unindexedPaths = new Set(") && source.includes("preferredPaths.has(normalizePath(file.path))")],
  ["total timer is second-only", source.includes("function formatElapsedSeconds") && source.includes("const seconds = Math.max(0, Math.floor(ms / 1000))")],
  ["numbered process steps have independent millisecond timers", source.includes('cls: "obcc-process-step-timer"') && source.includes("function formatStepElapsed") && styles.includes(".obcc-process-step-timer")],
  ["live progress avoids unconditional Markdown rerender", source.includes("signature !== renderedSignature && now >= nextRenderAt")],
  ["subagents launch concurrently", source.includes("await Promise.allSettled(specs.map((spec)")],
  ["parallel subagents distribute configured models", source.includes("const availableProfiles = this.availableSubagentProfiles(requestedModels)") && source.includes("model: assignedProfile.model")],
  ["failed subagent models fall back automatically", source.includes("private subagentFallbackProfiles") && source.includes("Retrying with fallback model") && source.includes("completedProfile")],
  ["parallel session index writes are merged", source.includes("sessionHistoryWriteQueue: Promise<void>") && source.includes("const run = this.sessionHistoryWriteQueue.then")],
  ["subagent cards render as a horizontal track", source.includes("obcc-subagent-track") && styles.includes(".obcc-subagent-track") && styles.includes("overflow-x: auto")],
  ["composer add-menu buttons have stable IDs", source.includes('id: "interactive-html"') && source.includes('id: "multi-agent"') && source.includes("row.dataset.cancipButtonId = `composer:${kind}:${item.id")],
  ["nested icon/label targets resolve to the stable button host", source.includes('el.closest<HTMLElement>("[data-cancip-button-id]")')],
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
