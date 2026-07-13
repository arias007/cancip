import { type DataAdapter, normalizePath } from "obsidian";

export type ReviewGateStructureKind = "rename" | "move" | "merge" | "split" | "folder";

export type ReviewGateStructureChange = {
  kind: ReviewGateStructureKind;
  old_path: string;
  new_path: string;
  reason: string;
  related_files?: string[];
};

export type ReviewGateLinks = {
  added?: string[];
  removed?: string[];
  current?: string[];
  suggested?: string[];
};

export type ReviewGateManifestItem = {
  path: string;
  old_text: string;
  new_text: string;
  changes: string[];
  links: ReviewGateLinks;
  structure: ReviewGateStructureChange[];
};

export type ReviewGateManifest = {
  schemaVersion: number;
  title: string;
  vault_label: string;
  folder: string;
  generated_at: string;
  source: string;
  items: ReviewGateManifestItem[];
};

export type ReviewGateBuildOptions = {
  title?: string;
  vaultLabel?: string;
  outputRoot: string;
  output?: string;
  paths?: unknown;
  scope?: unknown;
  items?: unknown;
  maxFiles: number;
  maxFileChars: number;
};

export type ReviewGateBuildResult = {
  outputDir: string;
  indexPath: string;
  manifestPath: string;
  summaryPath: string;
  itemCount: number;
  changedCount: number;
  structureCount: number;
};

export const REVIEW_GATE_SCHEMA_VERSION = 1;

type PreparedReviewItem = {
  index: number;
  path: string;
  added: number;
  removed: number;
  delta: number;
  changed: boolean;
  structure: ReviewGateStructureChange[];
  raw: ReviewGateManifestItem;
};

const TEXT_EXTENSIONS = new Set(["md", "txt", "json", "jsonl", "csv", "ts", "tsx", "js", "jsx", "css", "html", "xml", "yml", "yaml", "base", "canvas"]);

export async function buildObReviewGatePackage(adapter: DataAdapter, options: ReviewGateBuildOptions): Promise<ReviewGateBuildResult> {
  const outputDir = reviewOutputDir(options);
  await ensureFolder(adapter, outputDir);

  const manifest = await buildManifest(adapter, options, outputDir);
  const prepared = manifest.items.map((item, index) => prepareReviewItem(index + 1, item));

  const summary = makeSummary(manifest, prepared);
  const manifestPath = `${outputDir}/manifest.json`;
  const summaryPath = `${outputDir}/summary.json`;
  const normalizedPath = `${outputDir}/review-manifest.normalized.json`;
  await adapter.write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await adapter.write(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  await adapter.write(normalizedPath, `${JSON.stringify(prepared, null, 2)}\n`);

  return {
    outputDir,
    indexPath: manifestPath,
    manifestPath,
    summaryPath,
    itemCount: prepared.length,
    changedCount: prepared.filter((item) => item.changed).length,
    structureCount: prepared.reduce((sum, item) => sum + item.structure.length, 0)
  };
}

export async function listReviewGatePackages(adapter: DataAdapter, outputRoot: string, limit = 12): Promise<string[]> {
  const root = safeVaultPath(outputRoot);
  try {
    const listing = await adapter.list(root);
    const folders = listing.folders
      .map((folder) => normalizePath(folder))
      .sort((a, b) => b.localeCompare(a))
      .slice(0, Math.max(1, Math.min(50, limit)));
    const results: string[] = [];
    for (const folder of folders) {
      const manifestPath = `${folder}/manifest.json`;
      if (await adapter.exists(manifestPath)) results.push(manifestPath);
    }
    return results;
  } catch {
    return [];
  }
}

export function formatReviewGateResult(result: ReviewGateBuildResult): string {
  return [
    `review: ${result.manifestPath}`,
    `summary: ${result.summaryPath}`,
    `items: ${result.itemCount}`,
    `changed: ${result.changedCount}`,
    `structure: ${result.structureCount}`
  ].join("\n");
}

async function buildManifest(adapter: DataAdapter, options: ReviewGateBuildOptions, outputDir: string): Promise<ReviewGateManifest> {
  const title = cleanText(options.title) || "Cancip OB Review Gate";
  const itemsFromArgs = await itemsFromInput(adapter, options.items, options.maxFileChars);
  const paths = normalizeScopePaths(options.paths, options.scope);
  const itemsFromScope = itemsFromArgs.length ? [] : await scanScopeItems(adapter, paths, options.maxFiles, options.maxFileChars);
  const items = [...itemsFromArgs, ...itemsFromScope].slice(0, options.maxFiles);
  if (!items.length) {
    throw new Error("No reviewable files or manifest items found.");
  }
  return {
    schemaVersion: REVIEW_GATE_SCHEMA_VERSION,
    title,
    vault_label: cleanText(options.vaultLabel) || "note",
    folder: outputDir,
    generated_at: new Date().toISOString(),
    source: "cancip.programmatic.reviewGate",
    items
  };
}

async function itemsFromInput(adapter: DataAdapter, rawItems: unknown, maxFileChars: number): Promise<ReviewGateManifestItem[]> {
  if (!Array.isArray(rawItems)) return [];
  const items: ReviewGateManifestItem[] = [];
  for (const raw of rawItems) {
    if (typeof raw === "string") {
      const path = safeVaultPath(raw);
      const content = await readTextIfExists(adapter, path, maxFileChars);
      if (content !== null) items.push(scanItem(path, content));
      continue;
    }
    if (!isRecord(raw)) continue;
    const rawPath = typeof raw.path === "string" ? raw.path : "";
    if (!rawPath.trim()) continue;
    const path = safeVaultPath(rawPath);
    const current = await readTextIfExists(adapter, path, maxFileChars);
    const oldText = typeof raw.old_text === "string" ? raw.old_text : typeof raw.oldText === "string" ? raw.oldText : current ?? "";
    const newText = typeof raw.new_text === "string" ? raw.new_text : typeof raw.newText === "string" ? raw.newText : oldText;
    items.push({
      path,
      old_text: truncateText(oldText, maxFileChars),
      new_text: truncateText(newText, maxFileChars),
      changes: normalizeStringArray(raw.changes),
      links: normalizeLinks(raw.links),
      structure: normalizeStructure(raw.structure ?? raw.structure_changes, path)
    });
  }
  return items;
}

async function scanScopeItems(adapter: DataAdapter, paths: string[], maxFiles: number, maxFileChars: number): Promise<ReviewGateManifestItem[]> {
  const targetPaths = paths.length ? paths : [""];
  const seen = new Set<string>();
  const files: string[] = [];
  for (const path of targetPaths) {
    const safe = path ? safeVaultPath(path) : "";
    const stat = safe ? await adapter.stat(safe).catch(() => null) : null;
    if (!safe || stat?.type === "folder") {
      const listed = await listTextFiles(adapter, safe, maxFiles - files.length, Boolean(safe && safe.startsWith(".")));
      for (const file of listed) {
        if (!seen.has(file)) {
          seen.add(file);
          files.push(file);
        }
      }
    } else if (stat?.type === "file" && isReviewGateCandidate(safe, true) && !seen.has(safe)) {
      seen.add(safe);
      files.push(safe);
    }
    if (files.length >= maxFiles) break;
  }
  const items: ReviewGateManifestItem[] = [];
  for (const path of files.slice(0, maxFiles)) {
    const content = await readTextIfExists(adapter, path, maxFileChars);
    if (content !== null) items.push(scanItem(path, content));
  }
  return items;
}

function scanItem(path: string, content: string): ReviewGateManifestItem {
  return {
    path,
    old_text: content,
    new_text: content,
    changes: [],
    links: { current: extractWikiLinks(content) },
    structure: []
  };
}

async function listTextFiles(adapter: DataAdapter, folder: string, limit: number, includeHidden = false): Promise<string[]> {
  if (limit <= 0) return [];
  let listing: { files: string[]; folders: string[] };
  try {
    listing = await adapter.list(folder);
  } catch {
    return [];
  }
  const results: string[] = [];
  for (const file of listing.files.map((item) => normalizePath(item)).sort((a, b) => a.localeCompare(b))) {
    if (results.length >= limit) break;
    if (isReviewGateCandidate(file, includeHidden)) results.push(file);
  }
  for (const child of listing.folders.map((item) => normalizePath(item)).sort((a, b) => a.localeCompare(b))) {
    if (results.length >= limit) break;
    if (!includeHidden && basename(child).startsWith(".")) continue;
    if (isReviewGateExcludedFolder(child)) continue;
    const childResults = await listTextFiles(adapter, child, limit - results.length, includeHidden);
    results.push(...childResults);
  }
  return results;
}

async function readTextIfExists(adapter: DataAdapter, path: string, maxFileChars: number): Promise<string | null> {
  if (!isReviewGateCandidate(path, true)) return null;
  try {
    const stat = await adapter.stat(path);
    if (!stat || stat.type !== "file") return null;
    const text = await adapter.read(path);
    return truncateText(removeNulCharacters(text), maxFileChars);
  } catch {
    return null;
  }
}

function prepareReviewItem(index: number, item: ReviewGateManifestItem): PreparedReviewItem {
  const delta = lineDelta(item.old_text, item.new_text);
  return {
    index,
    path: item.path,
    added: delta.added,
    removed: delta.removed,
    delta: delta.total,
    changed: Boolean(delta.total || item.changes.length || item.structure.length),
    structure: item.structure,
    raw: item
  };
}

function makeSummary(manifest: ReviewGateManifest, prepared: PreparedReviewItem[]): Record<string, unknown> {
  return {
    schemaVersion: manifest.schemaVersion,
    title: manifest.title,
    vault_label: manifest.vault_label,
    folder: manifest.folder,
    generated_at: manifest.generated_at,
    items: prepared.map((item) => ({
      name: basename(item.path),
      path: item.path,
      rel_path: item.path,
      old_chars: item.raw.old_text.length,
      new_chars: item.raw.new_text.length,
      added_lines: item.added,
      removed_lines: item.removed,
      line_delta: item.delta,
      changed: item.changed,
      changes: item.raw.changes,
      links: item.raw.links,
      structure: item.structure
    }))
  };
}

function lineDelta(oldText: string, newText: string): { added: number; removed: number; total: number } {
  const oldLines = oldText.split(/\r?\n/);
  const newLines = newText.split(/\r?\n/);
  let added = 0;
  let removed = 0;
  const max = Math.max(oldLines.length, newLines.length);
  for (let index = 0; index < max; index += 1) {
    if (oldLines[index] === newLines[index]) continue;
    if (oldLines[index] !== undefined) removed += 1;
    if (newLines[index] !== undefined) added += 1;
  }
  return { added, removed, total: added + removed };
}

function reviewOutputDir(options: ReviewGateBuildOptions): string {
  if (options.output && options.output.trim()) return safeVaultPath(options.output);
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z").replace("T", "-");
  return safeVaultPath(`${options.outputRoot}/review-${stamp}`);
}

function normalizeScopePaths(paths: unknown, scope: unknown): string[] {
  const values: string[] = [];
  if (Array.isArray(paths)) {
    for (const item of paths) if (typeof item === "string" && item.trim()) values.push(item);
  } else if (typeof paths === "string" && paths.trim()) {
    values.push(...paths.split(/[,\n]/).map((item) => item.trim()).filter(Boolean));
  }
  if (typeof scope === "string" && scope.trim() && scope !== "current vault") {
    values.push(...scope.split(/[,\n]/).map((item) => item.trim()).filter(Boolean));
  }
  return [...new Set(values.map((item) => safeVaultPath(item)))];
}

function normalizeStructure(raw: unknown, fallbackPath: string): ReviewGateStructureChange[] {
  if (!Array.isArray(raw)) return [];
  const result: ReviewGateStructureChange[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const kind = String(item.kind ?? "").trim().toLowerCase();
    if (!isStructureKind(kind)) continue;
    result.push({
      kind,
      old_path: typeof item.old_path === "string" ? safeVaultPath(item.old_path) : fallbackPath,
      new_path: typeof item.new_path === "string" ? safeVaultPath(item.new_path) : typeof item.target_path === "string" ? safeVaultPath(item.target_path) : "",
      reason: cleanText(item.reason),
      related_files: normalizeStringArray(item.related_files)
    });
  }
  return result;
}

function normalizeLinks(raw: unknown): ReviewGateLinks {
  if (!isRecord(raw)) return {};
  return {
    added: normalizeStringArray(raw.added),
    removed: normalizeStringArray(raw.removed),
    current: normalizeStringArray(raw.current),
    suggested: normalizeStringArray(raw.suggested)
  };
}

function normalizeStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return typeof raw === "string" && raw.trim() ? [raw.trim()] : [];
  return raw.map((item) => String(item ?? "").trim()).filter(Boolean);
}

function extractWikiLinks(text: string): string[] {
  const links = new Set<string>();
  const regex = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const value = match[1].trim();
    if (value) links.add(value);
  }
  return [...links].sort((a, b) => a.localeCompare(b));
}

function safeVaultPath(rawPath: string): string {
  const value = normalizePath(rawPath.trim().replace(/\\/g, "/").replace(/^\/+/, ""));
  if (!value || value === ".") return "";
  if (/^[a-zA-Z]:/.test(value) || value.includes("://")) throw new Error(`Invalid vault-relative path: ${rawPath}`);
  const parts = value.split("/").filter(Boolean);
  if (parts.some((part) => part === "." || part === "..")) throw new Error(`Invalid vault-relative path: ${rawPath}`);
  return parts.join("/");
}

async function ensureFolder(adapter: DataAdapter, folderPath: string): Promise<void> {
  const folder = safeVaultPath(folderPath);
  const parts = folder.split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    const stat = await adapter.stat(current);
    if (stat?.type === "file") throw new Error(`Path is a file: ${current}`);
    if (!stat) await adapter.mkdir(current);
  }
}

function isTextPath(path: string): boolean {
  const name = basename(path);
  const dot = name.lastIndexOf(".");
  if (dot < 1) return false;
  return TEXT_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

function isReviewGateCandidate(path: string, includeHidden: boolean): boolean {
  const normalized = normalizePath(path);
  if (!isTextPath(normalized)) return false;
  if (!includeHidden && basename(normalized).startsWith(".")) return false;
  if (!includeHidden && normalized.startsWith(".")) return false;
  if (normalized === ".cancip/config.json") return false;
  if (normalized.startsWith(".cancip/sessions/")) return false;
  if (normalized.startsWith(".cancip/versions/")) return false;
  if (normalized.startsWith(".cancip/automations/")) return false;
  if (normalized.startsWith(".cancip/review-gates/")) return false;
  if (normalized.startsWith("AI/Cancip/Exports/")) return false;
  if (normalized.startsWith("AI/Cancip/Review/")) return false;
  if (normalized.startsWith(".trash/")) return false;
  return true;
}

function isReviewGateExcludedFolder(path: string): boolean {
  const normalized = normalizePath(path);
  return normalized === ".trash"
    || normalized === ".cancip/sessions"
    || normalized.startsWith(".cancip/sessions/")
    || normalized === ".cancip/versions"
    || normalized.startsWith(".cancip/versions/")
    || normalized === ".cancip/automations"
    || normalized.startsWith(".cancip/automations/")
    || normalized === ".cancip/review-gates"
    || normalized.startsWith(".cancip/review-gates/")
    || normalized === "AI/Cancip/Exports"
    || normalized.startsWith("AI/Cancip/Exports/")
    || normalized === "AI/Cancip/Review"
    || normalized.startsWith("AI/Cancip/Review/");
}

function basename(path: string): string {
  return path.split("/").pop() || "note";
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? removeNulCharacters(value).trim() : "";
}

function removeNulCharacters(value: string): string {
  return value.split("\0").join("");
}

function truncateText(value: string, maxChars: number): string {
  const limit = Math.max(1000, maxChars);
  return value.length <= limit ? value : `${value.slice(0, limit)}\n\n...[truncated by Cancip review gate]`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStructureKind(value: string): value is ReviewGateStructureKind {
  return value === "rename" || value === "move" || value === "merge" || value === "split" || value === "folder";
}
