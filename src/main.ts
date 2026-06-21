import {
  App,
  type DataAdapter,
  Editor,
  ItemView,
  MarkdownRenderer,
  MarkdownView,
  Notice,
  normalizePath,
  Plugin,
  PluginSettingTab,
  requestUrl,
  Setting,
  setIcon,
  TFile,
  TFolder,
  WorkspaceLeaf
} from "obsidian";

import { DEFAULT_SYSTEM_PROMPT, LEGACY_SYSTEM_PROMPT, PLUGIN_NAME, VIEW_TYPE } from "./constants";
import {
  buildObReviewGatePackage,
  formatReviewGateResult,
  listReviewGatePackages,
  type ReviewGateBuildResult
} from "./reviewGate";

type ChatRole = "system" | "user" | "assistant";

type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: number;
  toolRuns?: ToolRun[];
  sources?: SearchHit[];
  contextText?: string;
  systemPrompt?: string;
  mode?: ComposerMode;
  accessMode?: AccessMode;
  apiProfile?: {
    id: string;
    name: string;
    apiMode: ApiMode;
    model: string;
    hasApiUrl: boolean;
    hasApiKey: boolean;
  };
};

type ComposerMode = "ask" | "search" | "plan" | "edit";
type ApiMode = "auto" | "compatible" | "responses";
const LANGUAGE_VALUES = ["zh", "zh-TW", "en", "ug", "tr", "ru", "ja", "ko", "es", "fr", "de", "ar"] as const;
type Language = typeof LANGUAGE_VALUES[number];
type LanguageMode = "auto" | Language;
type AccessMode = "ask-for-approval" | "full-access";
type ComposerMenuKind = "add" | "access" | "model";
type HeaderMenuKind = "history" | "events" | "outline" | "plan";
type ComposerSubmitMode = "queue" | "direct";

type ApiProfile = {
  id: string;
  name: string;
  apiUrl: string;
  apiKey: string;
  apiMode: ApiMode;
  model: string;
};

type SearchHit = {
  path: string;
  title: string;
  excerpt: string;
  score: number;
};

type InstalledPluginInfo = {
  id: string;
  name: string;
  version: string;
  path: string;
  enabled: boolean;
  manifestFound: boolean;
  error?: string;
};

type VaultTextFile = {
  path: string;
  basename: string;
  extension: string;
  loaded?: boolean;
};

type ContextSource = "file" | "folder" | "virtual";

type DraftContext = {
  id: string;
  label: string;
  content: string;
  path?: string;
  source?: ContextSource;
};

type ManualTodo = {
  id: string;
  text: string;
  done: boolean;
  createdAt: string;
};

type QueuedPrompt = {
  id: string;
  prompt: string;
  createdAt: number;
};

type TodoActionOperation = "set" | "add" | "update" | "remove" | "list" | "clear";

type TodoActionItem = {
  id?: string;
  text: string;
  done?: boolean;
};

type TodoAction = {
  type: "todo";
  op: TodoActionOperation;
  id?: string;
  text?: string;
  done?: boolean;
  items?: TodoActionItem[];
};

type AutomationSchedule = "manual" | "hourly" | "daily";
type AutomationActionOperation = "add" | "update" | "remove" | "list" | "run";

type AutomationTask = {
  id: string;
  title: string;
  prompt: string;
  command?: string;
  args?: Record<string, unknown>;
  schedule: AutomationSchedule;
  enabled: boolean;
  intervalMinutes: number;
  hour: number;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  lastStatus?: "ok" | "failed";
  lastResult?: string;
  lastResultPath?: string;
};

type AutomationAction = {
  type: "automation";
  op: AutomationActionOperation;
  id?: string;
  title?: string;
  prompt?: string;
  command?: string;
  args?: Record<string, unknown>;
  schedule?: AutomationSchedule;
  enabled?: boolean;
  intervalMinutes?: number;
  hour?: number;
};

type AutomationRunResult = {
  ok: boolean;
  text: string;
  path?: string;
};

type AutomationTemplate = {
  id: string;
  title: string;
  description: string;
  prompt?: string;
  command?: string;
  args?: Record<string, unknown>;
  schedule: AutomationSchedule;
  enabled: boolean;
  intervalMinutes?: number;
  hour?: number;
};

type ContextChip = {
  key: string;
  kind: string;
  icon: string;
  name: string;
  path: string;
  source: ContextSource;
};

type MessageDisplay = {
  visibleContent: string;
  hiddenToolBlocks: FoldedMessageBlock[];
  hasProcessFold: boolean;
  processOnly: boolean;
};

type FoldedMessageBlock = {
  title: string;
  content: string;
};

type RenderedMessage = {
  message: ChatMessage;
  display: MessageDisplay;
  index: number;
};

type MessageScrollSnapshot = {
  stickToBottom: boolean;
  topMessageId: string;
  topOffset: number;
  rawScrollTop: number;
};

type ChoiceOption = {
  prefix: string;
  text: string;
};

type FileExplorerViewLike = {
  revealInFolder?: (target: TFile | TFolder) => void | Promise<void>;
};

type LocalVersionKind = "manual" | "daily";

type LocalVersionFile = {
  path: string;
  size: number;
  mtime: number;
  hash: string;
  snapshotPath: string;
};

type LocalVersionCommit = {
  id: string;
  kind: LocalVersionKind;
  message: string;
  createdAt: string;
  scannedCount: number;
  fileCount: number;
  files: LocalVersionFile[];
};

type LocalVersionIndex = {
  schemaVersion: number;
  lastDailyDate: string;
  commits: Array<Omit<LocalVersionCommit, "files">>;
  latestHashes: Record<string, string>;
};

type LocalVersionResult = {
  status: "created" | "no-changes" | "baseline";
  commit?: LocalVersionCommit;
  scannedCount: number;
  changedCount: number;
};

type SessionHistoryEntry = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  mode: ComposerMode;
  model: string;
  status?: "idle" | "running" | "completed" | "failed";
  completedNotice?: boolean;
  path: string;
  eventOnly?: boolean;
};

type StaleSessionRepair = {
  entry: SessionHistoryEntry;
  changed: boolean;
};

type SessionEventKind =
  | "plugin.load"
  | "session.open"
  | "session.new"
  | "session.save"
  | "session.save_failed"
  | "session.status"
  | "message.add"
  | "prompt.send"
  | "prompt.error"
  | "prompt.recoverable_error"
  | "tool.start"
  | "tool.finish"
  | "tool.reject";

type SessionEvent = {
  at?: string;
  kind: SessionEventKind;
  sessionId?: string;
  title?: string;
  status?: string;
  messageId?: string;
  role?: ChatRole;
  runId?: string;
  toolStatus?: ToolRunStatus;
  summary?: string;
  detail?: string;
  path?: string;
  messageCount?: number;
  mode?: ComposerMode;
  model?: string;
  pluginVersion?: string;
};

type SessionEventView = Required<Pick<SessionEvent, "at" | "kind">> & Omit<SessionEvent, "at" | "kind">;

type MentionKind = "file" | "folder" | "skill" | "action" | "command";
type MentionSource = "file" | "folder" | "virtual";

type MentionTarget = {
  kind: MentionKind;
  source: MentionSource;
  path: string;
  title: string;
  detail: string;
  keywords: string[];
  score: number;
};

type ActiveMention = {
  start: number;
  end: number;
  query: string;
};

type ComposerMenuItem = {
  icon: string;
  label: string;
  shortLabel?: string;
  detail?: string;
  active?: boolean;
  action: () => void | Promise<void>;
};

type ObsidianCommandDefinition = {
  name?: string;
};

type ObsidianCommandApi = {
  commands?: Record<string, ObsidianCommandDefinition>;
  executeCommandById?: (id: string) => boolean | void;
};

type ToolRunStatus = "pending" | "executing" | "executed" | "blocked" | "failed" | "rejected";

type ToolRun = {
  id: string;
  action: CancipAction;
  summary: string;
  status: ToolRunStatus;
  createdAt: string;
  startedAt?: string;
  executedAt?: string;
  result?: string;
  error?: string;
};

type ActionHandlingResult = {
  report: string;
  runs: ToolRun[];
  executed: boolean;
};

type ActionReportSection = {
  title: string;
  summary: string;
  detail?: string;
};

type ToolFeedbackEvent = {
  status: "executed" | "failed" | "rejected";
  summary: string;
  detail: string;
  at: string;
};

type CancipAction =
  | { type: "read"; path: string; query?: string; occurrence?: number; maxChars?: number }
  | { type: "write"; path: string; content?: string; chunks?: string[] }
  | { type: "append"; path: string; content?: string; chunks?: string[] }
  | { type: "patch"; path: string; find: string; replace: string; all?: boolean; regex?: boolean; flags?: string }
  | { type: "config"; path?: string; set?: Record<string, unknown>; unset?: string[]; replace?: boolean }
  | TodoAction
  | AutomationAction
  | { type: "mkdir"; path: string }
  | { type: "rename"; path: string; newPath: string }
  | { type: "move"; path: string; newPath: string }
  | { type: "copy"; path: string; newPath: string }
  | { type: "delete"; path: string; permanent?: boolean }
  | { type: "command"; command: string; args?: Record<string, unknown> };

type Settings = {
  language: LanguageMode;
  accessMode: AccessMode;
  activeApiProfileId: string;
  apiProfiles: ApiProfile[];
  apiUrl: string;
  apiKey: string;
  apiMode: ApiMode;
  model: string;
  modelOptions: string[];
  temperature: number;
  maxOutputTokens: number;
  maxContextFiles: number;
  memoryFolder: string;
  includeCurrentFile: boolean;
  includeCoreMemory: boolean;
  maxCoreMemoryFiles: number;
  codexMemoryImportPath: string;
  codexMemoryAutoImport: boolean;
  codexMemoryAutoSearch: boolean;
  codexMemoryMaxFiles: number;
  codexMemoryMaxChars: number;
  useVaultSearchByDefault: boolean;
  showAttachmentButton: boolean;
  compactHeader: boolean;
  autoOpenPlanPanel: boolean;
  showLiveTodos: boolean;
  showManualTodos: boolean;
  commandBusEnabled: boolean;
  executeObsidianCommands: boolean;
  githubCommandsEnabled: boolean;
  githubApiBaseUrl: string;
  githubDownloadBaseUrl: string;
  githubOwner: string;
  githubRepo: string;
  githubToken: string;
  autoContinueAfterTools: boolean;
  maxToolIterations: number;
  exportMarkdownContextSnapshots: boolean;
  exportMarkdownManualTodos: boolean;
  maxRecentTranscriptMessages: number;
  maxMentionResults: number;
  maxMentionFolderFiles: number;
  maxFileContextChars: number;
  maxFolderFileContextChars: number;
  dailyLocalVersioning: boolean;
  localVersionHour: number;
  localVersionMaxFileBytes: number;
  automationsEnabled: boolean;
  automationCheckMinutes: number;
  showSupportCodes: boolean;
  supportCodeOnePath: string;
  supportCodeTwoPath: string;
  supportCodeOneLabel: string;
  supportCodeTwoLabel: string;
  systemPrompt: string;
};

const CANCIP_AI_DIR = "AI/Cancip";
const DEFAULT_MEMORY_FOLDER = `${CANCIP_AI_DIR}/Memory`;
const DEFAULT_CODEX_MEMORY_IMPORT_PATH = "";
const LEGACY_DEFAULT_MEMORY_FOLDER = "AI/Memory";
const INTERRUPTED_DEFAULT_MEMORY_FOLDER = "Cancip/Memory";
const DEFAULT_SUPPORT_CODE_ONE_PATH = ".obsidian/plugins/cancip/extras/code-1.jpg";
const DEFAULT_SUPPORT_CODE_TWO_PATH = ".obsidian/plugins/cancip/extras/code-2.png";
const DEFAULT_CORE_MEMORY_MAX_FILES = 3;
const CODEX_CORE_MEMORY_FILES = [
  "USER_PREFERENCES_QUICK.md",
  "PROFILE.md",
  "PREFERENCES.md",
  "WORKFLOWS.md",
  "TOOLS.md",
  "SKILLS.md",
  "PROJECTS.md",
  "NOTIFICATIONS.md",
  "TRADING.md",
  "obsidian-整理偏好.md",
  "C-DEPENDENCY-MIGRATION.md",
  "INDEX.md"
] as const;

const MODEL_PRESETS = [
  "gpt-5.5",
  "gpt-5.1",
  "gpt-5",
  "gpt-4.1",
  "gpt-4.1-mini",
  "gpt-4o",
  "gpt-4o-mini",
  "o3",
  "o4-mini",
  "claude-sonnet-4.5",
  "claude-opus-4.1",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "deepseek-chat",
  "deepseek-reasoner",
  "qwen-max",
  "qwen-plus",
  "kimi-k2-instruct"
] as const;

const DEFAULT_SETTINGS: Settings = {
  language: "auto",
  accessMode: "ask-for-approval",
  activeApiProfileId: "default",
  apiProfiles: [
    {
      id: "default",
      name: "Default",
      apiUrl: "https://api.openai.com/v1",
      apiKey: "",
      apiMode: "auto",
      model: "gpt-4.1-mini"
    }
  ],
  apiUrl: "https://api.openai.com/v1",
  apiKey: "",
  apiMode: "auto",
  model: "gpt-4.1-mini",
  modelOptions: [...MODEL_PRESETS],
  temperature: 0.2,
  maxOutputTokens: 2048,
  maxContextFiles: 6,
  memoryFolder: DEFAULT_MEMORY_FOLDER,
  includeCurrentFile: true,
  includeCoreMemory: true,
  maxCoreMemoryFiles: DEFAULT_CORE_MEMORY_MAX_FILES,
  codexMemoryImportPath: DEFAULT_CODEX_MEMORY_IMPORT_PATH,
  codexMemoryAutoImport: true,
  codexMemoryAutoSearch: false,
  codexMemoryMaxFiles: 6,
  codexMemoryMaxChars: 12000,
  useVaultSearchByDefault: false,
  showAttachmentButton: true,
  compactHeader: true,
  autoOpenPlanPanel: true,
  showLiveTodos: true,
  showManualTodos: true,
  commandBusEnabled: true,
  executeObsidianCommands: true,
  githubCommandsEnabled: true,
  githubApiBaseUrl: "https://api.github.com",
  githubDownloadBaseUrl: "",
  githubOwner: "arias007",
  githubRepo: "cancip",
  githubToken: "",
  autoContinueAfterTools: true,
  maxToolIterations: 3,
  exportMarkdownContextSnapshots: true,
  exportMarkdownManualTodos: true,
  maxRecentTranscriptMessages: 8,
  maxMentionResults: 12,
  maxMentionFolderFiles: 6,
  maxFileContextChars: 8000,
  maxFolderFileContextChars: 2600,
  dailyLocalVersioning: true,
  localVersionHour: 4,
  localVersionMaxFileBytes: 524288,
  automationsEnabled: true,
  automationCheckMinutes: 15,
  showSupportCodes: true,
  supportCodeOnePath: DEFAULT_SUPPORT_CODE_ONE_PATH,
  supportCodeTwoPath: DEFAULT_SUPPORT_CODE_TWO_PATH,
  supportCodeOneLabel: "Alipay",
  supportCodeTwoLabel: "Binance",
  systemPrompt: DEFAULT_SYSTEM_PROMPT
};

const CANCIP_CONFIG_DIR = ".cancip";
const CANCIP_CONFIG_PATH = `${CANCIP_CONFIG_DIR}/config.json`;
const CANCIP_CONFIG_SCHEMA_VERSION = 1;
const LOCAL_VERSION_DIR = `${CANCIP_CONFIG_DIR}/versions`;
const LOCAL_VERSION_INDEX_PATH = `${LOCAL_VERSION_DIR}/index.json`;
const LOCAL_VERSION_SCHEMA_VERSION = 1;
const SESSION_EXPORT_DIR = `${CANCIP_AI_DIR}/Exports`;
const SESSION_EXPORT_SCHEMA_VERSION = 1;
const SESSION_HISTORY_DIR = `${CANCIP_CONFIG_DIR}/sessions`;
const CANCIP_TRASH_DIR = `${CANCIP_CONFIG_DIR}/Trash`;
const SESSION_HISTORY_INDEX_PATH = `${SESSION_HISTORY_DIR}/index.json`;
const SESSION_EVENTS_PATH = `${SESSION_HISTORY_DIR}/events.jsonl`;
const SESSION_HISTORY_SCHEMA_VERSION = 1;
const SESSION_HISTORY_LIMIT = 60;
const SESSION_EVENTS_MAX_BYTES = 1024 * 1024;
const AUTOMATION_DIR = `${CANCIP_CONFIG_DIR}/automations`;
const AUTOMATION_STATE_PATH = `${CANCIP_CONFIG_DIR}/automations.json`;
const AUTOMATION_SCHEMA_VERSION = 1;
const EXPERIENCE_LOG_PATH = `${CANCIP_CONFIG_DIR}/experience.md`;
const EXPERIENCE_LOG_MAX_CHARS = 12000;
const EXPERIENCE_CONTEXT_MAX_CHARS = 2200;
const PROGRESS_STEP_MARKER = "<!-- cancip-progress-step -->";
const PROCESS_MESSAGE_MARKER = "<!-- cancip-process-message -->";
const TOOL_FEEDBACK_MARKER_PREFIX = "<!-- cancip-tool-feedback:";
const REVIEW_GATE_DIR = `${CANCIP_AI_DIR}/Review`;
const REVIEW_GATE_HIDDEN_DIR = `${CANCIP_CONFIG_DIR}/review-gates`;
const REVIEW_GATE_SCHEMA_VERSION = 1;
const REVIEW_GATE_MAX_FILES = 80;
const REVIEW_GATE_MAX_FILE_CHARS = 120000;
const RUNTIME_STATE_PATH = `${CANCIP_CONFIG_DIR}/runtime.json`;
const CONTEXT_STEP_TIMEOUT_MS = 3500;
const VAULT_SEARCH_TIME_BUDGET_MS = 2200;
const VAULT_SEARCH_MAX_SCAN_FILES = 160;
const MENTION_TARGET_TIME_BUDGET_MS = 1800;
const MENTION_MAX_FILES = 500;
const MODEL_CALL_TIMEOUT_MS = 90000;
const FILE_WRITE_CHUNK_SIZE = 64 * 1024;

const LANGUAGE_LABELS: Record<Language, string> = {
  zh: "简体中文",
  "zh-TW": "繁體中文",
  en: "English",
  ug: "ئۇيغۇرچە",
  tr: "Türkçe",
  ru: "Русский",
  ja: "日本語",
  ko: "한국어",
  es: "Español",
  fr: "Français",
  de: "Deutsch",
  ar: "العربية"
};

const RTL_LANGUAGES = new Set<Language>(["ug", "ar"]);

const EN = {
  openCancip: "Open Cancip",
  commandOpenChat: "Open chat",
  commandNewChat: "New chat",
  exportSession: "Export session",
  exportNoMessages: "No messages to export",
  exportDone: "Session exported: {path}",
  exportFailed: "Session export failed: {reason}",
  sessionHistory: "Session history",
  sessionNoHistory: "No saved sessions",
  sessionLoaded: "Opened a saved session. This only loads history; it does not mean the task is finished.",
  sessionEvents: "Event audit",
  sessionEventsEmpty: "No session events yet",
  sessionEventsCopied: "Session events copied",
  sessionSaveFailed: "Session save failed: {reason}",
  sessionLoadFailed: "Session load failed: {reason}",
  sessionRunning: "Running",
  sessionCompleted: "Completed",
  sessionFailed: "Failed",
  sessionIdLabel: "Session",
  copySessionId: "Copy session ID",
  untitledSession: "New session",
  sessionOutline: "Current session",
  sessionOutlineEmpty: "No conversation yet",
  progressDetails: "Step details",
  progressStep: "{status} · {summary}",
  elapsedSuffix: "elapsed {elapsed}",
  totalElapsed: "Total elapsed: {elapsed}",
  processRecord: "Process record",
  finalConclusionFallback: "## Final answer\n\n{summary}",
  emptyApiReply: "The API returned an empty response.",
  emptyApiReplyWithSuppressedTools: "The API returned tool/action instructions but no visible assistant reply. For simple chat, Cancip does not execute hidden actions.",
  toolActionRequiredPrompt: "The user asked for a concrete implementation/change task in Full access mode, but your previous answer did not emit any cancip-action and no tool ran.\n\nUser task:\n{task}\n\nContinue like Codex on mobile: inspect the exact relevant file/config first, then apply the smallest safe change with Cancip's available vault tools, then verify by reading the changed path or command result. For Cancip self-fixes, missing desktop source build/npm/restart is not a blocker to making an installed-plugin hot patch: patch .obsidian/plugins/cancip/main.js or styles.css first when that is the only writable implementation surface, then report that reload/source sync is still needed. Output exactly one cancip-action block now. If the current mobile/vault tool boundary truly prevents even an installed hot patch, give one short concrete blocker and the exact missing capability; do not say \"I can continue\".",
  toolActionHardRequiredPrompt: "Your previous answer still did not produce an executable cancip-action. This is Full access and the user needs a real mobile-side change.\n\nUser task:\n{task}\n\nOutput exactly one cancip-action block now. Do not explain limitations unless there is no writable Vault path at all. For Cancip UI/self-fix tasks, use the installed plugin paths .obsidian/plugins/cancip/main.js and/or .obsidian/plugins/cancip/styles.css as the mobile hot-patch target, then verify by reading the patched path. Desktop source build/restart/release can be reported after the hot patch; it must not stop the hot patch.",
  toolActionLowCommitmentPrompt: "The user asked for a concrete implementation/change task, but the previous tool iterations only read/searched/listed and did not change anything.\n\nUser task:\n{task}\n\nContinue like Codex. Do not do another broad search unless the exact writable target is still unknown. Output exactly one cancip-action block containing a real patch/write/state-changing command plus a read/command verification when possible. If no writable target exists, give one short concrete blocker and the exact missing capability. Do not answer with \"not finished\", \"continue\", or a summary of searches.",
  toolActionForcedVisible: "Continuing with the next executable step.",
  selfPatchNeedsReload: "This changed Cancip's installed plugin files. The current running plugin will not reliably show the effect until Cancip/Obsidian is reloaded. This is still a real mobile hot patch; desktop Codex is only needed later to sync source/build/release.",
  copyMessage: "Copy",
  scrollToBottom: "Scroll to bottom",
  queueMessage: "Queue message",
  copyDone: "Copied",
  copyFailed: "Copy failed: {reason}",
  toolJsonDetails: "Tool / command details",
  processDetails: "Process details",
  chooseOption: "Choose",
  commandAddSelection: "Add selection to chat",
  commandRebuildIndex: "Rebuild light index",
  commandLocalVersionCommit: "Create local version commit",
  reviewGate: "Review",
  reviewGateStatus: "Building OB Review Gate...",
  reviewGateDone: "OB Review Gate package created: {path}",
  reviewGateFailed: "OB Review Gate failed: {reason}",
  reviewGateActionResult: "OB Review Gate:\n{summary}",
  reviewGatePrompt: "Use the programmatic cancip.reviewGate builder before risky vault organization. Pass concrete paths/proposed items when possible; do not use prompt-only review.",
  noSelection: "No selection to add",
  newChatStatus: "New chat",
  contextAdded: "Context added: {label}",
  indexedStatus: "{count} Markdown files indexed",
  indexedNotice: "Cancip indexed {count} files",
  agentKicker: "agent",
  newChatTitle: "New chat",
  modeAsk: "Cancip",
  modeSearch: "Search",
  modePlan: "Plan",
  modeEdit: "Edit",
  context: "context",
  clearContext: "Clear context",
  contextCleared: "Context cleared",
  addCurrentFile: "Add current file",
  addAttachment: "Add attachment",
  addMenuTitle: "Add context",
  addFileFolder: "File or folder",
  addPlugin: "Plugin",
  addSkill: "Skill",
  commandBus: "Command",
  addPlanMode: "Plan mode",
  addPursueGoal: "Pursue goal",
  pursueGoalPrompt: "Pursue goal: ",
  previewVaultSearch: "Preview Vault Search",
  addCoreMemory: "Add core memory",
  importCodexMemory: "Import Codex memory",
  localVersionCommit: "Local commit",
  dailyVersionStatus: "Daily versions",
  planPanelTitle: "Plan",
  realtimeTodos: "Live todos",
  manualTodos: "Manual todos",
  manualTodoPlaceholder: "Add a manual todo...",
  addManualTodo: "Add todo",
  noManualTodos: "No manual todos",
  planReadonlyStatus: "Plan mode is active",
  planReadonlyActionsBlocked: "Plan mode is active. Access mode still controls whether actions run.\n\n{summary}",
  todoPlanMode: "Plan layer is active: keep plan/todos visible. Access mode still controls execution.",
  todoCurrentFile: "Current file is available as context: {path}",
  todoNoCurrentFile: "No current file is open.",
  todoDraftContext: "{count} manual context item(s) attached.",
  todoManualOpen: "{count} manual todo(s) open.",
  todoRequestRunning: "A model request is running.",
  todoQueuedPrompts: "{count} prompt(s) queued.",
  todoCanExport: "Session can be exported for handoff.",
  todoLocalVersion: "Manual local version commit is available.",
  todoAutomations: "Automations are available.",
  stop: "Stop",
  send: "Send",
  directSend: "Direct send",
  queuedPrompt: "Queued {count} prompt(s)",
  queuedPromptRunning: "Running queued prompt. {count} left.",
  queuedCount: "Queued {count}",
  clearQueue: "Clear queue",
  queueCleared: "Queue cleared",
  directSendQueued: "Direct send queued first. Stopping current request...",
  modelEffort: "Extra High",
  accessMenuTitle: "Access",
  modelMenuTitle: "Model",
  accessModeChanged: "Access mode: {mode}",
  modelChanged: "Model: {model}",
  apiProfileChanged: "API profile: {profile}",
  mentionPanelTitle: "Files, folders, skills, commands, functions",
  mentionNoResults: "No matching files, folders, skills, commands, or functions",
  mentionFile: "File",
  mentionFolder: "Folder",
  mentionSkill: "Skill",
  mentionAction: "Function",
  mentionMode: "Mode",
  mentionFolderDetail: "{count} files",
  mentionContextIncluded: "Mentioned context",
  placeholder: "Cancip: @file, summarize, find notes, make a plan, suggest edits...",
  ready: "Ready",
  missingApi: "API URL/key/model is not configured.",
  preparingContext: "Preparing context...",
  contextBuildFailed: "Context build failed: {reason}",
  contextStepSkipped: "Skipped {step}: {reason}",
  repairRunning: "Repairing basic chat...",
  repairNoApi: "/修复 cannot run because API URL/key/model is incomplete. Fill them in settings or .cancip/config.json first.",
  repairNoSettingChanges: "no setting changes needed",
  repairSuccess: "/修复 completed.\n\n- Basic API probe: OK ({apiMode}, {model})\n- Safe basic chat settings: {changes}\n- Heavy automatic context is off by default now. Manual @ context, Search mode, Plan, command bus, and settings remain available.\n\nSend `测试` now.",
  repairFailed: "/修复 failed: {reason}",
  generating: "Generating...",
  done: "Done",
  callFailed: "Call failed",
  stopped: "Stopped",
  localNoHits: "Model call failed: {reason}\n\nNo local search results are attached for this turn. Keep the failure visible and continue from the latest session/tool state after the API recovers.",
  localHits: "Model call failed: {reason}\n\nHere are local Vault Search results for now.\n\nQuestion: {prompt}\n\n{list}",
  recentConversation: "Recent conversation",
  userQuestion: "User question",
  obsidianContext: "Obsidian context",
  none: "None",
  coreMemory: "Core memory",
  codexMemory: "Codex memory",
  taskExperience: "Task experience",
  codexMemoryImported: "Imported Codex memory: {count} file(s) -> {path}",
  codexMemoryImportFailed: "Codex memory import failed: {reason}",
  codexMemoryImportSkipped: "Codex memory import skipped: local source not available",
  currentFile: "Current file",
  vaultSearch: "Vault Search",
  noActiveFile: "No active file",
  noCoreMemory: "No core memory files found",
  searchFirst: "Type a search question first",
  hitCount: "{count} hits",
  emptyContext: "No context",
  sourceAdded: "Added to context",
  modePromptSearch: "Current mode: Search. List matched note paths first, then answer.",
  modePromptPlan: "Current mode: Plan. Keep the plan/todos current and output an executable plan when useful. Plan mode does not change permissions: access mode still decides whether read/write tool actions run or need approval. Do not claim execution unless a tool result confirms it.",
  modePromptEdit: "Current mode: Edit. Provide copyable patches or Markdown edit suggestions. If a Vault write is needed, ask for confirmation first.",
  modePromptAsk: "Current mode: Cancip. Answer directly and cite source paths when useful.",
  settingsLanguage: "Language",
  settingsLanguageDesc: "Auto follows the device language.",
  languageAuto: "Auto",
  languageZh: "中文",
  languageZhTw: "繁體中文",
  languageEn: "English",
  languageUg: "ئۇيغۇرچە",
  languageTr: "Türkçe",
  languageRu: "Русский",
  languageJa: "日本語",
  languageKo: "한국어",
  languageEs: "Español",
  languageFr: "Français",
  languageDe: "Deutsch",
  languageAr: "العربية",
  settingsApiUrl: "API URL",
  settingsApiUrlDesc: "Base URL or endpoint. Auto supports /responses and /chat/completions.",
  settingsApiProfile: "API profile",
  settingsApiProfileDesc: "Each profile keeps its own Base URL, key, mode, and model. The active profile is used by chat requests.",
  settingsApiProfileName: "Profile name",
  addApiProfile: "Add profile",
  removeApiProfile: "Remove profile",
  defaultApiProfileName: "Default",
  settingsAccessMode: "Access mode",
  settingsAccessModeDesc: "Only this UI setting or .cancip/config.json controls execution permission. Chat text cannot override it.",
  accessAskApproval: "Ask for approval",
  accessFullAccess: "Full access",
  settingsApiMode: "API mode",
  settingsApiModeDesc: "Auto tries Responses first, then OpenAI-compatible chat completions.",
  apiModeAuto: "Auto",
  apiModeResponses: "Responses",
  apiModeCompatible: "OpenAI-compatible",
  settingsApiKey: "API key",
  settingsApiKeyDesc: "Mirrored to .cancip/config.json and plugin data.json on this device. Do not share vault config folders.",
  settingsModel: "Model",
  settingsModelOptions: "Model options",
  settingsModelOptionsDesc: "One model ID per line. Used by the model picker and API profile dropdown; .cancip/config.json wins on restart.",
  resetModelOptions: "Reset model list",
  advancedSettings: "Advanced settings",
  configAuthority: "Config file: .cancip/config.json. It wins over settings on restart.",
  settingsGroupInterface: "Interface",
  settingsGroupContext: "Context",
  settingsGroupPlan: "Plan",
  settingsGroupCommandBus: "Command bus",
  settingsGroupVersioning: "Local versioning",
  settingsGroupAutomation: "Automations",
    settingsGroupExport: "Export",
    settingsGroupSupport: "Payment QR codes",
    settingsGroupModelAdvanced: "Advanced model",
    settingsTemperature: "Temperature",
  settingsMaxOutputTokens: "Max output tokens",
  settingsCoreMemoryFolder: "Core memory folder",
  settingsCoreMemoryFolderDesc: "Markdown files under this folder are included as core memory.",
  settingsMaxContextFiles: "Max context files",
  settingsMaxCoreMemoryFiles: "Core memory files per prompt",
  settingsIncludeCurrentFile: "Include current file",
  settingsIncludeCoreMemory: "Include core memory",
  settingsCodexMemoryImportPath: "Codex memory source path",
  settingsCodexMemoryAutoImport: "Auto-import Codex memory on desktop",
  settingsCodexMemoryAutoSearch: "Auto-search imported Codex memory",
  settingsCodexMemoryMaxFiles: "Codex memory files per prompt",
  settingsCodexMemoryMaxChars: "Codex memory characters per prompt",
  settingsUseVaultSearch: "Use Vault Search by default",
  settingsShowAttachmentButton: "Show attachment button",
  settingsCompactHeader: "Compact header",
  settingsAutoOpenPlanPanel: "Auto-open Plan panel",
  settingsShowLiveTodos: "Show live todos",
  settingsShowManualTodos: "Show manual todos",
  settingsCommandBusEnabled: "Enable command bus",
  settingsCommandBusEnabledDesc: "Allows structured cancip-action command entries. File read/write action blocks still follow access mode.",
  settingsExecuteObsidianCommands: "Allow Obsidian command execution",
  settingsExecuteObsidianCommandsDesc: "When off, obsidian.execute and real Obsidian command mentions are hidden/blocked.",
  settingsGithubCommandsEnabled: "Enable GitHub command targets",
  settingsGithubCommandsEnabledDesc: "Enables GitHub REST command bus targets. Approval mode queues them for Run; Full access executes them.",
  settingsGithubApiBaseUrl: "GitHub API URL",
  settingsGithubApiBaseUrlDesc: "Use the official API or your own trusted relay. Do not send tokens through public accelerators.",
  settingsGithubDownloadBaseUrl: "GitHub download accelerator URL",
  settingsGithubDownloadBaseUrlDesc: "Optional trusted prefix for public release/raw downloads. Tokens are never sent to this URL.",
  settingsGithubAcceleration: "GitHub acceleration preset",
  settingsGithubAccelerationDesc: "Use official GitHub by default. A trusted private relay may speed up mobile GitHub and plugin management.",
  githubAccelerationOfficial: "Official GitHub",
  githubAccelerationCustom: "Custom / private relay",
  settingsGithubOwner: "GitHub owner",
  settingsGithubRepo: "GitHub repo",
  settingsGithubToken: "GitHub token",
  settingsGithubTokenDesc: "Stored in .cancip/config.json on this vault. Exports only record whether it is configured.",
  settingsAutoContinueAfterTools: "Auto-continue after tools",
  settingsAutoContinueAfterToolsDesc: "After tool runs finish, call the model again with tool results, like Codex/Claude Code. Max iterations prevents loops.",
  settingsMaxToolIterations: "Max tool iterations",
  settingsExportMarkdownContextSnapshots: "Markdown export includes context snapshots",
  settingsExportMarkdownContextSnapshotsDesc: "JSON exports always keep the real full data for debugging; this only changes the readable Markdown export.",
  settingsExportMarkdownManualTodos: "Markdown export includes manual todos",
  settingsMaxRecentTranscriptMessages: "Recent transcript messages",
  settingsMaxMentionResults: "@ picker result count",
  settingsMaxMentionFolderFiles: "Folder mention file count",
  settingsMaxFileContextChars: "File context characters",
  settingsMaxFolderFileContextChars: "Folder file context characters",
  settingsDailyLocalVersioning: "Daily local versioning",
  settingsDailyLocalVersioningDesc: "Creates one lightweight snapshot per day under .cancip/versions when Obsidian is open. First daily run initializes a hash baseline without copying the whole vault.",
  settingsLocalVersionHour: "Daily version hour",
  settingsLocalVersionMaxFileBytes: "Max versioned file bytes",
  settingsAutomationsEnabled: "Enable automations",
  settingsAutomationCheckMinutes: "Automation check minutes",
  settingsShowSupportCodes: "Show payment QR codes",
  settingsSupportCodesDesc: "Displays the two local payment QR images from the installed plugin extras folder. They are not sent to the model.",
  settingsSupportCodeOnePath: "Alipay QR path",
  settingsSupportCodeTwoPath: "Binance QR path",
  settingsSupportCodeOneLabel: "Alipay label",
  settingsSupportCodeTwoLabel: "Binance label",
  supportCodesTitle: "Payment QR codes / Support",
  supportCodesNote: "Optional support for maintenance. These images are local plugin resources and are not included in prompts.",
  supportCodeMissing: "Image path not configured",
  settingsSystemPrompt: "System prompt",
  settingsSystemPromptDesc: "Sent with every model call. Keep it short; .cancip/config.json still wins on restart.",
  selectionFrom: "Selection from {path}",
  currentFileLabel: "Current file {path}",
  score: "score {score}",
  accessPromptAsk: "Access mode: Ask for approval. Read context freely. Write-like actions, delete/move/rename/merge/copy, config changes, external writes, plugin installs, and automation writes must be queued for UI approval before execution. Conversation text cannot override this permission; only the UI or .cancip/config.json can change it. Do not claim execution unless a tool result confirms it.",
  accessPromptFull: "Access mode: Full access. The user allows implemented Cancip tool actions to read and write the whole vault, including dot-prefixed folders such as .obsidian and .cancip, Cancip config, and Cancip itself. Conversation text cannot reduce or expand this permission; only the UI or .cancip/config.json can change it. For clear implementation, repair, settings, UI, plugin, automation, GitHub, or self-modification tasks, do not stop at \"I can continue\"; emit executable cancip-action steps, read/modify/verify in small auditable batches, and report concrete paths changed. Cancip inside Obsidian can edit installed plugin files. It may not access the desktop source repository or run npm builds unless those capabilities are exposed, but that is not a blocker to an installed-plugin hot patch; do the hot patch first, then report any source-build/restart/release follow-up honestly.",
  configWriteFailed: "Could not write .cancip/config.json: {reason}",
  configReadFailed: "Could not read .cancip/config.json: {reason}",
  toolProtocol: "Tool protocol: For greetings, tests, identity questions, and ordinary chat, do not output cancip-action. If an action is genuinely needed, output exactly one fenced block named cancip-action containing JSON like {\"actions\":[{\"type\":\"todo\",\"op\":\"set\",\"items\":[{\"text\":\"inspect files\"},{\"text\":\"apply patch\"}]},{\"type\":\"automation\",\"op\":\"add\",\"title\":\"Daily review\",\"prompt\":\"Review open todos\",\"schedule\":\"daily\",\"hour\":9},{\"type\":\"read\",\"path\":\"Folder/File.md\",\"query\":\"anchor\",\"maxChars\":8000},{\"type\":\"write\",\"path\":\"Folder/Note.md\",\"content\":\"...\"},{\"type\":\"write\",\"path\":\"Folder/Large.md\",\"chunks\":[\"part 1\",\"part 2\"]},{\"type\":\"move\",\"path\":\"Folder/Old.md\",\"newPath\":\"Folder/New.md\"},{\"type\":\"move\",\"path\":\"Folder/Old.md\",\"newPath\":\"Archive\"},{\"type\":\"delete\",\"path\":\"Folder/Old.md\"},{\"type\":\"patch\",\"path\":\"Folder/Note.md\",\"find\":\"old\",\"replace\":\"new\"},{\"type\":\"patch\",\"path\":\"Folder/Note.md\",\"regex\":true,\"find\":\"old\\\\s+pattern\",\"replace\":\"new\",\"flags\":\"m\"},{\"type\":\"config\",\"set\":{\"maxToolIterations\":6},\"unset\":[\"oldSetting\"]},{\"type\":\"command\",\"command\":\"cancip.searchVault\",\"args\":{\"query\":\"keyword\",\"limit\":8}}]}. Supported action types: read, write, append, patch, config, todo, automation, mkdir, rename, move, copy, delete, command. Read supports query, occurrence, and maxChars for focused snippets from large/minified files. Write and append support content or chunks:[\"part1\",\"part2\"]; for large files prefer chunks because Cancip writes/appends sequentially and verifies the result by reading it back. Move is the normal file/folder move action; rename is kept as an alias. If newPath is a folder path, Cancip keeps the original file/folder name under that folder. Delete moves to trash by default; if platform trash is unavailable, Cancip moves the target to .cancip/Trash; only use permanent:true when the user explicitly asks for permanent deletion. Patch supports exact find/replace or regex:true with optional flags; if patch text is not found, do not retry the same find text, read the current file with a focused query and use a smaller anchored patch. Config safely deep-merges JSON into .cancip/config.json by default, supports optional path, set, unset, replace, writes formatted JSON, and verifies by reading JSON back; use it for large config files instead of fragile string patches. Todo operations are set, add, update, remove, list, clear and update the visible Plan panel. Automation operations are add, update, remove, list, run; schedules are manual, hourly, daily. File actions use Vault-relative paths only. Command actions use a named command bus: obsidian.listCommands, obsidian.execute, cancip.reviewGate, cancip.reviewGate.list, cancip.sessionEvents, cancip.installedPlugins, cancip.automation.templates, cancip.automation.addTemplate, cancip.searchVault, cancip.rebuildIndex, cancip.previewVaultSearch, cancip.localVersionCommit, cancip.importCodexMemory, cancip.automation.list, cancip.automation.add, cancip.automation.run, cancip.automation.remove, github.help, github.status, github.repo, github.issues, github.pulls, github.releases, github.workflowRuns, github.branches, github.file, github.createIssue, github.installObsidianPlugin. For questions like \"which plugins are installed/enabled\", use cancip.installedPlugins or read .obsidian/community-plugins.json and answer the list directly; do not create reports and do not search .obsidian/plugins/_backups. For settings/UI/plugin/self-fix requests, first inspect the relevant source/config with read/search actions, then patch/write/config and verify. If desktop source is unavailable, use the installed plugin files under .obsidian/plugins/cancip as the mobile hot-patch implementation surface; do not stop merely because npm build/restart/source sync is unavailable. Installed Cancip plugin file edits require reload/restart before visible effect. Use cancip.searchVault only when long-term memory and supplied context are insufficient; then read only the necessary matched files. Keep action batches small and wait for results. If a tool fails, use the error as authoritative context and explain or correct the next step. Use cancip.reviewGate as a real programmatic OB Review Gate builder before risky vault organization or risky edits; it writes a mobile HTML review package, not just a prompt. Plan mode only adds planning/todo behavior and never changes access permission. Raw JavaScript eval is blocked.",
  actionsNeedApproval: "Action block queued for approval. Nothing has run yet.\n\n{summary}",
  actionsExecuted: "Tool results:\n\n{summary}",
  toolRunsQueued: "{count} tool run(s) queued. Review and tap Run when ready.",
  toolRunPending: "Pending approval",
  toolRunExecuting: "Running",
  toolRunExecuted: "Executed",
  toolRunBlocked: "Blocked",
  toolRunFailed: "Failed",
  toolRunRejected: "Rejected",
  runTool: "Run",
  rejectTool: "Reject",
  toolRunNoPending: "No pending tool run.",
  toolRunRejectedNotice: "Tool run rejected.",
  toolRunStarted: "Running tool...",
  toolRunFinished: "Tool run finished.",
  toolFeedbackStep: "Tool feedback: {status} · {summary}",
  toolFeedbackSaved: "Tool feedback saved",
  toolContinueStatus: "Continuing from tool results...",
  toolRunResult: "Tool result",
  toolContinuationPrompt: "Tool results from the previous action:\n\n{summary}\n\nContinue the task using these results. Tool failures are authoritative and must not be ignored: explain the failure, choose a smaller corrected next action, or give the final answer. If a patch failed because find text was not found, do not retry the same find text; read the current file with a focused query/maxChars snippet, then use a smaller anchored exact patch or regex:true patch. If the user asked for an implementation/change and only read/search/todo/list steps have run so far, you are not done: continue with the next concrete patch/write/command action unless a real blocker is shown. If a write/patch/command already succeeded, verify it by reading the changed path or checking the command result, then give a final user-readable conclusion. If more tool actions are needed, output one cancip-action block; otherwise give the final answer with status, changed paths, verification, and any blocker.",
  invalidActionBlock: "Cancip found an action block, but it was not valid executable JSON. Use one fenced ```cancip-action JSON block or <cancip-action>JSON</cancip-action>.",
  actionFailed: "Action failed: {reason}",
  actionRead: "read {path}\n{content}",
  actionWrite: "write {path}",
  actionWriteDetailed: "write {path} ({chars} chars, {chunks} chunks, verified)",
  actionAppend: "append {path}",
  actionAppendDetailed: "append {path} ({chars} chars, {chunks} chunks, verified)",
  actionPatch: "patch {path}",
  actionConfig: "config {path}",
  configActionResult: "config {path}\nupdated: {keys}\nverified: JSON readback OK",
  actionTodo: "todo {op}",
  actionAutomation: "automation {op}",
  todoActionResult: "Plan todos:\n{summary}",
  automationActionResult: "Automations:\n{summary}",
  automationTask: "Automation",
  automationStarted: "Automation started: {title}",
  automationDone: "Automation finished: {title}",
  automationFailed: "Automation failed: {reason}",
  automationNotFound: "Automation not found: {id}",
  automationListEmpty: "No automations",
  automationLogSaved: "Automation log saved: {path}",
  automationTemplates: "Automation templates:\n{summary}",
  automationTemplateAdded: "Automation template added: {title}",
  actionMkdir: "mkdir {path}",
  actionRename: "rename {path} -> {newPath}",
  actionMove: "move {path} -> {newPath}",
  actionCopy: "copy {path} -> {newPath}",
  actionDelete: "delete {path} ({mode})",
  actionCommand: "command {command} {args}",
  commandExecuted: "command {command}\n{result}",
  commandUnknown: "Unknown command: {command}",
  commandBlocked: "Command blocked: {reason}",
  githubNotConfigured: "GitHub owner/repo is not configured.",
  githubTokenMissing: "GitHub token is not configured. Public read requests may work, but write/private operations need a token.",
  githubAcceleratorStatus: "GitHub endpoint: {url}",
  commandBusDisabledPrompt: "Command bus is disabled in settings. Do not request command execution.",
  mentionCommand: "Command",
  invalidActionPath: "Invalid action path: {path}",
  noActions: "No valid actions found.",
  localVersionCreated: "Local version created: {id} ({count} files)",
  localVersionNoChanges: "No local version changes",
  localVersionBaseline: "Local version baseline initialized ({count} files)",
  localVersionFailed: "Local version failed: {reason}"
} as const;

type I18nKey = keyof typeof EN;

const I18N: Record<Language, Partial<Record<I18nKey, string>>> = {
  en: EN,
  zh: {
    openCancip: "打开 Cancip",
    commandOpenChat: "打开聊天",
    commandNewChat: "新对话",
    exportSession: "导出会话",
    exportNoMessages: "没有可导出的消息",
    exportDone: "会话已导出：{path}",
    exportFailed: "会话导出失败：{reason}",
    sessionHistory: "会话历史",
    sessionNoHistory: "没有已保存会话",
    sessionLoaded: "已打开历史会话，仅表示载入记录，不代表任务完成。",
    sessionEvents: "事件审计",
    sessionEventsEmpty: "还没有会话事件",
    sessionEventsCopied: "会话事件已复制",
    sessionSaveFailed: "会话保存失败：{reason}",
    sessionLoadFailed: "会话加载失败：{reason}",
    sessionRunning: "运行中",
  sessionCompleted: "已完成",
    sessionFailed: "失败",
    sessionIdLabel: "会话",
    copySessionId: "复制会话 ID",
    untitledSession: "新会话",
    sessionOutline: "当前会话",
    sessionOutlineEmpty: "当前会话还没有对话",
    progressDetails: "步骤详情",
    progressStep: "{status} · {summary}",
    elapsedSuffix: "耗时 {elapsed}",
    totalElapsed: "总耗时：{elapsed}",
    processRecord: "过程记录",
    finalConclusionFallback: "## 最终结论\n\n{summary}",
    emptyApiReply: "API 返回了空回复。",
    emptyApiReplyWithSuppressedTools: "API 只返回了工具/动作指令，没有给普通可见回复。简单聊天不会执行隐藏动作。",
    toolActionRequiredPrompt: "用户在全权模式下提出了明确的实现/改动任务，但你上一条回答没有输出 cancip-action，也没有任何工具执行。\n\n用户任务：\n{task}\n\n请像手机上的 Codex 一样继续：先检查确切相关文件/配置，再用 Cancip 当前可用的 Vault 工具做最小安全改动，然后通过读取改动路径或命令结果验证。Cancip 自改自身时，缺少桌面源码构建/npm/重启能力不算阻止安装热补丁的理由：如果当前只能写已安装插件，就先 patch .obsidian/plugins/cancip/main.js 或 styles.css，再报告仍需重载/源码同步。现在只输出一个 cancip-action 块。如果当前手机/Vault 工具边界连安装热补丁都确实无法执行，只给一个具体阻塞原因和缺少的明确能力，不要说“我可以继续”。",
    toolActionHardRequiredPrompt: "你上一条仍然没有给出可执行 cancip-action。现在是全权模式，用户要的是手机端真实改动。\n\n用户任务：\n{task}\n\n现在只输出一个 cancip-action 块。除非完全没有可写 Vault 路径，否则不要解释限制。Cancip 界面/自身修复任务，把 .obsidian/plugins/cancip/main.js 和/或 .obsidian/plugins/cancip/styles.css 当作手机热补丁目标，然后通过 read 验证改动路径。桌面源码构建、重启、发布可以在热补丁之后说明，不能阻止热补丁。",
    toolActionLowCommitmentPrompt: "用户要求的是明确实现/改动，但前几轮工具只做了读取、搜索或列表，没有产生任何真实改动。\n\n用户任务：\n{task}\n\n请像 Codex 一样继续。除非仍不知道确切可写目标，否则不要再泛搜。现在只输出一个 cancip-action 块，里面必须包含真实 patch/write/会改变状态的 command，并尽量附带 read/command 验证。如果确实没有可写目标，只给一个具体阻塞原因和缺少的明确能力。不要回答“未完成”“继续让我总结”或搜索结果摘要。",
    toolActionForcedVisible: "继续执行下一步可落地操作。",
    selfPatchNeedsReload: "这次改动写到了 Cancip 已安装插件文件。当前正在运行的插件通常不会立刻显示效果，需要重载/重启 Obsidian 才能可靠生效。这仍然是手机端真实热补丁；桌面 Codex 只用于后续同步源码、构建或发布。",
    copyMessage: "复制",
    scrollToBottom: "到底部",
    queueMessage: "加入队列",
    copyDone: "已复制",
    copyFailed: "复制失败：{reason}",
  toolJsonDetails: "工具/命令详情",
    processDetails: "过程详情",
    chooseOption: "选择",
    commandAddSelection: "把选中文本加入聊天",
    commandRebuildIndex: "重建轻量索引",
    commandLocalVersionCommit: "创建本地版本提交",
    reviewGate: "审核",
    reviewGateStatus: "正在生成 OB 审核门...",
    reviewGateDone: "OB 审核包已生成：{path}",
    reviewGateFailed: "OB 审核门失败：{reason}",
    reviewGateActionResult: "OB 审核门：\n{summary}",
    reviewGatePrompt: "高风险整理前使用程序化 cancip.reviewGate 生成审核包；尽量传入具体路径/提案，不要只发提示词。",
    noSelection: "没有可加入的选中文本",
    newChatStatus: "新对话",
    contextAdded: "已加入上下文：{label}",
    indexedStatus: "{count} 个 Markdown 文件可检索",
    indexedNotice: "Cancip 已索引 {count} 个文件",
    agentKicker: "agent",
    newChatTitle: "新对话",
    modeAsk: "Cancip",
    modeSearch: "搜",
    modePlan: "计划",
    modeEdit: "改",
    context: "上下文",
    clearContext: "清空上下文",
    contextCleared: "上下文已清空",
    addCurrentFile: "加入当前文件",
    addAttachment: "加入附件",
    addMenuTitle: "加入上下文",
    addFileFolder: "文件或文件夹",
    addPlugin: "Plugin",
    addSkill: "Skill",
    commandBus: "命令",
    addPlanMode: "Plan mode",
    addPursueGoal: "Pursue goal",
    pursueGoalPrompt: "追踪目标：",
    previewVaultSearch: "预览 Vault Search",
    addCoreMemory: "加入核心记忆",
    importCodexMemory: "导入 Codex 记忆",
    localVersionCommit: "本地提交",
    dailyVersionStatus: "每日版本",
    planPanelTitle: "计划",
    realtimeTodos: "实时待办",
    manualTodos: "手动待办",
    manualTodoPlaceholder: "添加手动待办...",
    addManualTodo: "添加待办",
    noManualTodos: "没有手动待办",
    planReadonlyStatus: "Plan mode 已启用",
    planReadonlyActionsBlocked: "Plan mode 已启用。动作是否执行仍由确认/全权权限决定。\n\n{summary}",
    todoPlanMode: "Plan 层已启用：保持计划/待办可见；执行权限仍由确认/全权决定。",
    todoCurrentFile: "当前文件已作为上下文：{path}",
    todoNoCurrentFile: "当前没有打开文件。",
    todoDraftContext: "已附加 {count} 个手动上下文。",
    todoManualOpen: "还有 {count} 个手动待办未完成。",
    todoRequestRunning: "模型请求正在运行。",
    todoQueuedPrompts: "还有 {count} 条消息排队。",
    todoCanExport: "当前会话可以导出交接。",
    todoLocalVersion: "可创建手动本地版本提交。",
    todoAutomations: "自动化任务可用。",
    stop: "停止",
    send: "发送",
    directSend: "直发",
    queuedPrompt: "已排队 {count} 条",
    queuedPromptRunning: "正在发送排队消息，还剩 {count} 条。",
    queuedCount: "排队 {count}",
    clearQueue: "清空队列",
    queueCleared: "队列已清空",
    directSendQueued: "已插队直发，正在停止当前请求...",
    modelEffort: "Extra High",
    accessMenuTitle: "权限",
    modelMenuTitle: "模型",
    accessModeChanged: "访问模式：{mode}",
    modelChanged: "模型：{model}",
    apiProfileChanged: "API 配置：{profile}",
    mentionPanelTitle: "文件、文件夹、Skill、命令、功能",
    mentionNoResults: "没有匹配的文件、文件夹、Skill、命令或功能",
    mentionFile: "文件",
    mentionFolder: "文件夹",
    mentionSkill: "Skill",
    mentionAction: "功能",
    mentionMode: "模式",
    mentionFolderDetail: "{count} 个文件",
    mentionContextIncluded: "已提及上下文",
    placeholder: "问 OB：@文件名、总结、找笔记、生成计划、给当前笔记改法...",
    ready: "准备就绪",
    missingApi: "还没有配置 API URL/key/model。",
    preparingContext: "正在准备上下文...",
    contextBuildFailed: "上下文构建失败：{reason}",
    contextStepSkipped: "已跳过 {step}：{reason}",
    repairRunning: "正在修复基础对话...",
    repairNoApi: "/修复 不能执行：API URL/key/model 不完整。先在设置或 .cancip/config.json 里填好。",
    repairNoSettingChanges: "无需修改设置",
    repairSuccess: "/修复 已完成。\n\n- 基础 API 探测：通过（{apiMode}，{model}）\n- 基础对话安全设置：{changes}\n- 现在默认关闭重型自动上下文；手动 @ 上下文、Search mode、Plan、命令总线和设置仍可用。\n\n现在发送 `测试`。",
    repairFailed: "/修复 失败：{reason}",
    generating: "模型生成中...",
    done: "完成",
    callFailed: "调用失败",
    stopped: "已停止",
    localNoHits: "模型调用失败：{reason}\n\n本轮没有可展示的本地检索结果。请保留这个失败原因，API 恢复后从最近会话/工具状态继续，不要误判为已经完成。",
    localHits: "模型调用失败：{reason}\n\n先给本地 Vault Search 结果，供你继续判断。\n\n问题：{prompt}\n\n{list}",
    recentConversation: "最近对话",
    userQuestion: "用户问题",
    obsidianContext: "Obsidian 上下文",
    none: "无",
    coreMemory: "核心记忆",
    codexMemory: "Codex 记忆",
    taskExperience: "任务经验",
    codexMemoryImported: "已导入 Codex 记忆：{count} 个文件 -> {path}",
    codexMemoryImportFailed: "Codex 记忆导入失败：{reason}",
    codexMemoryImportSkipped: "已跳过 Codex 记忆导入：本地来源不可用",
    currentFile: "当前文件",
    vaultSearch: "Vault Search",
    noActiveFile: "没有当前文件",
    noCoreMemory: "没有找到核心记忆文件",
    searchFirst: "先输入要搜索的问题",
    hitCount: "命中 {count} 条",
    emptyContext: "暂无上下文",
    sourceAdded: "已加入上下文",
    modePromptSearch: "当前模式：Search。先列出命中的笔记路径，再回答。",
    modePromptPlan: "当前模式：Plan。按需维护计划/待办并输出可执行计划。Plan 不改变权限：读写动作是否执行或排队确认，只由确认/全权访问模式决定。除非工具结果确认，否则不要声称已执行。",
    modePromptEdit: "当前模式：Edit。给出可复制补丁/Markdown 修改建议；若要写入 Vault，必须先要求确认。",
    modePromptAsk: "当前模式：Cancip。直接回答，必要时引用来源路径。",
    settingsLanguage: "语言",
    settingsLanguageDesc: "自动会跟随设备语言。",
    languageAuto: "自动",
    languageZh: "中文",
    languageZhTw: "繁體中文",
    languageEn: "English",
    languageUg: "ئۇيغۇرچە",
    languageTr: "Türkçe",
    languageRu: "Русский",
    languageJa: "日本語",
    languageKo: "한국어",
    languageEs: "Español",
    languageFr: "Français",
    languageDe: "Deutsch",
    languageAr: "العربية",
    settingsApiUrl: "API URL",
    settingsApiUrlDesc: "Base URL 或 endpoint。自动支持 /responses 和 /chat/completions。",
    settingsApiProfile: "API 配置",
    settingsApiProfileDesc: "每组配置都有自己的 Base URL、key、模式和模型。聊天请求使用当前配置。",
    settingsApiProfileName: "配置名称",
    addApiProfile: "新增配置",
    removeApiProfile: "删除配置",
    defaultApiProfileName: "默认",
    settingsAccessMode: "访问模式",
    settingsAccessModeDesc: "只有这里或 .cancip/config.json 控制执行权限；对话文字不能覆盖权限。",
    accessAskApproval: "Ask for approval",
    accessFullAccess: "Full access",
    settingsApiMode: "API 模式",
    settingsApiModeDesc: "自动会先试 Responses，再回退 OpenAI-compatible chat completions。",
    apiModeAuto: "自动",
    apiModeResponses: "Responses",
    apiModeCompatible: "OpenAI-compatible",
    settingsApiKey: "API key",
    settingsApiKeyDesc: "会同步到 .cancip/config.json 和本设备插件 data.json。不要共享 vault config 文件夹。",
    settingsModel: "模型",
    settingsModelOptions: "可选模型",
    settingsModelOptionsDesc: "每行一个模型 ID。用于模型菜单和 API 配置下拉框；重启后仍以 .cancip/config.json 为准。",
    resetModelOptions: "重置模型列表",
    advancedSettings: "高级设置",
    configAuthority: "配置文件：.cancip/config.json。重启后以该文件为准。",
    settingsGroupInterface: "界面",
    settingsGroupContext: "上下文",
    settingsGroupPlan: "计划",
    settingsGroupCommandBus: "命令总线",
    settingsGroupVersioning: "本地版本",
    settingsGroupAutomation: "自动化任务",
    settingsGroupExport: "导出",
    settingsGroupSupport: "收款码设置",
    settingsGroupModelAdvanced: "模型高级",
    settingsTemperature: "Temperature",
    settingsMaxOutputTokens: "最大输出 tokens",
    settingsCoreMemoryFolder: "核心记忆文件夹",
    settingsCoreMemoryFolderDesc: "该文件夹下的 Markdown 会作为核心记忆加入上下文。",
    settingsMaxContextFiles: "最大上下文文件数",
    settingsMaxCoreMemoryFiles: "每次提示词核心记忆文件数",
    settingsIncludeCurrentFile: "包含当前文件",
    settingsIncludeCoreMemory: "包含核心记忆",
    settingsCodexMemoryImportPath: "Codex 记忆来源路径",
    settingsCodexMemoryAutoImport: "桌面端自动导入 Codex 记忆",
    settingsCodexMemoryAutoSearch: "自动检索已导入 Codex 记忆",
    settingsCodexMemoryMaxFiles: "每次提示词最多记忆文件",
    settingsCodexMemoryMaxChars: "每次提示词最多记忆字数",
    settingsUseVaultSearch: "默认使用 Vault Search",
    settingsShowAttachmentButton: "显示附件按钮",
    settingsCompactHeader: "紧凑标题栏",
    settingsAutoOpenPlanPanel: "自动打开计划面板",
    settingsShowLiveTodos: "显示实时待办",
    settingsShowManualTodos: "显示手动待办",
    settingsCommandBusEnabled: "启用命令总线",
    settingsCommandBusEnabledDesc: "允许结构化 cancip-action command 项。文件读写动作仍按访问模式处理。",
    settingsExecuteObsidianCommands: "允许执行 Obsidian 命令",
    settingsExecuteObsidianCommandsDesc: "关闭后隐藏/阻止 obsidian.execute 和真实 Obsidian 命令提及。",
    settingsGithubCommandsEnabled: "启用 GitHub 命令目标",
    settingsGithubCommandsEnabledDesc: "启用 GitHub REST 命令总线目标。确认权限会排队等 Run；Full access 会直接执行。",
    settingsGithubApiBaseUrl: "GitHub API URL",
    settingsGithubApiBaseUrlDesc: "使用官方 API 或你自己的可信 relay。不要把 token 交给公共加速器。",
    settingsGithubDownloadBaseUrl: "GitHub 下载加速 URL",
    settingsGithubDownloadBaseUrlDesc: "可选可信前缀，用于公开 release/raw 下载。token 永远不会发到这里。",
    settingsGithubAcceleration: "GitHub 加速预设",
    settingsGithubAccelerationDesc: "默认使用官方 GitHub。可信私有 relay 可用于手机端 GitHub 和插件管理加速。",
    githubAccelerationOfficial: "官方 GitHub",
    githubAccelerationCustom: "自定义/私有 relay",
    settingsGithubOwner: "GitHub owner",
    settingsGithubRepo: "GitHub repo",
    settingsGithubToken: "GitHub token",
    settingsGithubTokenDesc: "保存在本库 .cancip/config.json。导出只记录是否已配置，不导出明文 token。",
    settingsAutoContinueAfterTools: "工具完成后自动继续",
    settingsAutoContinueAfterToolsDesc: "工具执行完成后，把工具结果回喂给模型继续推理，接近 Codex/Claude Code。最大迭代数用于防止循环。",
    settingsMaxToolIterations: "最大工具迭代次数",
    settingsExportMarkdownContextSnapshots: "Markdown 导出包含上下文快照",
    settingsExportMarkdownContextSnapshotsDesc: "JSON 导出永远保留真实完整数据用于排障；这里只影响可读 Markdown。",
    settingsExportMarkdownManualTodos: "Markdown 导出包含手动待办",
    settingsMaxRecentTranscriptMessages: "最近对话条数",
    settingsMaxMentionResults: "@ 选择结果数",
    settingsMaxMentionFolderFiles: "文件夹提及读取文件数",
    settingsMaxFileContextChars: "单文件上下文字数",
    settingsMaxFolderFileContextChars: "文件夹内单文件上下文字数",
    settingsDailyLocalVersioning: "每日本地版本",
    settingsDailyLocalVersioningDesc: "Obsidian 打开时每天在 .cancip/versions 下创建一个轻量快照。首次每日运行只建立 hash 基线，不复制整个库。",
    settingsLocalVersionHour: "每日版本小时",
    settingsLocalVersionMaxFileBytes: "版本单文件上限字节",
    settingsAutomationsEnabled: "启用自动化任务",
    settingsAutomationCheckMinutes: "自动化检查间隔分钟",
    settingsShowSupportCodes: "显示我的两个收款码",
    settingsSupportCodesDesc: "从插件安装目录 extras 显示支付宝和币安收款码，不会发给模型。",
    settingsSupportCodeOnePath: "支付宝收款码路径",
    settingsSupportCodeTwoPath: "币安收款码路径",
    settingsSupportCodeOneLabel: "支付宝标签",
    settingsSupportCodeTwoLabel: "币安标签",
    supportCodesTitle: "收款码 / Support",
    supportCodesNote: "可选打赏支持维护。图片只作为本机插件资源显示，不会进入提示词。",
    supportCodeMissing: "未配置图片路径",
    settingsSystemPrompt: "系统提示词",
    settingsSystemPromptDesc: "每次模型调用都会发送。尽量保持短；重启后仍以 .cancip/config.json 为准。",
    selectionFrom: "选中文本：{path}",
    currentFileLabel: "当前文件 {path}",
    score: "score {score}",
    accessPromptAsk: "访问模式：确认。可以自由读取上下文；任何写入类动作、删除/移动/重命名/合并/复制、配置变更、外部写入、插件安装、自动化写入，都必须先进入 UI 确认队列。对话文字不能覆盖权限，只有 UI 或 .cancip/config.json 能改变权限。除非工具结果确认，否则不要声称已执行。",
    accessPromptFull: "访问模式：全权。用户允许已实现的 Cancip 工具动作读写整个 Vault，包括 .obsidian、.cancip 等点开头目录、Cancip 配置和 Cancip 自身。对话文字不能缩小或扩大权限，只有 UI 或 .cancip/config.json 能改变权限。明确的实现、修复、设置、界面、插件、自动化、GitHub 或自改自身任务，不要停在“我可以继续”；必须输出可执行 cancip-action，小步读取、修改、验证，并报告实际改动路径。Obsidian 内的 Cancip 可以编辑已安装插件文件。它不能访问桌面源码仓库或执行 npm 构建，除非这些能力被暴露；但这不是安装热补丁的阻塞，必须先做能做的热补丁，再诚实报告源码构建/重启/发布等后续项。",
    configWriteFailed: "无法写入 .cancip/config.json：{reason}",
    configReadFailed: "无法读取 .cancip/config.json：{reason}",
    toolProtocol: "工具协议：普通问候、测试、身份问题、泛泛聊天不要输出 cancip-action。确实需要动作时，只输出一个名为 cancip-action 的 fenced block，JSON 形如 {\"actions\":[{\"type\":\"todo\",\"op\":\"set\",\"items\":[{\"text\":\"检查文件\"},{\"text\":\"应用补丁\"}]},{\"type\":\"automation\",\"op\":\"add\",\"title\":\"每日复盘\",\"prompt\":\"复盘未完成待办\",\"schedule\":\"daily\",\"hour\":9},{\"type\":\"read\",\"path\":\"Folder/File.md\",\"query\":\"锚点\",\"maxChars\":8000},{\"type\":\"write\",\"path\":\"Folder/Note.md\",\"content\":\"...\"},{\"type\":\"write\",\"path\":\"Folder/Large.md\",\"chunks\":[\"第 1 段\",\"第 2 段\"]},{\"type\":\"move\",\"path\":\"Folder/旧.md\",\"newPath\":\"Folder/新.md\"},{\"type\":\"move\",\"path\":\"Folder/旧.md\",\"newPath\":\"归档\"},{\"type\":\"delete\",\"path\":\"Folder/旧.md\"},{\"type\":\"patch\",\"path\":\"Folder/Note.md\",\"find\":\"旧内容\",\"replace\":\"新内容\"},{\"type\":\"patch\",\"path\":\"Folder/Note.md\",\"regex\":true,\"find\":\"旧内容\\\\s+模式\",\"replace\":\"新内容\",\"flags\":\"m\"},{\"type\":\"config\",\"set\":{\"maxToolIterations\":6},\"unset\":[\"oldSetting\"]},{\"type\":\"command\",\"command\":\"cancip.searchVault\",\"args\":{\"query\":\"关键词\",\"limit\":8}}]}。支持动作：read、write、append、patch、config、todo、automation、mkdir、rename、move、copy、delete、command。read 支持 query、occurrence、maxChars，用来精确读取大文件/压缩构建文件里的当前片段。write/append 支持 content 或 chunks:[\"part1\",\"part2\"]；写大文件优先用 chunks，Cancip 会顺序写入/追加并读回校验。move 是正常移动文件/文件夹动作，rename 保留为别名；如果 newPath 是文件夹路径，工具层会保留原文件/文件夹名放进该文件夹。delete 默认进入回收站；平台回收站不可用时移入 .cancip/Trash；只有用户明确要求永久删除时才使用 permanent:true。patch 支持精确 find/replace，也支持 regex:true 和可选 flags；如果 patch 提示 find text was not found，绝对不要重复同一个 find，必须先用 query 读取当前文件片段，再换更小锚点或正则补丁。config 默认安全深度合并写入 .cancip/config.json，可选 path、set、unset、replace，会格式化 JSON 并读回校验；改大型配置文件优先用 config，不要靠脆弱字符串 patch。todo 支持 set、add、update、remove、list、clear，并会更新可见 Plan 面板。automation 支持 add、update、remove、list、run；schedule 可用 manual、hourly、daily。文件动作只能使用 Vault 相对路径。命令动作走命令总线：obsidian.listCommands、obsidian.execute、cancip.reviewGate、cancip.reviewGate.list、cancip.sessionEvents、cancip.installedPlugins、cancip.automation.templates、cancip.automation.addTemplate、cancip.searchVault、cancip.rebuildIndex、cancip.previewVaultSearch、cancip.localVersionCommit、cancip.importCodexMemory、cancip.automation.list、cancip.automation.add、cancip.automation.run、cancip.automation.remove、github.help、github.status、github.repo、github.issues、github.pulls、github.releases、github.workflowRuns、github.branches、github.file、github.createIssue、github.installObsidianPlugin。用户问“装了哪些/那些插件、启用了哪些插件、插件清单”时，使用 cancip.installedPlugins 或读取 .obsidian/community-plugins.json 后直接回答列表；不要创建报告，不要搜索 .obsidian/plugins/_backups。设置/界面/插件/自身修复类任务，先用 read/search 检查相关源码或配置，再 patch/write/config 并验证；若桌面源码不可用，就把 .obsidian/plugins/cancip 下的已安装插件文件作为手机热补丁实现面，不能仅因 npm build/重启/源码同步不可用就停止。写已安装 Cancip 插件文件后必须说明需要重载/重启才有可见效果。只有长期记忆和已提供上下文不够时才用 cancip.searchVault 搜库，然后只读取必要命中文件。动作批次要小，等待工具结果后继续。工具失败就是权威上下文，必须解释失败或改用更小的下一步。Vault 整理、移动、重命名、合并、拆分、修复链接等高风险改动前，先用 cancip.reviewGate 程序化生成手机 HTML 审核包；它不是提示词。Plan mode 只增加计划/待办层，不改变访问权限。原始 JavaScript eval 阻止。",
    actionsNeedApproval: "动作块已进入确认队列，尚未执行。\n\n{summary}",
    actionsExecuted: "工具执行结果：\n\n{summary}",
    toolRunsQueued: "{count} 个工具调用已排队。确认后点 Run 执行。",
    toolRunPending: "等待确认",
    toolRunExecuting: "执行中",
    toolRunExecuted: "已执行",
    toolRunBlocked: "已阻止",
    toolRunFailed: "失败",
    toolRunRejected: "已拒绝",
    runTool: "Run",
    rejectTool: "拒绝",
    toolRunNoPending: "没有待确认工具调用。",
    toolRunRejectedNotice: "已拒绝工具调用。",
    toolRunStarted: "正在执行工具...",
    toolRunFinished: "工具执行完成。",
    toolFeedbackStep: "工具反馈：{status} · {summary}",
    toolFeedbackSaved: "工具反馈已记录",
    toolContinueStatus: "正在根据工具结果继续...",
    toolRunResult: "工具结果",
    toolContinuationPrompt: "上一步工具执行结果：\n\n{summary}\n\n请根据这些结果继续完成任务。工具失败是权威上下文，不能忽略：要解释失败原因，改用更小且更明确的下一步，或直接给最终回答。如果 patch 因 find text was not found 失败，绝对不要重复同一个 find；先用 query/maxChars 读取当前文件片段，再换更小的精确锚点或 regex:true 补丁。如果用户要求实现/修改，而目前只执行了读取、搜索、待办或列表步骤，说明还没完成：除非有真实阻塞，否则继续给出下一个 patch/write/command 具体动作。如果写入、补丁或命令已经成功，必须再通过读取改动路径或检查命令结果验证，然后给用户能直接看懂的最终结论。若还需要工具动作，只输出一个 cancip-action 块；否则最终回答必须写明状态、改动路径、验证结果和阻塞项。",
    invalidActionBlock: "Cancip 找到了动作块，但里面不是可执行的 JSON。请使用一个 fenced ```cancip-action JSON 块，或 <cancip-action>JSON</cancip-action>。",
    actionFailed: "动作失败：{reason}",
    actionRead: "read {path}\n{content}",
    actionWrite: "write {path}",
    actionWriteDetailed: "write {path}（{chars} 字符，{chunks} 块，已校验）",
    actionAppend: "append {path}",
    actionAppendDetailed: "append {path}（{chars} 字符，{chunks} 块，已校验）",
    actionPatch: "patch {path}",
    actionConfig: "config {path}",
    configActionResult: "config {path}\n已更新：{keys}\n已校验：JSON 可读回",
    actionTodo: "todo {op}",
    actionAutomation: "automation {op}",
    todoActionResult: "计划待办：\n{summary}",
    automationActionResult: "自动化任务：\n{summary}",
    automationTask: "自动化任务",
    automationStarted: "自动化已开始：{title}",
    automationDone: "自动化已完成：{title}",
    automationFailed: "自动化失败：{reason}",
    automationNotFound: "未找到自动化任务：{id}",
    automationListEmpty: "没有自动化任务",
    automationLogSaved: "自动化日志已保存：{path}",
    automationTemplates: "自动化模板：\n{summary}",
    automationTemplateAdded: "已加入自动化模板：{title}",
    actionMkdir: "mkdir {path}",
    actionRename: "rename {path} -> {newPath}",
    actionMove: "move {path} -> {newPath}",
    actionCopy: "copy {path} -> {newPath}",
    actionDelete: "delete {path}（{mode}）",
    actionCommand: "command {command} {args}",
    commandExecuted: "command {command}\n{result}",
    commandUnknown: "未知命令：{command}",
    commandBlocked: "命令已阻止：{reason}",
    githubNotConfigured: "GitHub owner/repo 未配置。",
    githubTokenMissing: "GitHub token 未配置。公开读取可能可用，写入或私有仓库需要 token。",
    githubAcceleratorStatus: "GitHub endpoint：{url}",
    commandBusDisabledPrompt: "设置中已关闭命令总线，不要请求执行 command 动作。",
    mentionCommand: "命令",
    invalidActionPath: "非法动作路径：{path}",
    noActions: "没有找到有效动作。",
    localVersionCreated: "已创建本地版本：{id}（{count} 个文件）",
    localVersionNoChanges: "本地版本没有变化",
    localVersionBaseline: "已初始化本地版本基线（{count} 个文件）",
    localVersionFailed: "本地版本失败：{reason}"
  },
  "zh-TW": {
    openCancip: "開啟 Cancip",
    commandOpenChat: "開啟聊天",
    commandNewChat: "新對話",
    exportSession: "匯出會話",
    exportNoMessages: "沒有可匯出的訊息",
    exportDone: "會話已匯出：{path}",
    exportFailed: "會話匯出失敗：{reason}",
    sessionHistory: "會話歷史",
    sessionNoHistory: "沒有已儲存會話",
    sessionLoaded: "已開啟歷史會話，只表示載入記錄，不代表任務完成。",
    sessionSaveFailed: "會話儲存失敗：{reason}",
    sessionLoadFailed: "會話載入失敗：{reason}",
    commandAddSelection: "將選取文字加入聊天",
    commandRebuildIndex: "重建輕量索引",
    commandLocalVersionCommit: "建立本機版本提交",
    noSelection: "沒有可加入的選取文字",
    newChatStatus: "新對話",
    contextAdded: "已加入上下文：{label}",
    indexedStatus: "{count} 個 Markdown 檔可檢索",
    indexedNotice: "Cancip 已索引 {count} 個檔案",
    modeAsk: "Cancip",
    modeSearch: "搜",
    modePlan: "計畫",
    modeEdit: "改",
    context: "上下文",
    clearContext: "清空上下文",
    contextCleared: "上下文已清空",
    addCurrentFile: "加入目前檔案",
    addMenuTitle: "加入上下文",
    addFileFolder: "檔案或資料夾",
    commandBus: "命令",
    addPlanMode: "Plan mode",
    addPursueGoal: "Pursue goal",
    pursueGoalPrompt: "追蹤目標：",
    previewVaultSearch: "預覽 Vault Search",
    addCoreMemory: "加入核心記憶",
    localVersionCommit: "本機提交",
    dailyVersionStatus: "每日版本",
    stop: "停止",
    send: "傳送",
    directSend: "直發",
    queuedPrompt: "已排隊 {count} 則",
    queuedPromptRunning: "正在傳送排隊訊息，剩 {count} 則。",
    queuedCount: "排隊 {count}",
    clearQueue: "清空佇列",
    queueCleared: "佇列已清空",
    directSendQueued: "已插隊直發，正在停止目前請求...",
    accessMenuTitle: "權限",
    modelMenuTitle: "模型",
    accessModeChanged: "存取模式：{mode}",
    modelChanged: "模型：{model}",
    apiProfileChanged: "API 設定：{profile}",
    mentionPanelTitle: "檔案、資料夾、Skill、命令、功能",
    mentionNoResults: "沒有符合的檔案、資料夾、Skill、命令或功能",
    mentionFile: "檔案",
    mentionFolder: "資料夾",
    mentionAction: "功能",
    mentionMode: "模式",
    mentionFolderDetail: "{count} 個檔案",
    mentionContextIncluded: "已提及上下文",
    placeholder: "Cancip：@檔案、總結、找筆記、生成計畫、建議修改...",
    ready: "準備就緒",
    missingApi: "尚未設定 API URL/key/model。",
    generating: "模型生成中...",
    done: "完成",
    callFailed: "呼叫失敗",
    stopped: "已停止",
    recentConversation: "最近對話",
    userQuestion: "使用者問題",
    obsidianContext: "Obsidian 上下文",
    none: "無",
    coreMemory: "核心記憶",
    currentFile: "目前檔案",
    noActiveFile: "沒有目前檔案",
    noCoreMemory: "沒有找到核心記憶檔案",
    searchFirst: "請先輸入要搜尋的問題",
    hitCount: "命中 {count} 筆",
    emptyContext: "沒有上下文",
    sourceAdded: "已加入上下文",
    settingsLanguage: "語言",
    settingsLanguageDesc: "自動會跟隨裝置語言。",
    languageAuto: "自動",
    settingsApiProfile: "API 設定",
    settingsApiProfileName: "設定名稱",
    addApiProfile: "新增設定",
    removeApiProfile: "移除設定",
    defaultApiProfileName: "預設",
    settingsAccessMode: "存取模式",
    settingsAccessModeDesc: "控制寫入類動作是否需要先確認。",
    accessAskApproval: "Ask for approval",
    accessFullAccess: "Full access",
    settingsApiMode: "API 模式",
    apiModeAuto: "自動",
    apiModeCompatible: "OpenAI-compatible",
    settingsModel: "模型",
    advancedSettings: "進階設定",
    configAuthority: "設定檔：.cancip/config.json。重啟後以該檔案為準。",
    settingsGroupInterface: "介面",
    settingsGroupContext: "上下文",
    settingsGroupPlan: "計畫",
    settingsGroupCommandBus: "命令匯流排",
    settingsGroupVersioning: "本機版本",
    settingsGroupExport: "匯出",
    settingsGroupSupport: "收款碼設定",
    settingsGroupModelAdvanced: "模型進階",
    settingsModelOptions: "可選模型",
    settingsModelOptionsDesc: "每行一個模型 ID。用於模型選單和 API 設定下拉；重啟後仍以 .cancip/config.json 為準。",
    resetModelOptions: "重設模型列表",
    settingsMaxOutputTokens: "最大輸出 tokens",
    settingsCoreMemoryFolder: "核心記憶資料夾",
    settingsMaxContextFiles: "最大上下文檔案數",
    settingsIncludeCurrentFile: "包含目前檔案",
    settingsIncludeCoreMemory: "包含核心記憶",
    settingsUseVaultSearch: "預設使用 Vault Search",
    settingsShowAttachmentButton: "顯示附件按鈕",
    settingsCompactHeader: "緊湊標題列",
    settingsAutoOpenPlanPanel: "自動開啟計畫面板",
    settingsShowLiveTodos: "顯示即時待辦",
    settingsShowManualTodos: "顯示手動待辦",
    settingsCommandBusEnabled: "啟用命令匯流排",
    settingsCommandBusEnabledDesc: "允許結構化 cancip-action command 項目。檔案讀寫動作仍依存取模式處理。",
    settingsExecuteObsidianCommands: "允許執行 Obsidian 命令",
    settingsExecuteObsidianCommandsDesc: "關閉後會隱藏/阻止 obsidian.execute 與真實 Obsidian 命令提及。",
    settingsGithubCommandsEnabled: "顯示 GitHub 命令目標",
    settingsExportMarkdownContextSnapshots: "Markdown 匯出包含上下文快照",
    settingsExportMarkdownContextSnapshotsDesc: "JSON 匯出永遠保留真實完整資料；這只影響可讀 Markdown。",
    settingsExportMarkdownManualTodos: "Markdown 匯出包含手動待辦",
    settingsMaxRecentTranscriptMessages: "最近對話條數",
    settingsMaxMentionResults: "@ 選擇結果數",
    settingsMaxMentionFolderFiles: "資料夾提及讀取檔案數",
    settingsMaxFileContextChars: "單檔上下文字數",
    settingsMaxFolderFileContextChars: "資料夾內單檔上下文字數",
    settingsDailyLocalVersioning: "每日在地版本",
    settingsShowSupportCodes: "顯示我的兩個收款碼",
    settingsSupportCodesDesc: "從插件安裝目錄 extras 顯示支付寶與幣安收款碼，不會送給模型。",
    settingsSupportCodeOnePath: "支付寶收款碼路徑",
    settingsSupportCodeTwoPath: "幣安收款碼路徑",
    settingsSupportCodeOneLabel: "支付寶標籤",
    settingsSupportCodeTwoLabel: "幣安標籤",
    supportCodesTitle: "收款碼 / Support",
    supportCodesNote: "可選打賞支援維護。圖片只作為本機插件資源顯示，不會進入提示詞。",
    supportCodeMissing: "未設定圖片路徑",
    settingsSystemPrompt: "系統提示詞",
    settingsSystemPromptDesc: "每次聊天都會套用。",
    selectionFrom: "選取文字：{path}",
    currentFileLabel: "目前檔案 {path}",
    accessPromptAsk: "存取模式：Ask for approval。可以自由讀取上下文，但任何寫入、刪除、移動、重新命名、合併或設定變更前必須先請求使用者確認，不要聲稱已執行。",
    accessPromptFull: "存取模式：Full access。使用者允許 Cancip 工具動作讀寫整個 Vault，包括 .obsidian、.cancip 等點開頭目錄。必須保護資料、保持可稽核，並報告實際改動路徑。",
    actionsNeedApproval: "偵測到動作區塊。目前是 Ask for approval 模式，所以沒有執行。\n\n{summary}",
    actionsExecuted: "已執行動作：\n\n{summary}",
    actionFailed: "動作失敗：{reason}",
    commandUnknown: "未知命令：{command}",
    commandBlocked: "命令已阻止：{reason}",
    commandBusDisabledPrompt: "設定中已關閉命令匯流排，不要要求執行 command 動作。",
    mentionCommand: "命令",
    invalidActionPath: "非法動作路徑：{path}",
    noActions: "沒有找到有效動作。",
    localVersionCreated: "已建立本機版本：{id}（{count} 個檔案）",
    localVersionNoChanges: "本機版本沒有變更",
    localVersionBaseline: "已初始化本機版本基線（{count} 個檔案）",
    localVersionFailed: "本機版本失敗：{reason}"
  },
  ug: {
    openCancip: "Cancip نى ئېچىش",
    commandOpenChat: "سۆھبەتنى ئېچىش",
    commandNewChat: "يېڭى سۆھبەت",
    exportSession: "سۆھبەتنى چىقىرىش",
    exportNoMessages: "چىقىرىدىغان ئۇچۇر يوق",
    exportDone: "سۆھبەت چىقىرىلدى: {path}",
    exportFailed: "سۆھبەتنى چىقىرىش مەغلۇپ بولدى: {reason}",
    sessionHistory: "سۆھبەت تارىخى",
    sessionNoHistory: "ساقلانغان سۆھبەت يوق",
    sessionLoaded: "ساقلانغان سۆھبەت ئېچىلدى. بۇ پەقەت تارىخنى يۈكلەيدۇ؛ ۋەزىپە تاماملاندى دېگەنلىك ئەمەس.",
    commandAddSelection: "تاللانغان تېكىستنى قوشۇش",
    newChatStatus: "يېڭى سۆھبەت",
    contextAdded: "كونتېكىست قوشۇلدى: {label}",
    indexedStatus: "{count} Markdown ھۆججەت ئىندېكستلاندى",
    modeAsk: "Cancip",
    modeSearch: "ئىزدە",
    modePlan: "پىلان",
    modeEdit: "تۈزەت",
    context: "كونتېكىست",
    clearContext: "كونتېكىستنى تازىلاش",
    addCurrentFile: "ھازىرقى ھۆججەتنى قوشۇش",
    addMenuTitle: "كونتېكىست قوشۇش",
    addFileFolder: "ھۆججەت ياكى قىسقۇچ",
    commandBus: "بۇيرۇق",
    previewVaultSearch: "Vault Search نى كۆرۈش",
    addCoreMemory: "ئاساسىي ئەستە ساقلاشنى قوشۇش",
    localVersionCommit: "يەرلىك commit",
    dailyVersionStatus: "كۈندىلىك نۇسخىلار",
    stop: "توختات",
    send: "يوللا",
    directSend: "بىۋاسىتە يوللا",
    queuedPrompt: "{count} ئۇچۇر قاتارغا قوشۇلدى",
    queuedPromptRunning: "قاتاردىكى ئۇچۇر يوللىنىۋاتىدۇ، {count} قالدى.",
    queuedCount: "قاتار {count}",
    clearQueue: "قاتارنى تازىلا",
    queueCleared: "قاتار تازىلاندى",
    directSendQueued: "بىۋاسىتە يوللاش ئالدىغا قويۇلدى...",
    accessMenuTitle: "ھوقۇق",
    modelMenuTitle: "مودېل",
    accessModeChanged: "ھوقۇق ھالىتى: {mode}",
    modelChanged: "مودېل: {model}",
    mentionPanelTitle: "ھۆججەت، قىسقۇچ، Skill، بۇيرۇق ۋە ئىقتىدارلار",
    mentionNoResults: "ماس نەتىجە يوق",
    mentionFile: "ھۆججەت",
    mentionFolder: "قىسقۇچ",
    mentionAction: "ئىقتىدار",
    mentionMode: "ھالەت",
    placeholder: "Cancip: @ھۆججەت، خۇلاسە، خاتىرە ئىزدەش، پىلان...",
    ready: "تەييار",
    missingApi: "API URL/key/model سەپلەنمىگەن.",
    generating: "مودېل جاۋاب بېرىۋاتىدۇ...",
    done: "تامام",
    callFailed: "چاقىرىش مەغلۇپ بولدى",
    stopped: "توختىدى",
    recentConversation: "يېقىنقى سۆھبەت",
    userQuestion: "ئىشلەتكۈچى سوئالى",
    obsidianContext: "Obsidian كونتېكىستى",
    none: "يوق",
    coreMemory: "ئاساسىي ئەستە",
    currentFile: "ھازىرقى ھۆججەت",
    noActiveFile: "ھازىرقى ھۆججەت يوق",
    searchFirst: "ئاۋۋال ئىزدەش سوئالىنى كىرگۈزۈڭ",
    hitCount: "{count} نەتىجە",
    emptyContext: "كونتېكىست يوق",
    settingsLanguage: "تىل",
    settingsLanguageDesc: "ئاپتوماتىك ھالدا ئۈسكۈنە تىلىغا ئەگىشىدۇ.",
    languageAuto: "ئاپتوماتىك",
    settingsApiProfile: "API سەپلىمىسى",
    settingsApiProfileName: "سەپلىمە نامى",
    addApiProfile: "سەپلىمە قوشۇش",
    removeApiProfile: "سەپلىمىنى ئۆچۈرۈش",
    settingsAccessMode: "ھوقۇق ھالىتى",
    accessAskApproval: "تەستىق سوراش",
    accessFullAccess: "تولۇق ھوقۇق",
    settingsApiMode: "API ھالىتى",
    apiModeAuto: "ئاپتوماتىك",
    settingsModel: "مودېل",
    advancedSettings: "ئىلغار تەڭشەكلەر",
    settingsCoreMemoryFolder: "ئاساسىي ئەستە قىسقۇچى",
    settingsMaxContextFiles: "ئەڭ كۆپ كونتېكىست ھۆججىتى",
    settingsIncludeCurrentFile: "ھازىرقى ھۆججەتنى ئۆز ئىچىگە ئېلىش",
    settingsIncludeCoreMemory: "ئاساسىي ئەستىنى ئۆز ئىچىگە ئېلىش",
    settingsUseVaultSearch: "Vault Search نى كۆڭۈلدىكى ئىشلىتىش",
    settingsSystemPrompt: "سىستېما كۆرسەتمىسى",
    selectionFrom: "تاللانغان: {path}",
    currentFileLabel: "ھازىرقى ھۆججەت {path}",
    actionsNeedApproval: "ھەرىكەت بۆلىكى بايقالدى. ھازىر تەستىق سوراش ھالىتى، شۇڭا ئىجرا قىلىنمىدى.\n\n{summary}",
    actionsExecuted: "ئىجرا قىلىنغان ھەرىكەتلەر:\n\n{summary}",
    actionFailed: "ھەرىكەت مەغلۇپ بولدى: {reason}",
    mentionCommand: "بۇيرۇق",
    invalidActionPath: "ئىناۋەتسىز يول: {path}",
    noActions: "ئىناۋەتلىك ھەرىكەت تېپىلمىدى.",
    localVersionCreated: "يەرلىك نۇسخا قۇرۇلدى: {id} ({count} ھۆججەت)",
    localVersionNoChanges: "يەرلىك نۇسخىدا ئۆزگىرىش يوق",
    localVersionFailed: "يەرلىك نۇسخا مەغلۇپ بولدى: {reason}"
  },
  tr: {
    openCancip: "Cancip'i Aç",
    commandOpenChat: "Sohbeti aç",
    commandNewChat: "Yeni sohbet",
    exportSession: "Oturumu dışa aktar",
    exportNoMessages: "Dışa aktarılacak mesaj yok",
    exportDone: "Oturum dışa aktarıldı: {path}",
    exportFailed: "Oturum dışa aktarılamadı: {reason}",
    sessionHistory: "Oturum geçmişi",
    sessionNoHistory: "Kayıtlı oturum yok",
    sessionLoaded: "Kayıtlı oturum açıldı. Bu yalnızca geçmişi yükler; görevin bittiği anlamına gelmez.",
    newChatStatus: "Yeni sohbet",
    contextAdded: "Bağlam eklendi: {label}",
    indexedStatus: "{count} Markdown dosyası indekslendi",
    modeAsk: "Cancip",
    modeSearch: "Ara",
    modePlan: "Plan",
    modeEdit: "Düzenle",
    context: "bağlam",
    clearContext: "Bağlamı temizle",
    addCurrentFile: "Geçerli dosyayı ekle",
    addMenuTitle: "Bağlam ekle",
    addFileFolder: "Dosya veya klasör",
    commandBus: "Komut",
    addPlanMode: "Plan modu",
    addPursueGoal: "Hedefi takip et",
    pursueGoalPrompt: "Hedefi takip et: ",
    previewVaultSearch: "Vault Search önizle",
    addCoreMemory: "Çekirdek belleği ekle",
    localVersionCommit: "Yerel commit",
    dailyVersionStatus: "Günlük sürümler",
    stop: "Durdur",
    send: "Gönder",
    directSend: "Doğrudan gönder",
    queuedPrompt: "{count} ileti sıraya alındı",
    queuedPromptRunning: "Sıradaki ileti gönderiliyor. {count} kaldı.",
    queuedCount: "Sırada {count}",
    clearQueue: "Sırayı temizle",
    queueCleared: "Sıra temizlendi",
    directSendQueued: "Doğrudan gönderim öne alındı...",
    accessMenuTitle: "Erişim",
    modelMenuTitle: "Model",
    accessModeChanged: "Erişim modu: {mode}",
    modelChanged: "Model: {model}",
    apiProfileChanged: "API profili: {profile}",
    mentionPanelTitle: "Dosyalar, klasörler, skill'ler, komutlar, işlevler",
    mentionNoResults: "Eşleşen öğe yok",
    mentionFile: "Dosya",
    mentionFolder: "Klasör",
    mentionAction: "İşlev",
    mentionMode: "Mod",
    placeholder: "Cancip: @dosya, özetle, not bul, plan yap, düzenleme öner...",
    ready: "Hazır",
    missingApi: "API URL/key/model yapılandırılmamış.",
    generating: "Üretiliyor...",
    done: "Bitti",
    callFailed: "Çağrı başarısız",
    stopped: "Durduruldu",
    recentConversation: "Son konuşma",
    userQuestion: "Kullanıcı sorusu",
    obsidianContext: "Obsidian bağlamı",
    none: "Yok",
    coreMemory: "Çekirdek bellek",
    currentFile: "Geçerli dosya",
    noActiveFile: "Geçerli dosya yok",
    searchFirst: "Önce arama sorusu yaz",
    hitCount: "{count} sonuç",
    emptyContext: "Bağlam yok",
    settingsLanguage: "Dil",
    settingsLanguageDesc: "Otomatik, cihaz dilini izler.",
    languageAuto: "Otomatik",
    settingsApiProfile: "API profili",
    settingsApiProfileName: "Profil adı",
    addApiProfile: "Profil ekle",
    removeApiProfile: "Profili kaldır",
    settingsAccessMode: "Erişim modu",
    accessAskApproval: "Onay iste",
    accessFullAccess: "Tam erişim",
    settingsApiMode: "API modu",
    apiModeAuto: "Otomatik",
    settingsModel: "Model",
    advancedSettings: "Gelişmiş ayarlar",
    settingsCoreMemoryFolder: "Çekirdek bellek klasörü",
    settingsMaxContextFiles: "Maksimum bağlam dosyası",
    settingsIncludeCurrentFile: "Geçerli dosyayı dahil et",
    settingsIncludeCoreMemory: "Çekirdek belleği dahil et",
    settingsUseVaultSearch: "Varsayılan Vault Search",
    settingsSystemPrompt: "Sistem istemi",
    selectionFrom: "{path} seçimi",
    currentFileLabel: "Geçerli dosya {path}",
    actionsNeedApproval: "Eylem bloğu algılandı. Erişim modu Onay iste, bu yüzden hiçbir şey çalıştırılmadı.\n\n{summary}",
    actionsExecuted: "Çalıştırılan eylemler:\n\n{summary}",
    actionFailed: "Eylem başarısız: {reason}",
    commandUnknown: "Bilinmeyen komut: {command}",
    commandBlocked: "Komut engellendi: {reason}",
    mentionCommand: "Komut",
    invalidActionPath: "Geçersiz eylem yolu: {path}",
    noActions: "Geçerli eylem bulunamadı.",
    localVersionCreated: "Yerel sürüm oluşturuldu: {id} ({count} dosya)",
    localVersionNoChanges: "Yerel sürümde değişiklik yok",
    localVersionFailed: "Yerel sürüm başarısız: {reason}"
  },
  ru: {
    openCancip: "Открыть Cancip",
    commandOpenChat: "Открыть чат",
    commandNewChat: "Новый чат",
    exportSession: "Экспорт сессии",
    exportNoMessages: "Нет сообщений для экспорта",
    exportDone: "Сессия экспортирована: {path}",
    exportFailed: "Ошибка экспорта: {reason}",
    sessionHistory: "История сессий",
    sessionNoHistory: "Сохранённых сессий нет",
    sessionLoaded: "Открыта сохранённая сессия. Это только загрузка истории, а не признак завершения задачи.",
    newChatStatus: "Новый чат",
    contextAdded: "Контекст добавлен: {label}",
    indexedStatus: "Проиндексировано Markdown-файлов: {count}",
    modeAsk: "Cancip",
    modeSearch: "Поиск",
    modePlan: "План",
    modeEdit: "Правка",
    context: "контекст",
    clearContext: "Очистить контекст",
    addCurrentFile: "Добавить текущий файл",
    addMenuTitle: "Добавить контекст",
    addFileFolder: "Файл или папка",
    commandBus: "Команда",
    addPlanMode: "Режим плана",
    addPursueGoal: "Вести цель",
    pursueGoalPrompt: "Вести цель: ",
    previewVaultSearch: "Просмотр Vault Search",
    addCoreMemory: "Добавить основную память",
    localVersionCommit: "Локальный commit",
    dailyVersionStatus: "Ежедневные версии",
    stop: "Стоп",
    send: "Отправить",
    directSend: "Отправить сразу",
    queuedPrompt: "В очереди: {count}",
    queuedPromptRunning: "Отправляется сообщение из очереди. Осталось: {count}.",
    queuedCount: "Очередь {count}",
    clearQueue: "Очистить очередь",
    queueCleared: "Очередь очищена",
    directSendQueued: "Сообщение поставлено первым, текущий запрос останавливается...",
    accessMenuTitle: "Доступ",
    modelMenuTitle: "Модель",
    accessModeChanged: "Режим доступа: {mode}",
    modelChanged: "Модель: {model}",
    apiProfileChanged: "API-профиль: {profile}",
    mentionPanelTitle: "Файлы, папки, навыки, команды, функции",
    mentionNoResults: "Совпадений нет",
    mentionFile: "Файл",
    mentionFolder: "Папка",
    mentionAction: "Функция",
    mentionMode: "Режим",
    placeholder: "Cancip: @файл, резюме, найти заметки, план, правки...",
    ready: "Готово",
    missingApi: "API URL/key/model не настроены.",
    generating: "Генерация...",
    done: "Готово",
    callFailed: "Вызов не удался",
    stopped: "Остановлено",
    recentConversation: "Последний диалог",
    userQuestion: "Вопрос пользователя",
    obsidianContext: "Контекст Obsidian",
    none: "Нет",
    coreMemory: "Основная память",
    currentFile: "Текущий файл",
    noActiveFile: "Нет текущего файла",
    searchFirst: "Сначала введите поисковый вопрос",
    hitCount: "Найдено: {count}",
    emptyContext: "Нет контекста",
    settingsLanguage: "Язык",
    settingsLanguageDesc: "Авто следует языку устройства.",
    languageAuto: "Авто",
    settingsApiProfile: "API-профиль",
    settingsApiProfileName: "Имя профиля",
    addApiProfile: "Добавить профиль",
    removeApiProfile: "Удалить профиль",
    settingsAccessMode: "Режим доступа",
    accessAskApproval: "Запрашивать подтверждение",
    accessFullAccess: "Полный доступ",
    settingsApiMode: "Режим API",
    apiModeAuto: "Авто",
    settingsModel: "Модель",
    advancedSettings: "Расширенные настройки",
    settingsCoreMemoryFolder: "Папка основной памяти",
    settingsMaxContextFiles: "Макс. файлов контекста",
    settingsIncludeCurrentFile: "Включать текущий файл",
    settingsIncludeCoreMemory: "Включать основную память",
    settingsUseVaultSearch: "Vault Search по умолчанию",
    settingsSystemPrompt: "Системная инструкция",
    selectionFrom: "Выделение из {path}",
    currentFileLabel: "Текущий файл {path}",
    actionsNeedApproval: "Найден блок действий. Сейчас режим подтверждения, поэтому ничего не выполнено.\n\n{summary}",
    actionsExecuted: "Выполненные действия:\n\n{summary}",
    actionFailed: "Действие не удалось: {reason}",
    commandUnknown: "Неизвестная команда: {command}",
    commandBlocked: "Команда заблокирована: {reason}",
    mentionCommand: "Команда",
    invalidActionPath: "Недопустимый путь действия: {path}",
    noActions: "Допустимых действий нет.",
    localVersionCreated: "Локальная версия создана: {id} ({count} файлов)",
    localVersionNoChanges: "Изменений локальной версии нет",
    localVersionFailed: "Ошибка локальной версии: {reason}"
  },
  ja: {
    openCancip: "Cancip を開く",
    commandOpenChat: "チャットを開く",
    commandNewChat: "新規チャット",
    exportSession: "セッションをエクスポート",
    exportNoMessages: "エクスポートするメッセージがありません",
    exportDone: "セッションをエクスポートしました: {path}",
    exportFailed: "エクスポートに失敗しました: {reason}",
    sessionHistory: "セッション履歴",
    sessionNoHistory: "保存済みセッションはありません",
    sessionLoaded: "保存済みセッションを開きました。履歴を読み込んだだけで、タスク完了という意味ではありません。",
    newChatStatus: "新規チャット",
    contextAdded: "コンテキストを追加しました: {label}",
    indexedStatus: "{count} 個の Markdown ファイルを索引化",
    modeAsk: "Cancip",
    modeSearch: "検索",
    modePlan: "計画",
    modeEdit: "編集",
    context: "コンテキスト",
    clearContext: "コンテキストをクリア",
    addCurrentFile: "現在のファイルを追加",
    addMenuTitle: "コンテキストを追加",
    addFileFolder: "ファイルまたはフォルダ",
    commandBus: "コマンド",
    addPlanMode: "計画モード",
    addPursueGoal: "目標を追跡",
    pursueGoalPrompt: "目標を追跡: ",
    previewVaultSearch: "Vault Search をプレビュー",
    addCoreMemory: "コアメモリを追加",
    localVersionCommit: "ローカル commit",
    dailyVersionStatus: "日次バージョン",
    stop: "停止",
    send: "送信",
    accessMenuTitle: "アクセス",
    modelMenuTitle: "モデル",
    accessModeChanged: "アクセスモード: {mode}",
    modelChanged: "モデル: {model}",
    mentionPanelTitle: "ファイル、フォルダ、Skill、コマンド、機能",
    mentionNoResults: "一致する項目がありません",
    mentionFile: "ファイル",
    mentionFolder: "フォルダ",
    mentionAction: "機能",
    mentionMode: "モード",
    placeholder: "Cancip: @ファイル、要約、ノート検索、計画、編集案...",
    ready: "準備完了",
    missingApi: "API URL/key/model が未設定です。",
    generating: "生成中...",
    done: "完了",
    callFailed: "呼び出し失敗",
    stopped: "停止しました",
    recentConversation: "最近の会話",
    userQuestion: "ユーザーの質問",
    obsidianContext: "Obsidian コンテキスト",
    none: "なし",
    coreMemory: "コアメモリ",
    currentFile: "現在のファイル",
    noActiveFile: "現在のファイルなし",
    searchFirst: "先に検索内容を入力してください",
    hitCount: "{count} 件",
    emptyContext: "コンテキストなし",
    settingsLanguage: "言語",
    settingsLanguageDesc: "自動はデバイスの言語に従います。",
    languageAuto: "自動",
    settingsApiProfile: "API プロファイル",
    settingsApiProfileName: "プロファイル名",
    addApiProfile: "プロファイルを追加",
    removeApiProfile: "プロファイルを削除",
    settingsAccessMode: "アクセスモード",
    accessAskApproval: "承認を求める",
    accessFullAccess: "フルアクセス",
    settingsApiMode: "API モード",
    apiModeAuto: "自動",
    settingsModel: "モデル",
    advancedSettings: "詳細設定",
    settingsCoreMemoryFolder: "コアメモリフォルダ",
    settingsMaxContextFiles: "最大コンテキストファイル数",
    settingsIncludeCurrentFile: "現在のファイルを含める",
    settingsIncludeCoreMemory: "コアメモリを含める",
    settingsUseVaultSearch: "Vault Search を既定で使用",
    settingsSystemPrompt: "システムプロンプト",
    selectionFrom: "{path} の選択範囲",
    currentFileLabel: "現在のファイル {path}",
    actionsNeedApproval: "アクションブロックを検出しました。承認モードのため実行していません。\n\n{summary}",
    actionsExecuted: "実行済みアクション:\n\n{summary}",
    actionFailed: "アクション失敗: {reason}",
    commandUnknown: "不明なコマンド: {command}",
    commandBlocked: "コマンドはブロックされました: {reason}",
    mentionCommand: "コマンド",
    invalidActionPath: "無効なアクションパス: {path}",
    noActions: "有効なアクションがありません。",
    localVersionCreated: "ローカルバージョンを作成: {id} ({count} ファイル)",
    localVersionNoChanges: "ローカルバージョンに変更なし",
    localVersionFailed: "ローカルバージョン失敗: {reason}"
  },
  ko: {
    openCancip: "Cancip 열기",
    commandOpenChat: "채팅 열기",
    commandNewChat: "새 채팅",
    exportSession: "세션 내보내기",
    exportNoMessages: "내보낼 메시지가 없습니다",
    exportDone: "세션을 내보냈습니다: {path}",
    exportFailed: "세션 내보내기 실패: {reason}",
    sessionHistory: "세션 기록",
    sessionNoHistory: "저장된 세션 없음",
    sessionLoaded: "저장된 세션을 열었습니다. 기록을 불러온 것일 뿐, 작업 완료를 뜻하지 않습니다.",
    newChatStatus: "새 채팅",
    contextAdded: "컨텍스트 추가됨: {label}",
    indexedStatus: "{count}개 Markdown 파일 인덱싱됨",
    modeAsk: "Cancip",
    modeSearch: "검색",
    modePlan: "계획",
    modeEdit: "편집",
    context: "컨텍스트",
    clearContext: "컨텍스트 지우기",
    addCurrentFile: "현재 파일 추가",
    addMenuTitle: "컨텍스트 추가",
    addFileFolder: "파일 또는 폴더",
    commandBus: "명령",
    addPlanMode: "계획 모드",
    addPursueGoal: "목표 추적",
    pursueGoalPrompt: "목표 추적: ",
    previewVaultSearch: "Vault Search 미리보기",
    addCoreMemory: "핵심 메모리 추가",
    localVersionCommit: "로컬 commit",
    dailyVersionStatus: "일일 버전",
    stop: "중지",
    send: "보내기",
    accessMenuTitle: "접근",
    modelMenuTitle: "모델",
    accessModeChanged: "접근 모드: {mode}",
    modelChanged: "모델: {model}",
    mentionPanelTitle: "파일, 폴더, Skill, 명령, 기능",
    mentionNoResults: "일치 항목 없음",
    mentionFile: "파일",
    mentionFolder: "폴더",
    mentionAction: "기능",
    mentionMode: "모드",
    placeholder: "Cancip: @파일, 요약, 노트 찾기, 계획, 수정 제안...",
    ready: "준비됨",
    missingApi: "API URL/key/model이 설정되지 않았습니다.",
    generating: "생성 중...",
    done: "완료",
    callFailed: "호출 실패",
    stopped: "중지됨",
    recentConversation: "최근 대화",
    userQuestion: "사용자 질문",
    obsidianContext: "Obsidian 컨텍스트",
    none: "없음",
    coreMemory: "핵심 메모리",
    currentFile: "현재 파일",
    noActiveFile: "현재 파일 없음",
    searchFirst: "먼저 검색 질문을 입력하세요",
    hitCount: "{count}건",
    emptyContext: "컨텍스트 없음",
    settingsLanguage: "언어",
    settingsLanguageDesc: "자동은 기기 언어를 따릅니다.",
    languageAuto: "자동",
    settingsApiProfile: "API 프로필",
    settingsApiProfileName: "프로필 이름",
    addApiProfile: "프로필 추가",
    removeApiProfile: "프로필 제거",
    settingsAccessMode: "접근 모드",
    accessAskApproval: "승인 요청",
    accessFullAccess: "전체 접근",
    settingsApiMode: "API 모드",
    apiModeAuto: "자동",
    settingsModel: "모델",
    advancedSettings: "고급 설정",
    settingsCoreMemoryFolder: "핵심 메모리 폴더",
    settingsMaxContextFiles: "최대 컨텍스트 파일",
    settingsIncludeCurrentFile: "현재 파일 포함",
    settingsIncludeCoreMemory: "핵심 메모리 포함",
    settingsUseVaultSearch: "Vault Search 기본 사용",
    settingsSystemPrompt: "시스템 프롬프트",
    selectionFrom: "{path}의 선택 영역",
    currentFileLabel: "현재 파일 {path}",
    actionsNeedApproval: "작업 블록이 감지되었습니다. 승인 요청 모드라 실행하지 않았습니다.\n\n{summary}",
    actionsExecuted: "실행된 작업:\n\n{summary}",
    actionFailed: "작업 실패: {reason}",
    commandUnknown: "알 수 없는 명령: {command}",
    commandBlocked: "명령 차단됨: {reason}",
    mentionCommand: "명령",
    invalidActionPath: "잘못된 작업 경로: {path}",
    noActions: "유효한 작업이 없습니다.",
    localVersionCreated: "로컬 버전 생성됨: {id} ({count}개 파일)",
    localVersionNoChanges: "로컬 버전 변경 없음",
    localVersionFailed: "로컬 버전 실패: {reason}"
  },
  es: {
    openCancip: "Abrir Cancip",
    commandOpenChat: "Abrir chat",
    commandNewChat: "Nuevo chat",
    exportSession: "Exportar sesión",
    exportNoMessages: "No hay mensajes para exportar",
    exportDone: "Sesión exportada: {path}",
    exportFailed: "Error al exportar: {reason}",
    sessionHistory: "Historial de sesiones",
    sessionNoHistory: "No hay sesiones guardadas",
    sessionLoaded: "Sesión guardada abierta. Solo carga el historial; no significa que la tarea haya terminado.",
    newChatStatus: "Nuevo chat",
    contextAdded: "Contexto añadido: {label}",
    indexedStatus: "{count} archivos Markdown indexados",
    modeAsk: "Cancip",
    modeSearch: "Buscar",
    modePlan: "Plan",
    modeEdit: "Editar",
    context: "contexto",
    clearContext: "Limpiar contexto",
    addCurrentFile: "Añadir archivo actual",
    addMenuTitle: "Añadir contexto",
    addFileFolder: "Archivo o carpeta",
    commandBus: "Comando",
    addPlanMode: "Modo plan",
    addPursueGoal: "Seguir objetivo",
    pursueGoalPrompt: "Seguir objetivo: ",
    previewVaultSearch: "Vista previa de Vault Search",
    addCoreMemory: "Añadir memoria central",
    localVersionCommit: "Commit local",
    dailyVersionStatus: "Versiones diarias",
    stop: "Detener",
    send: "Enviar",
    accessMenuTitle: "Acceso",
    modelMenuTitle: "Modelo",
    accessModeChanged: "Modo de acceso: {mode}",
    modelChanged: "Modelo: {model}",
    mentionPanelTitle: "Archivos, carpetas, Skills, comandos y funciones",
    mentionNoResults: "No hay coincidencias",
    mentionFile: "Archivo",
    mentionFolder: "Carpeta",
    mentionAction: "Función",
    mentionMode: "Modo",
    placeholder: "Cancip: @archivo, resumir, buscar notas, plan, ediciones...",
    ready: "Listo",
    missingApi: "API URL/key/model no configurado.",
    generating: "Generando...",
    done: "Listo",
    callFailed: "Error de llamada",
    stopped: "Detenido",
    recentConversation: "Conversación reciente",
    userQuestion: "Pregunta del usuario",
    obsidianContext: "Contexto de Obsidian",
    none: "Ninguno",
    coreMemory: "Memoria central",
    currentFile: "Archivo actual",
    noActiveFile: "No hay archivo actual",
    searchFirst: "Escribe primero una búsqueda",
    hitCount: "{count} resultados",
    emptyContext: "Sin contexto",
    settingsLanguage: "Idioma",
    settingsLanguageDesc: "Auto sigue el idioma del dispositivo.",
    languageAuto: "Auto",
    settingsApiProfile: "Perfil API",
    settingsApiProfileName: "Nombre del perfil",
    addApiProfile: "Añadir perfil",
    removeApiProfile: "Eliminar perfil",
    settingsAccessMode: "Modo de acceso",
    accessAskApproval: "Pedir aprobación",
    accessFullAccess: "Acceso completo",
    settingsApiMode: "Modo API",
    apiModeAuto: "Auto",
    settingsModel: "Modelo",
    advancedSettings: "Ajustes avanzados",
    settingsCoreMemoryFolder: "Carpeta de memoria central",
    settingsMaxContextFiles: "Máx. archivos de contexto",
    settingsIncludeCurrentFile: "Incluir archivo actual",
    settingsIncludeCoreMemory: "Incluir memoria central",
    settingsUseVaultSearch: "Usar Vault Search por defecto",
    settingsSystemPrompt: "Prompt del sistema",
    selectionFrom: "Selección de {path}",
    currentFileLabel: "Archivo actual {path}",
    actionsNeedApproval: "Se detectó un bloque de acciones. El modo pide aprobación, así que no se ejecutó nada.\n\n{summary}",
    actionsExecuted: "Acciones ejecutadas:\n\n{summary}",
    actionFailed: "Acción fallida: {reason}",
    commandUnknown: "Comando desconocido: {command}",
    commandBlocked: "Comando bloqueado: {reason}",
    mentionCommand: "Comando",
    invalidActionPath: "Ruta de acción no válida: {path}",
    noActions: "No se encontraron acciones válidas.",
    localVersionCreated: "Versión local creada: {id} ({count} archivos)",
    localVersionNoChanges: "Sin cambios en la versión local",
    localVersionFailed: "Falló la versión local: {reason}"
  },
  fr: {
    openCancip: "Ouvrir Cancip",
    commandOpenChat: "Ouvrir le chat",
    commandNewChat: "Nouveau chat",
    exportSession: "Exporter la session",
    exportNoMessages: "Aucun message à exporter",
    exportDone: "Session exportée : {path}",
    exportFailed: "Échec de l’export : {reason}",
    sessionHistory: "Historique des sessions",
    sessionNoHistory: "Aucune session enregistrée",
    sessionLoaded: "Session enregistrée ouverte. Cela charge seulement l’historique ; la tâche n’est pas forcément terminée.",
    newChatStatus: "Nouveau chat",
    contextAdded: "Contexte ajouté : {label}",
    indexedStatus: "{count} fichiers Markdown indexés",
    modeAsk: "Cancip",
    modeSearch: "Recherche",
    modePlan: "Plan",
    modeEdit: "Éditer",
    context: "contexte",
    clearContext: "Vider le contexte",
    addCurrentFile: "Ajouter le fichier actuel",
    addMenuTitle: "Ajouter du contexte",
    addFileFolder: "Fichier ou dossier",
    commandBus: "Commande",
    addPlanMode: "Mode plan",
    addPursueGoal: "Suivre un objectif",
    pursueGoalPrompt: "Suivre l’objectif : ",
    previewVaultSearch: "Aperçu Vault Search",
    addCoreMemory: "Ajouter la mémoire centrale",
    localVersionCommit: "Commit local",
    dailyVersionStatus: "Versions quotidiennes",
    stop: "Arrêter",
    send: "Envoyer",
    accessMenuTitle: "Accès",
    modelMenuTitle: "Modèle",
    accessModeChanged: "Mode d’accès : {mode}",
    modelChanged: "Modèle : {model}",
    mentionPanelTitle: "Fichiers, dossiers, Skills, commandes, fonctions",
    mentionNoResults: "Aucune correspondance",
    mentionFile: "Fichier",
    mentionFolder: "Dossier",
    mentionAction: "Fonction",
    mentionMode: "Mode",
    placeholder: "Cancip : @fichier, résumer, trouver des notes, plan...",
    ready: "Prêt",
    missingApi: "API URL/key/model non configuré.",
    generating: "Génération...",
    done: "Terminé",
    callFailed: "Appel échoué",
    stopped: "Arrêté",
    recentConversation: "Conversation récente",
    userQuestion: "Question utilisateur",
    obsidianContext: "Contexte Obsidian",
    none: "Aucun",
    coreMemory: "Mémoire centrale",
    currentFile: "Fichier actuel",
    noActiveFile: "Aucun fichier actuel",
    searchFirst: "Saisis d’abord une recherche",
    hitCount: "{count} résultats",
    emptyContext: "Aucun contexte",
    settingsLanguage: "Langue",
    settingsLanguageDesc: "Auto suit la langue de l’appareil.",
    languageAuto: "Auto",
    settingsApiProfile: "Profil API",
    settingsApiProfileName: "Nom du profil",
    addApiProfile: "Ajouter un profil",
    removeApiProfile: "Supprimer le profil",
    settingsAccessMode: "Mode d’accès",
    accessAskApproval: "Demander approbation",
    accessFullAccess: "Accès complet",
    settingsApiMode: "Mode API",
    apiModeAuto: "Auto",
    settingsModel: "Modèle",
    advancedSettings: "Paramètres avancés",
    settingsCoreMemoryFolder: "Dossier mémoire centrale",
    settingsMaxContextFiles: "Max fichiers de contexte",
    settingsIncludeCurrentFile: "Inclure le fichier actuel",
    settingsIncludeCoreMemory: "Inclure la mémoire centrale",
    settingsUseVaultSearch: "Vault Search par défaut",
    settingsSystemPrompt: "Prompt système",
    selectionFrom: "Sélection de {path}",
    currentFileLabel: "Fichier actuel {path}",
    actionsNeedApproval: "Bloc d’action détecté. Le mode demande approbation, donc rien n’a été exécuté.\n\n{summary}",
    actionsExecuted: "Actions exécutées :\n\n{summary}",
    actionFailed: "Échec de l’action : {reason}",
    commandUnknown: "Commande inconnue : {command}",
    commandBlocked: "Commande bloquée : {reason}",
    mentionCommand: "Commande",
    invalidActionPath: "Chemin d’action invalide : {path}",
    noActions: "Aucune action valide trouvée.",
    localVersionCreated: "Version locale créée : {id} ({count} fichiers)",
    localVersionNoChanges: "Aucun changement local",
    localVersionFailed: "Échec de la version locale : {reason}"
  },
  de: {
    openCancip: "Cancip öffnen",
    commandOpenChat: "Chat öffnen",
    commandNewChat: "Neuer Chat",
    exportSession: "Sitzung exportieren",
    exportNoMessages: "Keine Nachrichten zum Exportieren",
    exportDone: "Sitzung exportiert: {path}",
    exportFailed: "Export fehlgeschlagen: {reason}",
    sessionHistory: "Sitzungsverlauf",
    sessionNoHistory: "Keine gespeicherten Sitzungen",
    sessionLoaded: "Gespeicherte Sitzung geöffnet. Das lädt nur den Verlauf und bedeutet nicht, dass die Aufgabe fertig ist.",
    newChatStatus: "Neuer Chat",
    contextAdded: "Kontext hinzugefügt: {label}",
    indexedStatus: "{count} Markdown-Dateien indexiert",
    modeAsk: "Cancip",
    modeSearch: "Suchen",
    modePlan: "Plan",
    modeEdit: "Edit",
    context: "Kontext",
    clearContext: "Kontext leeren",
    addCurrentFile: "Aktuelle Datei hinzufügen",
    addMenuTitle: "Kontext hinzufügen",
    addFileFolder: "Datei oder Ordner",
    commandBus: "Befehl",
    addPlanMode: "Planmodus",
    addPursueGoal: "Ziel verfolgen",
    pursueGoalPrompt: "Ziel verfolgen: ",
    previewVaultSearch: "Vault Search Vorschau",
    addCoreMemory: "Kernspeicher hinzufügen",
    localVersionCommit: "Lokaler Commit",
    dailyVersionStatus: "Tägliche Versionen",
    stop: "Stopp",
    send: "Senden",
    accessMenuTitle: "Zugriff",
    modelMenuTitle: "Modell",
    accessModeChanged: "Zugriffsmodus: {mode}",
    modelChanged: "Modell: {model}",
    mentionPanelTitle: "Dateien, Ordner, Skills, Befehle, Funktionen",
    mentionNoResults: "Keine Treffer",
    mentionFile: "Datei",
    mentionFolder: "Ordner",
    mentionAction: "Funktion",
    mentionMode: "Modus",
    placeholder: "Cancip: @Datei, zusammenfassen, Notizen suchen, Plan...",
    ready: "Bereit",
    missingApi: "API URL/key/model ist nicht konfiguriert.",
    generating: "Generiere...",
    done: "Fertig",
    callFailed: "Aufruf fehlgeschlagen",
    stopped: "Gestoppt",
    recentConversation: "Letzte Unterhaltung",
    userQuestion: "Nutzerfrage",
    obsidianContext: "Obsidian-Kontext",
    none: "Keiner",
    coreMemory: "Kernspeicher",
    currentFile: "Aktuelle Datei",
    noActiveFile: "Keine aktuelle Datei",
    searchFirst: "Zuerst Suchfrage eingeben",
    hitCount: "{count} Treffer",
    emptyContext: "Kein Kontext",
    settingsLanguage: "Sprache",
    settingsLanguageDesc: "Auto folgt der Gerätesprache.",
    languageAuto: "Auto",
    settingsApiProfile: "API-Profil",
    settingsApiProfileName: "Profilname",
    addApiProfile: "Profil hinzufügen",
    removeApiProfile: "Profil entfernen",
    settingsAccessMode: "Zugriffsmodus",
    accessAskApproval: "Bestätigung anfordern",
    accessFullAccess: "Vollzugriff",
    settingsApiMode: "API-Modus",
    apiModeAuto: "Auto",
    settingsModel: "Modell",
    advancedSettings: "Erweiterte Einstellungen",
    settingsCoreMemoryFolder: "Kernspeicher-Ordner",
    settingsMaxContextFiles: "Max. Kontextdateien",
    settingsIncludeCurrentFile: "Aktuelle Datei einbeziehen",
    settingsIncludeCoreMemory: "Kernspeicher einbeziehen",
    settingsUseVaultSearch: "Vault Search standardmäßig",
    settingsSystemPrompt: "Systemprompt",
    selectionFrom: "Auswahl aus {path}",
    currentFileLabel: "Aktuelle Datei {path}",
    actionsNeedApproval: "Aktionsblock erkannt. Im Bestätigungsmodus wurde nichts ausgeführt.\n\n{summary}",
    actionsExecuted: "Ausgeführte Aktionen:\n\n{summary}",
    actionFailed: "Aktion fehlgeschlagen: {reason}",
    commandUnknown: "Unbekannter Befehl: {command}",
    commandBlocked: "Befehl blockiert: {reason}",
    mentionCommand: "Befehl",
    invalidActionPath: "Ungültiger Aktionspfad: {path}",
    noActions: "Keine gültigen Aktionen gefunden.",
    localVersionCreated: "Lokale Version erstellt: {id} ({count} Dateien)",
    localVersionNoChanges: "Keine lokalen Änderungen",
    localVersionFailed: "Lokale Version fehlgeschlagen: {reason}"
  },
  ar: {
    openCancip: "فتح Cancip",
    commandOpenChat: "فتح المحادثة",
    commandNewChat: "محادثة جديدة",
    exportSession: "تصدير الجلسة",
    exportNoMessages: "لا توجد رسائل للتصدير",
    exportDone: "تم تصدير الجلسة: {path}",
    exportFailed: "فشل التصدير: {reason}",
    sessionHistory: "سجل الجلسات",
    sessionNoHistory: "لا توجد جلسات محفوظة",
    sessionLoaded: "تم فتح جلسة محفوظة. هذا يحمّل السجل فقط ولا يعني أن المهمة انتهت.",
    newChatStatus: "محادثة جديدة",
    contextAdded: "تمت إضافة السياق: {label}",
    indexedStatus: "تمت فهرسة {count} ملف Markdown",
    modeAsk: "Cancip",
    modeSearch: "بحث",
    modePlan: "خطة",
    modeEdit: "تحرير",
    context: "السياق",
    clearContext: "مسح السياق",
    addCurrentFile: "إضافة الملف الحالي",
    addMenuTitle: "إضافة سياق",
    addFileFolder: "ملف أو مجلد",
    commandBus: "أمر",
    addPlanMode: "وضع الخطة",
    addPursueGoal: "تتبع هدف",
    pursueGoalPrompt: "تتبع هدف: ",
    previewVaultSearch: "معاينة Vault Search",
    addCoreMemory: "إضافة الذاكرة الأساسية",
    localVersionCommit: "Commit محلي",
    dailyVersionStatus: "الإصدارات اليومية",
    stop: "إيقاف",
    send: "إرسال",
    accessMenuTitle: "الصلاحية",
    modelMenuTitle: "النموذج",
    accessModeChanged: "وضع الصلاحية: {mode}",
    modelChanged: "النموذج: {model}",
    mentionPanelTitle: "ملفات، مجلدات، Skills، أوامر، وظائف",
    mentionNoResults: "لا توجد نتائج مطابقة",
    mentionFile: "ملف",
    mentionFolder: "مجلد",
    mentionAction: "وظيفة",
    mentionMode: "وضع",
    placeholder: "Cancip: @ملف، تلخيص، بحث في الملاحظات، خطة...",
    ready: "جاهز",
    missingApi: "لم يتم ضبط API URL/key/model.",
    generating: "جار التوليد...",
    done: "تم",
    callFailed: "فشل الاستدعاء",
    stopped: "متوقف",
    recentConversation: "المحادثة الأخيرة",
    userQuestion: "سؤال المستخدم",
    obsidianContext: "سياق Obsidian",
    none: "لا شيء",
    coreMemory: "الذاكرة الأساسية",
    currentFile: "الملف الحالي",
    noActiveFile: "لا يوجد ملف حالي",
    searchFirst: "اكتب سؤال البحث أولاً",
    hitCount: "{count} نتائج",
    emptyContext: "لا يوجد سياق",
    settingsLanguage: "اللغة",
    settingsLanguageDesc: "تلقائي يتبع لغة الجهاز.",
    languageAuto: "تلقائي",
    settingsApiProfile: "ملف API",
    settingsApiProfileName: "اسم الملف",
    addApiProfile: "إضافة ملف",
    removeApiProfile: "إزالة الملف",
    settingsAccessMode: "وضع الصلاحية",
    accessAskApproval: "طلب الموافقة",
    accessFullAccess: "وصول كامل",
    settingsApiMode: "وضع API",
    apiModeAuto: "تلقائي",
    settingsModel: "النموذج",
    advancedSettings: "إعدادات متقدمة",
    settingsCoreMemoryFolder: "مجلد الذاكرة الأساسية",
    settingsMaxContextFiles: "أقصى ملفات سياق",
    settingsIncludeCurrentFile: "تضمين الملف الحالي",
    settingsIncludeCoreMemory: "تضمين الذاكرة الأساسية",
    settingsUseVaultSearch: "استخدام Vault Search افتراضياً",
    settingsSystemPrompt: "تعليمة النظام",
    selectionFrom: "تحديد من {path}",
    currentFileLabel: "الملف الحالي {path}",
    actionsNeedApproval: "تم اكتشاف كتلة إجراءات. الوضع يطلب الموافقة، لذلك لم يتم تنفيذ شيء.\n\n{summary}",
    actionsExecuted: "الإجراءات المنفذة:\n\n{summary}",
    actionFailed: "فشل الإجراء: {reason}",
    commandUnknown: "أمر غير معروف: {command}",
    commandBlocked: "تم حظر الأمر: {reason}",
    mentionCommand: "أمر",
    invalidActionPath: "مسار إجراء غير صالح: {path}",
    noActions: "لم يتم العثور على إجراءات صالحة.",
    localVersionCreated: "تم إنشاء إصدار محلي: {id} ({count} ملفات)",
    localVersionNoChanges: "لا توجد تغييرات محلية",
    localVersionFailed: "فشل الإصدار المحلي: {reason}"
  }
};

const SETTINGS_I18N_PATCHES: Partial<Record<Language, Partial<Record<I18nKey, string>>>> = {
  "zh-TW": {
    planReadonlyStatus: "Plan mode 已啟用",
    planReadonlyActionsBlocked: "Plan mode 已啟用。動作是否執行仍由確認/全權權限決定。\n\n{summary}",
    todoPlanMode: "Plan 層已啟用：保持計畫/待辦可見；執行權限仍由確認/全權決定。",
    modePromptPlan: "目前模式：Plan。按需維護計畫/待辦並輸出可執行計畫。Plan 不改變權限：讀寫動作是否執行或排隊確認，只由確認/全權存取模式決定。除非工具結果確認，否則不要聲稱已執行。",
    settingsAccessModeDesc: "只有這裡或 .cancip/config.json 控制執行權限；對話文字不能覆蓋權限。",
    accessPromptAsk: "存取模式：確認。可以自由讀取上下文；任何寫入類動作、刪除/移動/重新命名/合併/複製、設定變更、外部寫入、插件安裝、自動化寫入，都必須先進入 UI 確認佇列。對話文字不能覆蓋權限，只有 UI 或 .cancip/config.json 能改變權限。除非工具結果確認，否則不要聲稱已執行。",
    accessPromptFull: "存取模式：全權。使用者允許已實作的 Cancip 工具動作讀寫整個 Vault，包括 .obsidian、.cancip 等點開頭目錄、Cancip 設定和 Cancip 本身。對話文字不能縮小或擴大權限，只有 UI 或 .cancip/config.json 能改變權限。必須保護資料、保持可稽核，並報告實際改動路徑。",
    actionsNeedApproval: "寫入類動作已進入確認佇列，尚未執行。\n\n{summary}",
    preparingContext: "正在準備上下文...",
    contextBuildFailed: "上下文建立失敗：{reason}",
    contextStepSkipped: "已略過 {step}：{reason}",
    repairRunning: "正在修復基礎對話...",
    repairNoApi: "/修復 無法執行：API URL/key/model 不完整。請先在設定或 .cancip/config.json 補齊。",
    repairNoSettingChanges: "不需要修改設定",
    repairSuccess: "/修復 已完成。\n\n- 基礎 API 探測：通過（{apiMode}，{model}）\n- 基礎對話安全設定：{changes}\n- 現在預設關閉重型自動上下文；手動 @ 上下文、Search mode、Plan、命令匯流排和設定仍可使用。\n\n現在傳送 `測試`。",
    repairFailed: "/修復 失敗：{reason}"
  },
  ug: {
    planReadonlyStatus: "Plan mode قوزغىتىلدى",
    planReadonlyActionsBlocked: "Plan mode قوزغىتىلدى. ئىجرا قىلىش ھوقۇقىنى يەنىلا تەستىق/تولۇق ھوقۇق بەلگىلەيدۇ.\n\n{summary}",
    todoPlanMode: "Plan قاتلىمى قوزغىتىلدى؛ پىلان/ۋەزىپىلەر كۆرۈنىدۇ، ئىجرا ھوقۇقىنى يەنىلا تەڭشەك بەلگىلەيدۇ.",
    modePromptPlan: "ھازىرقى ھالەت: Plan. پىلان ۋە ۋەزىپىلەرنى يېڭىلا. Plan ھوقۇقنى ئۆزگەرتمەيدۇ؛ ئوقۇش/يېزىش ئىجراسىنى پەقەت تەستىق ياكى تولۇق ھوقۇق بەلگىلەيدۇ.",
    settingsAccessModeDesc: "ئىجرا ھوقۇقىنى پەقەت بۇ UI ياكى .cancip/config.json كونترول قىلىدۇ؛ سۆھبەت تېكىستى ئۆزگەرتەلمەيدۇ.",
    actionsNeedApproval: "يېزىشقا ئوخشاش ھەرىكەتلەر تەستىق نۆۋىتىگە قويۇلدى، تېخى ئىجرا قىلىنمىدى.\n\n{summary}",
    preparingContext: "كونتېكىست تەييارلىنىۋاتىدۇ...",
    contextBuildFailed: "كونتېكىست قۇرۇش مەغلۇپ بولدى: {reason}",
    contextStepSkipped: "{step} ئاتلاپ ئۆتۈلدى: {reason}",
    repairRunning: "ئاساسىي سۆھبەت تۈزىتىلىۋاتىدۇ...",
    repairNoApi: "/修复 ئىجرا بولمايدۇ: API URL/key/model تولۇق ئەمەس. ئالدى بىلەن تەڭشەكتە ياكى .cancip/config.json دا تولدۇرۇڭ.",
    repairNoSettingChanges: "تەڭشەك ئۆزگىرىشى كېرەك ئەمەس",
    repairSuccess: "/修复 تامام.\n\n- ئاساسىي API سىنىقى: OK ({apiMode}, {model})\n- بىخەتەر ئاساسىي سۆھبەت تەڭشىكى: {changes}\n- ئېغىر ئاپتوماتىك كونتېكىست ھازىر سۈكۈتتە تاقاق؛ قولدا @، Search mode، Plan، بۇيرۇق ئاپتوبۇسى ۋە تەڭشەكلەر بار.\n\nھازىر `测试` يوللاڭ.",
    repairFailed: "/修复 مەغلۇپ بولدى: {reason}",
    settingsGroupInterface: "كۆرۈنۈش",
    settingsGroupContext: "كونتېكىست",
    settingsGroupPlan: "پىلان",
    settingsGroupCommandBus: "بۇيرۇق ئاپتوبۇسى",
    settingsGroupVersioning: "يەرلىك نۇسخا",
    settingsGroupExport: "چىقىرىش",
    settingsGroupSupport: "پۇل ئېلىش QR كودى",
    settingsGroupModelAdvanced: "مودېل ئىلغار",
    settingsModelOptions: "مودېل تاللاشلىرى",
    settingsModelOptionsDesc: "ھەر قۇرغا بىر مودېل ID. مودېل تاللىغۇچ ۋە API تىزىملىكىدە ئىشلىتىلىدۇ؛ قايتا قوزغالغاندا .cancip/config.json ئۈستۈن تۇرىدۇ.",
    resetModelOptions: "مودېل تىزىملىكىنى ئەسلىگە قايتۇرۇش",
    settingsShowAttachmentButton: "قوشۇمچە كۇنۇپكىسىنى كۆرسىتىش",
    settingsCompactHeader: "قىسقا باشلىق",
    settingsAutoOpenPlanPanel: "پىلان تاختىسىنى ئاپتوماتىك ئېچىش",
    settingsShowLiveTodos: "جانلىق ۋەزىپىلەرنى كۆرسىتىش",
    settingsShowManualTodos: "قولدا ۋەزىپىلەرنى كۆرسىتىش",
    settingsCommandBusEnabled: "بۇيرۇق ئاپتوبۇسىنى قوزغىتىش",
    settingsExecuteObsidianCommands: "Obsidian بۇيرۇقلىرىنى ئىجرا قىلىشقا رۇخسەت",
    settingsGithubCommandsEnabled: "GitHub بۇيرۇق نىشانلىرىنى كۆرسىتىش",
    settingsExportMarkdownContextSnapshots: "Markdown چىقىرىشتا كونتېكىستنى ساقلاش",
    settingsExportMarkdownManualTodos: "Markdown چىقىرىشتا قولدا ۋەزىپىلەرنى ساقلاش",
    settingsMaxRecentTranscriptMessages: "يېقىنقى سۆھبەت سانى",
    settingsMaxMentionResults: "@ تاللاش نەتىجە سانى",
    settingsMaxMentionFolderFiles: "قىسقۇچتىن ئوقۇلىدىغان ھۆججەت سانى",
    settingsMaxFileContextChars: "ھۆججەت كونتېكىست ھەرپ سانى",
    settingsMaxFolderFileContextChars: "قىسقۇچ ھۆججەت كونتېكىست ھەرپ سانى",
    settingsShowSupportCodes: "ئىككى پۇل ئېلىش كودىنى كۆرسىتىش",
    settingsSupportCodeOnePath: "Alipay QR يولى",
    settingsSupportCodeTwoPath: "Binance QR يولى",
    settingsSupportCodeOneLabel: "Alipay بەلگىسى",
    settingsSupportCodeTwoLabel: "Binance بەلگىسى",
    supportCodesTitle: "پۇل ئېلىش QR كودى / Support",
    supportCodesNote: "بۇ رەسىملەر يەرلىك پلاگىن مەنبەسى؛ prompt غا قوشۇلمايدۇ.",
    supportCodeMissing: "رەسىم يولى سەپلەنمىگەن",
    commandBusDisabledPrompt: "تەڭشەكتە بۇيرۇق ئاپتوبۇسى تاقالغان؛ command ئىجراسىنى تەلەپ قىلما."
  },
  tr: {
    planReadonlyStatus: "Plan modu etkin",
    planReadonlyActionsBlocked: "Plan modu etkin. Eylemlerin çalışıp çalışmayacağını yine erişim modu belirler.\n\n{summary}",
    todoPlanMode: "Plan katmanı etkin: plan/todo görünür kalır; yürütmeyi erişim modu belirler.",
    modePromptPlan: "Geçerli mod: Plan. Planı/todo'ları güncel tut. Plan modu izinleri değiştirmez; okuma/yazma eylemleri için yürütme veya onay kuyruğunu yalnız erişim modu belirler.",
    settingsAccessModeDesc: "Yürütme iznini yalnız bu UI veya .cancip/config.json belirler; sohbet metni bunu değiştiremez.",
    actionsNeedApproval: "Yazma benzeri eylemler onay kuyruğuna alındı; henüz çalışmadı.\n\n{summary}",
    preparingContext: "Bağlam hazırlanıyor...",
    contextBuildFailed: "Bağlam oluşturulamadı: {reason}",
    contextStepSkipped: "{step} atlandı: {reason}",
    repairRunning: "Temel sohbet onarılıyor...",
    repairNoApi: "/修复 çalışamaz: API URL/key/model eksik. Önce ayarlarda veya .cancip/config.json içinde tamamlayın.",
    repairNoSettingChanges: "ayar değişikliği gerekmedi",
    repairSuccess: "/修复 tamamlandı.\n\n- Temel API denemesi: OK ({apiMode}, {model})\n- Güvenli temel sohbet ayarları: {changes}\n- Ağır otomatik bağlam artık varsayılan olarak kapalı. Manuel @ bağlamı, Search mode, Plan, komut veri yolu ve ayarlar kullanılabilir.\n\nŞimdi `测试` gönderin.",
    repairFailed: "/修复 başarısız: {reason}",
    settingsGroupInterface: "Arayüz",
    settingsGroupContext: "Bağlam",
    settingsGroupPlan: "Plan",
    settingsGroupCommandBus: "Komut veri yolu",
    settingsGroupVersioning: "Yerel sürümleme",
    settingsGroupExport: "Dışa aktarma",
    settingsGroupSupport: "Ödeme QR kodları",
    settingsGroupModelAdvanced: "Gelişmiş model",
    settingsModelOptions: "Model seçenekleri",
    settingsModelOptionsDesc: "Her satıra bir model ID. Model seçici ve API profili açılır menüsünde kullanılır; yeniden başlatmada .cancip/config.json önceliklidir.",
    resetModelOptions: "Model listesini sıfırla",
    settingsShowAttachmentButton: "Ek düğmesini göster",
    settingsCompactHeader: "Kompakt başlık",
    settingsAutoOpenPlanPanel: "Plan panelini otomatik aç",
    settingsShowLiveTodos: "Canlı yapılacakları göster",
    settingsShowManualTodos: "Manuel yapılacakları göster",
    settingsCommandBusEnabled: "Komut veri yolunu etkinleştir",
    settingsExecuteObsidianCommands: "Obsidian komutlarını çalıştırmaya izin ver",
    settingsGithubCommandsEnabled: "GitHub komut hedeflerini göster",
    settingsExportMarkdownContextSnapshots: "Markdown dışa aktarma bağlam anlık görüntülerini içerir",
    settingsExportMarkdownManualTodos: "Markdown dışa aktarma manuel yapılacakları içerir",
    settingsMaxRecentTranscriptMessages: "Son konuşma mesajları",
    settingsMaxMentionResults: "@ seçici sonuç sayısı",
    settingsMaxMentionFolderFiles: "Klasör mention dosya sayısı",
    settingsMaxFileContextChars: "Dosya bağlam karakterleri",
    settingsMaxFolderFileContextChars: "Klasör dosyası bağlam karakterleri",
    settingsShowSupportCodes: "İki ödeme QR kodunu göster",
    settingsSupportCodeOnePath: "Alipay QR yolu",
    settingsSupportCodeTwoPath: "Binance QR yolu",
    settingsSupportCodeOneLabel: "Alipay etiketi",
    settingsSupportCodeTwoLabel: "Binance etiketi",
    supportCodesTitle: "Ödeme QR kodları / Support",
    supportCodesNote: "Bu görseller yerel eklenti kaynağıdır ve prompt'a eklenmez.",
    supportCodeMissing: "Görsel yolu ayarlanmamış",
    commandBusDisabledPrompt: "Komut veri yolu ayarlarda kapalı. Komut çalıştırma isteme."
  },
  ru: {
    planReadonlyStatus: "Режим Plan включён",
    planReadonlyActionsBlocked: "Режим Plan включён. Выполнение действий всё равно определяет режим доступа.\n\n{summary}",
    todoPlanMode: "Слой Plan включён: план/задачи видны; выполнение контролирует режим доступа.",
    modePromptPlan: "Текущий режим: Plan. Поддерживай план и задачи. Plan не меняет права: выполнение чтения/записи или очередь подтверждения определяет только режим доступа.",
    settingsAccessModeDesc: "Права выполнения задаются только здесь или в .cancip/config.json; текст диалога не может их переопределить.",
    actionsNeedApproval: "Действия с записью поставлены в очередь подтверждения и ещё не выполнены.\n\n{summary}",
    preparingContext: "Подготовка контекста...",
    contextBuildFailed: "Ошибка сборки контекста: {reason}",
    contextStepSkipped: "Пропущено {step}: {reason}",
    repairRunning: "Восстановление базового чата...",
    repairNoApi: "/修复 не может выполниться: API URL/key/model заполнены не полностью. Сначала заполните настройки или .cancip/config.json.",
    repairNoSettingChanges: "изменения настроек не требуются",
    repairSuccess: "/修复 выполнено.\n\n- Базовая проверка API: OK ({apiMode}, {model})\n- Безопасные настройки базового чата: {changes}\n- Тяжёлый автоматический контекст теперь выключен по умолчанию. Ручной @ контекст, Search mode, Plan, шина команд и настройки доступны.\n\nТеперь отправьте `测试`.",
    repairFailed: "/修复 не удалось: {reason}",
    settingsGroupInterface: "Интерфейс",
    settingsGroupContext: "Контекст",
    settingsGroupPlan: "План",
    settingsGroupCommandBus: "Командная шина",
    settingsGroupVersioning: "Локальные версии",
    settingsGroupExport: "Экспорт",
    settingsGroupSupport: "Платёжные QR-коды",
    settingsGroupModelAdvanced: "Модель",
    settingsModelOptions: "Список моделей",
    settingsModelOptionsDesc: "Один ID модели на строку. Используется в выборе модели и профиле API; после перезапуска приоритет у .cancip/config.json.",
    resetModelOptions: "Сбросить список моделей",
    settingsShowAttachmentButton: "Показывать кнопку вложений",
    settingsCompactHeader: "Компактный заголовок",
    settingsAutoOpenPlanPanel: "Автооткрытие панели плана",
    settingsShowLiveTodos: "Показывать живые задачи",
    settingsShowManualTodos: "Показывать ручные задачи",
    settingsCommandBusEnabled: "Включить командную шину",
    settingsExecuteObsidianCommands: "Разрешить команды Obsidian",
    settingsGithubCommandsEnabled: "Показывать цели GitHub",
    settingsExportMarkdownContextSnapshots: "Markdown-экспорт включает снимки контекста",
    settingsExportMarkdownManualTodos: "Markdown-экспорт включает ручные задачи",
    settingsMaxRecentTranscriptMessages: "Сообщения последнего диалога",
    settingsMaxMentionResults: "Число результатов @",
    settingsMaxMentionFolderFiles: "Файлы из упомянутой папки",
    settingsMaxFileContextChars: "Символов контекста файла",
    settingsMaxFolderFileContextChars: "Символов контекста файла в папке",
    settingsShowSupportCodes: "Показывать два платёжных QR-кода",
    settingsSupportCodeOnePath: "Путь QR Alipay",
    settingsSupportCodeTwoPath: "Путь QR Binance",
    settingsSupportCodeOneLabel: "Метка Alipay",
    settingsSupportCodeTwoLabel: "Метка Binance",
    supportCodesTitle: "Платёжные QR-коды / Support",
    supportCodesNote: "Изображения являются локальными ресурсами плагина и не попадают в prompt.",
    supportCodeMissing: "Путь изображения не настроен",
    commandBusDisabledPrompt: "Командная шина отключена в настройках. Не запрашивай выполнение command."
  },
  ja: {
    planReadonlyStatus: "Plan mode は有効です",
    planReadonlyActionsBlocked: "Plan mode は有効です。アクション実行は引き続きアクセスモードで決まります。\n\n{summary}",
    todoPlanMode: "Plan レイヤー有効: 計画/Todo を表示し、実行権限はアクセスモードが制御します。",
    modePromptPlan: "現在のモード: Plan。計画/Todo を更新してください。Plan は権限を変更しません。読み書きアクションの実行または承認待ちはアクセスモードだけが決めます。",
    settingsAccessModeDesc: "実行権限はこの UI または .cancip/config.json だけが制御します。会話文では上書きできません。",
    actionsNeedApproval: "書き込み系アクションを承認キューに入れました。まだ実行していません。\n\n{summary}",
    preparingContext: "コンテキストを準備中...",
    contextBuildFailed: "コンテキスト構築に失敗しました: {reason}",
    contextStepSkipped: "{step} をスキップしました: {reason}",
    repairRunning: "基本チャットを修復中...",
    repairNoApi: "/修复 を実行できません: API URL/key/model が不完全です。設定または .cancip/config.json を先に入力してください。",
    repairNoSettingChanges: "設定変更は不要です",
    repairSuccess: "/修复 が完了しました。\n\n- 基本 API プローブ: OK ({apiMode}, {model})\n- 安全な基本チャット設定: {changes}\n- 重い自動コンテキストは既定でオフです。手動 @ コンテキスト、Search mode、Plan、コマンドバス、設定は利用できます。\n\n`测试` を送信してください。",
    repairFailed: "/修复 に失敗しました: {reason}",
    settingsGroupInterface: "インターフェース",
    settingsGroupContext: "コンテキスト",
    settingsGroupPlan: "計画",
    settingsGroupCommandBus: "コマンドバス",
    settingsGroupVersioning: "ローカルバージョン",
    settingsGroupExport: "エクスポート",
    settingsGroupSupport: "支払いQRコード",
    settingsGroupModelAdvanced: "モデル詳細",
    settingsModelOptions: "モデル候補",
    settingsModelOptionsDesc: "1行に1つのモデルID。モデル選択とAPIプロファイルのドロップダウンで使います。再起動後は .cancip/config.json が優先です。",
    resetModelOptions: "モデル一覧をリセット",
    settingsShowAttachmentButton: "添付ボタンを表示",
    settingsCompactHeader: "コンパクトヘッダー",
    settingsAutoOpenPlanPanel: "計画パネルを自動で開く",
    settingsShowLiveTodos: "ライブTodoを表示",
    settingsShowManualTodos: "手動Todoを表示",
    settingsCommandBusEnabled: "コマンドバスを有効化",
    settingsExecuteObsidianCommands: "Obsidianコマンド実行を許可",
    settingsGithubCommandsEnabled: "GitHubコマンド対象を表示",
    settingsExportMarkdownContextSnapshots: "Markdownエクスポートにコンテキストを含める",
    settingsExportMarkdownManualTodos: "Markdownエクスポートに手動Todoを含める",
    settingsMaxRecentTranscriptMessages: "最近の会話数",
    settingsMaxMentionResults: "@候補数",
    settingsMaxMentionFolderFiles: "フォルダmentionのファイル数",
    settingsMaxFileContextChars: "ファイルコンテキスト文字数",
    settingsMaxFolderFileContextChars: "フォルダ内ファイル文字数",
    settingsShowSupportCodes: "2つの支払いQRを表示",
    settingsSupportCodeOnePath: "Alipay QRパス",
    settingsSupportCodeTwoPath: "Binance QRパス",
    settingsSupportCodeOneLabel: "Alipayラベル",
    settingsSupportCodeTwoLabel: "Binanceラベル",
    supportCodesTitle: "支払いQRコード / Support",
    supportCodesNote: "画像はローカルプラグイン資源で、プロンプトには入りません。",
    supportCodeMissing: "画像パス未設定",
    commandBusDisabledPrompt: "設定でコマンドバスが無効です。command実行を要求しないでください。"
  },
  ko: {
    planReadonlyStatus: "Plan mode 활성화됨",
    planReadonlyActionsBlocked: "Plan mode가 활성화되었습니다. 작업 실행은 계속 접근 모드가 결정합니다.\n\n{summary}",
    todoPlanMode: "Plan 레이어 활성: 계획/할 일을 표시하고 실행 권한은 접근 모드가 제어합니다.",
    modePromptPlan: "현재 모드: Plan. 계획/할 일을 갱신하세요. Plan은 권한을 바꾸지 않습니다. 읽기/쓰기 작업 실행 또는 승인 대기는 접근 모드만 결정합니다.",
    settingsAccessModeDesc: "실행 권한은 이 UI 또는 .cancip/config.json만 제어합니다. 대화 텍스트로 덮어쓸 수 없습니다.",
    actionsNeedApproval: "쓰기 성격의 작업이 승인 대기열에 들어갔으며 아직 실행되지 않았습니다.\n\n{summary}",
    preparingContext: "컨텍스트 준비 중...",
    contextBuildFailed: "컨텍스트 구성 실패: {reason}",
    contextStepSkipped: "{step} 건너뜀: {reason}",
    repairRunning: "기본 채팅 복구 중...",
    repairNoApi: "/修复 실행 불가: API URL/key/model이 완전하지 않습니다. 설정 또는 .cancip/config.json을 먼저 채우세요.",
    repairNoSettingChanges: "설정 변경 필요 없음",
    repairSuccess: "/修复 완료.\n\n- 기본 API 검사: OK ({apiMode}, {model})\n- 안전한 기본 채팅 설정: {changes}\n- 무거운 자동 컨텍스트는 기본적으로 꺼졌습니다. 수동 @ 컨텍스트, Search mode, Plan, 명령 버스, 설정은 계속 사용할 수 있습니다.\n\n이제 `测试` 를 보내세요.",
    repairFailed: "/修复 실패: {reason}",
    settingsGroupInterface: "인터페이스",
    settingsGroupContext: "컨텍스트",
    settingsGroupPlan: "계획",
    settingsGroupCommandBus: "명령 버스",
    settingsGroupVersioning: "로컬 버전",
    settingsGroupExport: "내보내기",
    settingsGroupSupport: "결제 QR 코드",
    settingsGroupModelAdvanced: "고급 모델",
    settingsModelOptions: "모델 옵션",
    settingsModelOptionsDesc: "한 줄에 모델 ID 하나. 모델 선택기와 API 프로필 드롭다운에 사용되며 재시작 후 .cancip/config.json이 우선합니다.",
    resetModelOptions: "모델 목록 재설정",
    settingsShowAttachmentButton: "첨부 버튼 표시",
    settingsCompactHeader: "컴팩트 헤더",
    settingsAutoOpenPlanPanel: "계획 패널 자동 열기",
    settingsShowLiveTodos: "실시간 할 일 표시",
    settingsShowManualTodos: "수동 할 일 표시",
    settingsCommandBusEnabled: "명령 버스 활성화",
    settingsExecuteObsidianCommands: "Obsidian 명령 실행 허용",
    settingsGithubCommandsEnabled: "GitHub 명령 대상 표시",
    settingsExportMarkdownContextSnapshots: "Markdown 내보내기에 컨텍스트 포함",
    settingsExportMarkdownManualTodos: "Markdown 내보내기에 수동 할 일 포함",
    settingsMaxRecentTranscriptMessages: "최근 대화 메시지 수",
    settingsMaxMentionResults: "@ 선택 결과 수",
    settingsMaxMentionFolderFiles: "폴더 mention 파일 수",
    settingsMaxFileContextChars: "파일 컨텍스트 문자 수",
    settingsMaxFolderFileContextChars: "폴더 파일 컨텍스트 문자 수",
    settingsShowSupportCodes: "두 결제 QR 코드 표시",
    settingsSupportCodeOnePath: "Alipay QR 경로",
    settingsSupportCodeTwoPath: "Binance QR 경로",
    settingsSupportCodeOneLabel: "Alipay 라벨",
    settingsSupportCodeTwoLabel: "Binance 라벨",
    supportCodesTitle: "결제 QR 코드 / Support",
    supportCodesNote: "이미지는 로컬 플러그인 리소스이며 프롬프트에 포함되지 않습니다.",
    supportCodeMissing: "이미지 경로가 설정되지 않음",
    commandBusDisabledPrompt: "설정에서 명령 버스가 꺼져 있습니다. command 실행을 요청하지 마세요."
  },
  es: {
    planReadonlyStatus: "Plan mode está activo",
    planReadonlyActionsBlocked: "Plan mode está activo. La ejecución sigue dependiendo del modo de acceso.\n\n{summary}",
    todoPlanMode: "Capa Plan activa: mantiene plan/tareas visibles; el modo de acceso controla la ejecución.",
    modePromptPlan: "Modo actual: Plan. Mantén plan/tareas al día. Plan no cambia permisos; el modo de acceso decide si leer/escribir se ejecuta o queda en aprobación.",
    settingsAccessModeDesc: "Solo esta UI o .cancip/config.json controla el permiso de ejecución; el texto del chat no lo anula.",
    actionsNeedApproval: "Las acciones de escritura quedaron en cola de aprobación. Aún no se ejecutaron.\n\n{summary}",
    preparingContext: "Preparando contexto...",
    contextBuildFailed: "Error al crear contexto: {reason}",
    contextStepSkipped: "{step} omitido: {reason}",
    repairRunning: "Reparando chat básico...",
    repairNoApi: "/修复 no puede ejecutarse: API URL/key/model está incompleto. Complétalo en ajustes o .cancip/config.json.",
    repairNoSettingChanges: "no se necesitan cambios de ajustes",
    repairSuccess: "/修复 completado.\n\n- Prueba básica de API: OK ({apiMode}, {model})\n- Ajustes seguros de chat básico: {changes}\n- El contexto automático pesado queda desactivado por defecto. @ manual, Search mode, Plan, bus de comandos y ajustes siguen disponibles.\n\nEnvía `测试` ahora.",
    repairFailed: "/修复 falló: {reason}",
    settingsGroupInterface: "Interfaz",
    settingsGroupContext: "Contexto",
    settingsGroupPlan: "Plan",
    settingsGroupCommandBus: "Bus de comandos",
    settingsGroupVersioning: "Versionado local",
    settingsGroupExport: "Exportación",
    settingsGroupSupport: "QR de pago",
    settingsGroupModelAdvanced: "Modelo avanzado",
    settingsModelOptions: "Opciones de modelo",
    settingsModelOptionsDesc: "Un ID de modelo por línea. Se usa en el selector de modelo y el perfil API; .cancip/config.json gana al reiniciar.",
    resetModelOptions: "Restablecer modelos",
    settingsShowAttachmentButton: "Mostrar botón de adjuntos",
    settingsCompactHeader: "Encabezado compacto",
    settingsAutoOpenPlanPanel: "Abrir panel de plan automáticamente",
    settingsShowLiveTodos: "Mostrar tareas en vivo",
    settingsShowManualTodos: "Mostrar tareas manuales",
    settingsCommandBusEnabled: "Activar bus de comandos",
    settingsExecuteObsidianCommands: "Permitir comandos de Obsidian",
    settingsGithubCommandsEnabled: "Mostrar destinos GitHub",
    settingsExportMarkdownContextSnapshots: "Markdown exporta instantáneas de contexto",
    settingsExportMarkdownManualTodos: "Markdown exporta tareas manuales",
    settingsMaxRecentTranscriptMessages: "Mensajes recientes",
    settingsMaxMentionResults: "Resultados del selector @",
    settingsMaxMentionFolderFiles: "Archivos de carpeta mencionada",
    settingsMaxFileContextChars: "Caracteres de contexto de archivo",
    settingsMaxFolderFileContextChars: "Caracteres de archivo en carpeta",
    settingsShowSupportCodes: "Mostrar dos QR de pago",
    settingsSupportCodeOnePath: "Ruta QR Alipay",
    settingsSupportCodeTwoPath: "Ruta QR Binance",
    settingsSupportCodeOneLabel: "Etiqueta Alipay",
    settingsSupportCodeTwoLabel: "Etiqueta Binance",
    supportCodesTitle: "QR de pago / Support",
    supportCodesNote: "Estas imágenes son recursos locales del plugin y no entran en el prompt.",
    supportCodeMissing: "Ruta de imagen no configurada",
    commandBusDisabledPrompt: "El bus de comandos está desactivado. No solicites ejecución command."
  },
  fr: {
    planReadonlyStatus: "Plan mode actif",
    planReadonlyActionsBlocked: "Plan mode est actif. L'exécution dépend toujours du mode d'accès.\n\n{summary}",
    todoPlanMode: "Couche Plan active : plan/tâches visibles ; le mode d'accès contrôle l'exécution.",
    modePromptPlan: "Mode actuel : Plan. Maintiens le plan et les tâches. Plan ne change pas les permissions ; seul le mode d'accès décide exécution ou approbation.",
    settingsAccessModeDesc: "Seule cette UI ou .cancip/config.json contrôle les permissions ; le texte du chat ne les remplace pas.",
    actionsNeedApproval: "Les actions d'écriture sont en attente d'approbation. Rien n'a encore été exécuté.\n\n{summary}",
    preparingContext: "Préparation du contexte...",
    contextBuildFailed: "Échec de création du contexte : {reason}",
    contextStepSkipped: "{step} ignoré : {reason}",
    repairRunning: "Réparation du chat de base...",
    repairNoApi: "/修复 ne peut pas s'exécuter : API URL/key/model est incomplet. Complétez d'abord les réglages ou .cancip/config.json.",
    repairNoSettingChanges: "aucun changement de réglage nécessaire",
    repairSuccess: "/修复 terminé.\n\n- Test API de base : OK ({apiMode}, {model})\n- Réglages sûrs du chat de base : {changes}\n- Le contexte automatique lourd est désactivé par défaut. Le contexte @ manuel, Search mode, Plan, bus de commandes et réglages restent disponibles.\n\nEnvoyez maintenant `测试`.",
    repairFailed: "/修复 a échoué : {reason}",
    settingsGroupInterface: "Interface",
    settingsGroupContext: "Contexte",
    settingsGroupPlan: "Plan",
    settingsGroupCommandBus: "Bus de commandes",
    settingsGroupVersioning: "Versions locales",
    settingsGroupExport: "Export",
    settingsGroupSupport: "QR de paiement",
    settingsGroupModelAdvanced: "Modèle avancé",
    settingsModelOptions: "Options de modèle",
    settingsModelOptionsDesc: "Un ID de modèle par ligne. Utilisé par le sélecteur de modèle et le profil API ; .cancip/config.json gagne au redémarrage.",
    resetModelOptions: "Réinitialiser la liste",
    settingsShowAttachmentButton: "Afficher le bouton pièce jointe",
    settingsCompactHeader: "En-tête compact",
    settingsAutoOpenPlanPanel: "Ouvrir le panneau Plan automatiquement",
    settingsShowLiveTodos: "Afficher les tâches en direct",
    settingsShowManualTodos: "Afficher les tâches manuelles",
    settingsCommandBusEnabled: "Activer le bus de commandes",
    settingsExecuteObsidianCommands: "Autoriser les commandes Obsidian",
    settingsGithubCommandsEnabled: "Afficher les cibles GitHub",
    settingsExportMarkdownContextSnapshots: "Export Markdown avec contexte",
    settingsExportMarkdownManualTodos: "Export Markdown avec tâches manuelles",
    settingsMaxRecentTranscriptMessages: "Messages récents",
    settingsMaxMentionResults: "Résultats du sélecteur @",
    settingsMaxMentionFolderFiles: "Fichiers du dossier mentionné",
    settingsMaxFileContextChars: "Caractères de contexte fichier",
    settingsMaxFolderFileContextChars: "Caractères fichier dans dossier",
    settingsShowSupportCodes: "Afficher deux QR de paiement",
    settingsSupportCodeOnePath: "Chemin QR Alipay",
    settingsSupportCodeTwoPath: "Chemin QR Binance",
    settingsSupportCodeOneLabel: "Libellé Alipay",
    settingsSupportCodeTwoLabel: "Libellé Binance",
    supportCodesTitle: "QR de paiement / Support",
    supportCodesNote: "Ces images sont locales au plugin et ne sont pas envoyées au prompt.",
    supportCodeMissing: "Chemin d’image non configuré",
    commandBusDisabledPrompt: "Le bus de commandes est désactivé. Ne demande pas d’exécution command."
  },
  de: {
    planReadonlyStatus: "Plan mode ist aktiv",
    planReadonlyActionsBlocked: "Plan mode ist aktiv. Die Ausführung wird weiter vom Zugriffsmodus bestimmt.\n\n{summary}",
    todoPlanMode: "Plan-Ebene aktiv: Plan/Todos bleiben sichtbar; der Zugriffsmodus steuert die Ausführung.",
    modePromptPlan: "Aktueller Modus: Plan. Halte Plan/Todos aktuell. Plan ändert keine Rechte; nur der Zugriffsmodus entscheidet Ausführung oder Bestätigung.",
    settingsAccessModeDesc: "Nur diese UI oder .cancip/config.json steuert Ausführungsrechte; Chattext kann sie nicht überschreiben.",
    actionsNeedApproval: "Schreibähnliche Aktionen sind in der Bestätigungswarteschlange und wurden noch nicht ausgeführt.\n\n{summary}",
    preparingContext: "Kontext wird vorbereitet...",
    contextBuildFailed: "Kontextaufbau fehlgeschlagen: {reason}",
    contextStepSkipped: "{step} übersprungen: {reason}",
    repairRunning: "Basis-Chat wird repariert...",
    repairNoApi: "/修复 kann nicht ausgeführt werden: API URL/key/model ist unvollständig. Bitte zuerst in den Einstellungen oder .cancip/config.json ausfüllen.",
    repairNoSettingChanges: "keine Einstellungsänderungen nötig",
    repairSuccess: "/修复 abgeschlossen.\n\n- Basis-API-Test: OK ({apiMode}, {model})\n- Sichere Basis-Chat-Einstellungen: {changes}\n- Schwerer automatischer Kontext ist jetzt standardmäßig aus. Manuelles @, Search mode, Plan, Command-Bus und Einstellungen bleiben verfügbar.\n\nSenden Sie jetzt `测试`.",
    repairFailed: "/修复 fehlgeschlagen: {reason}",
    settingsGroupInterface: "Oberfläche",
    settingsGroupContext: "Kontext",
    settingsGroupPlan: "Plan",
    settingsGroupCommandBus: "Befehlsbus",
    settingsGroupVersioning: "Lokale Versionen",
    settingsGroupExport: "Export",
    settingsGroupSupport: "Zahlungs-QR-Codes",
    settingsGroupModelAdvanced: "Erweitertes Modell",
    settingsModelOptions: "Modelloptionen",
    settingsModelOptionsDesc: "Eine Modell-ID pro Zeile. Wird im Modellmenü und API-Profil verwendet; nach Neustart hat .cancip/config.json Vorrang.",
    resetModelOptions: "Modellliste zurücksetzen",
    settingsShowAttachmentButton: "Anhang-Schaltfläche anzeigen",
    settingsCompactHeader: "Kompakte Kopfzeile",
    settingsAutoOpenPlanPanel: "Plan-Panel automatisch öffnen",
    settingsShowLiveTodos: "Live-Todos anzeigen",
    settingsShowManualTodos: "Manuelle Todos anzeigen",
    settingsCommandBusEnabled: "Befehlsbus aktivieren",
    settingsExecuteObsidianCommands: "Obsidian-Befehle erlauben",
    settingsGithubCommandsEnabled: "GitHub-Ziele anzeigen",
    settingsExportMarkdownContextSnapshots: "Markdown-Export mit Kontext",
    settingsExportMarkdownManualTodos: "Markdown-Export mit manuellen Todos",
    settingsMaxRecentTranscriptMessages: "Letzte Gesprächsnachrichten",
    settingsMaxMentionResults: "@-Auswahlergebnisse",
    settingsMaxMentionFolderFiles: "Dateien aus erwähntem Ordner",
    settingsMaxFileContextChars: "Dateikontext-Zeichen",
    settingsMaxFolderFileContextChars: "Ordnerdatei-Kontextzeichen",
    settingsShowSupportCodes: "Zwei Zahlungs-QRs anzeigen",
    settingsSupportCodeOnePath: "Alipay-QR-Pfad",
    settingsSupportCodeTwoPath: "Binance-QR-Pfad",
    settingsSupportCodeOneLabel: "Alipay-Label",
    settingsSupportCodeTwoLabel: "Binance-Label",
    supportCodesTitle: "Zahlungs-QR-Codes / Support",
    supportCodesNote: "Diese Bilder sind lokale Plugin-Ressourcen und werden nicht in Prompts gesendet.",
    supportCodeMissing: "Bildpfad nicht konfiguriert",
    commandBusDisabledPrompt: "Der Befehlsbus ist deaktiviert. Keine command-Ausführung anfordern."
  },
  ar: {
    planReadonlyStatus: "وضع Plan مفعّل",
    planReadonlyActionsBlocked: "وضع Plan مفعّل. تنفيذ الإجراءات لا يزال يحدده وضع الصلاحية.\n\n{summary}",
    todoPlanMode: "طبقة Plan مفعّلة: تبقى الخطة/المهام ظاهرة، والتنفيذ يتحكم به وضع الصلاحية.",
    modePromptPlan: "الوضع الحالي: Plan. حدّث الخطة والمهام. Plan لا يغيّر الصلاحيات؛ وضع الصلاحية وحده يقرر التنفيذ أو انتظار الموافقة.",
    settingsAccessModeDesc: "الصلاحية يتحكم بها هذا الزر أو .cancip/config.json فقط؛ نص المحادثة لا يغيرها.",
    actionsNeedApproval: "إجراءات الكتابة وُضعت في انتظار الموافقة ولم تُنفذ بعد.\n\n{summary}",
    preparingContext: "جار تحضير السياق...",
    contextBuildFailed: "فشل بناء السياق: {reason}",
    contextStepSkipped: "تم تخطي {step}: {reason}",
    repairRunning: "جار إصلاح المحادثة الأساسية...",
    repairNoApi: "لا يمكن تشغيل /修复: API URL/key/model غير مكتمل. أكمله أولاً في الإعدادات أو .cancip/config.json.",
    repairNoSettingChanges: "لا حاجة لتغيير الإعدادات",
    repairSuccess: "اكتمل /修复.\n\n- اختبار API الأساسي: OK ({apiMode}, {model})\n- إعدادات المحادثة الأساسية الآمنة: {changes}\n- تم إيقاف السياق التلقائي الثقيل افتراضياً. لا يزال @ اليدوي و Search mode و Plan وناقل الأوامر والإعدادات متاحة.\n\nأرسل الآن `测试`.",
    repairFailed: "فشل /修复: {reason}",
    settingsGroupInterface: "الواجهة",
    settingsGroupContext: "السياق",
    settingsGroupPlan: "الخطة",
    settingsGroupCommandBus: "ناقل الأوامر",
    settingsGroupVersioning: "الإصدارات المحلية",
    settingsGroupExport: "التصدير",
    settingsGroupSupport: "رموز QR للدفع",
    settingsGroupModelAdvanced: "النموذج المتقدم",
    settingsModelOptions: "خيارات النموذج",
    settingsModelOptionsDesc: "معرّف نموذج واحد في كل سطر. يُستخدم في قائمة النموذج وملف API؛ بعد إعادة التشغيل تكون الأولوية لـ .cancip/config.json.",
    resetModelOptions: "إعادة ضبط قائمة النماذج",
    settingsShowAttachmentButton: "إظهار زر المرفقات",
    settingsCompactHeader: "رأس مضغوط",
    settingsAutoOpenPlanPanel: "فتح لوحة الخطة تلقائياً",
    settingsShowLiveTodos: "إظهار المهام الحية",
    settingsShowManualTodos: "إظهار المهام اليدوية",
    settingsCommandBusEnabled: "تفعيل ناقل الأوامر",
    settingsExecuteObsidianCommands: "السماح بأوامر Obsidian",
    settingsGithubCommandsEnabled: "إظهار أهداف GitHub",
    settingsExportMarkdownContextSnapshots: "تصدير Markdown يتضمن السياق",
    settingsExportMarkdownManualTodos: "تصدير Markdown يتضمن المهام اليدوية",
    settingsMaxRecentTranscriptMessages: "رسائل المحادثة الأخيرة",
    settingsMaxMentionResults: "عدد نتائج @",
    settingsMaxMentionFolderFiles: "ملفات المجلد المذكور",
    settingsMaxFileContextChars: "أحرف سياق الملف",
    settingsMaxFolderFileContextChars: "أحرف سياق ملف المجلد",
    settingsShowSupportCodes: "إظهار رمزي الدفع",
    settingsSupportCodeOnePath: "مسار QR Alipay",
    settingsSupportCodeTwoPath: "مسار QR Binance",
    settingsSupportCodeOneLabel: "تسمية Alipay",
    settingsSupportCodeTwoLabel: "تسمية Binance",
    supportCodesTitle: "رموز QR للدفع / Support",
    supportCodesNote: "هذه الصور موارد محلية للإضافة ولا تدخل في prompt.",
    supportCodeMissing: "مسار الصورة غير مضبوط",
    commandBusDisabledPrompt: "ناقل الأوامر مغلق في الإعدادات. لا تطلب تنفيذ command."
  }
};

for (const [language, patch] of Object.entries(SETTINGS_I18N_PATCHES) as [Language, Partial<Record<I18nKey, string>>][]) {
  Object.assign(I18N[language], patch);
}

export default class CancipPlugin extends Plugin {
  settings: Settings = DEFAULT_SETTINGS;
  private dailyVersionRunning = false;
  private automationRunningIds = new Set<string>();

  async onload(): Promise<void> {
    await this.loadSettings();
    await this.ensureVisibleDataFolders();
    await recordCancipSessionEvent(this.app.vault.adapter, {
      kind: "plugin.load",
      detail: "Cancip plugin loaded",
      pluginVersion: this.manifest.version,
      model: this.activeApiProfile().model
    });

    this.registerView(VIEW_TYPE, (leaf) => new CancipView(leaf, this));

    this.addRibbonIcon("bot", this.t("openCancip"), () => {
      void this.activateView();
    });

    this.addCommand({
      id: "open-chat",
      name: `Cancip: ${this.t("commandOpenChat")}`,
      callback: () => {
        void this.activateView();
      }
    });

    this.addCommand({
      id: "new-chat",
      name: `Cancip: ${this.t("commandNewChat")}`,
      callback: async () => {
        const view = await this.activateView();
        void view?.newChat();
      }
    });

    this.addCommand({
      id: "add-selection-to-chat",
      name: `Cancip: ${this.t("commandAddSelection")}`,
      editorCallback: async (editor: Editor, view: MarkdownView) => {
        const selected = editor.getSelection();
        const file = view.file;
        if (!selected.trim() || !file) {
          new Notice(this.t("noSelection"));
          return;
        }
        const chatView = await this.activateView();
        chatView?.addDraftContext(this.t("selectionFrom", { path: file.path }), selected, file.path, "file");
      }
    });

    this.addCommand({
      id: "rebuild-light-index",
      name: `Cancip: ${this.t("commandRebuildIndex")}`,
      callback: async () => {
        const view = await this.activateView();
        await view?.refreshVaultIndex(true);
      }
    });

    this.addCommand({
      id: "create-local-version-commit",
      name: `Cancip: ${this.t("commandLocalVersionCommit")}`,
      callback: async () => {
        try {
          const result = await this.createLocalVersionCommit("manual", "manual snapshot");
          new Notice(this.describeLocalVersionResult(result));
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          new Notice(this.t("localVersionFailed", { reason }));
        }
      }
    });

    this.addCommand({
      id: "import-codex-core-memory",
      name: `Cancip: ${this.t("importCodexMemory")}`,
      callback: async () => {
        try {
          const result = await this.importCodexCoreMemory(true);
          new Notice(this.t("codexMemoryImported", { count: result.count, path: result.folder }));
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          console.warn("Cancip Codex memory import failed", error);
          new Notice(this.t("codexMemoryImportFailed", { reason }));
        }
      }
    });

    this.addCommand({
      id: "debug-layout",
      name: "Cancip: Debug layout",
      callback: async () => {
        const view = await this.activateView();
        view?.debugLayout();
      }
    });

    this.addSettingTab(new CancipSettingTab(this.app, this));
    await this.pruneLocalVersionIndex();
    await this.reconcileStaleRunningSessions();
    await this.migrateCodexMemoryFolder();
    this.scheduleCodexMemoryAutoImport();
    this.scheduleDailyLocalVersioning();
    this.scheduleAutomations();
  }

  onunload(): void {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
  }

  async loadSettings(): Promise<void> {
    const saved = (await this.loadData()) as Partial<Settings> | null;
    let nextSettings = normalizeSettings(saved ?? {});
    if (!saved?.systemPrompt || saved.systemPrompt === LEGACY_SYSTEM_PROMPT) {
      nextSettings.systemPrompt = DEFAULT_SYSTEM_PROMPT;
    }

    const configSettings = await this.loadCancipConfig();
    if (configSettings) {
      const combined: Partial<Settings> = { ...nextSettings, ...configSettings };
      if (!configSettings.apiProfiles && hasLegacyApiProfileFields(configSettings)) {
        delete combined.apiProfiles;
        delete combined.activeApiProfileId;
      }
      nextSettings = normalizeSettings(combined);
    }

    if (!nextSettings.systemPrompt || nextSettings.systemPrompt === LEGACY_SYSTEM_PROMPT || isOutdatedSystemPrompt(nextSettings.systemPrompt)) {
      nextSettings.systemPrompt = DEFAULT_SYSTEM_PROMPT;
    }
    nextSettings = migrateVisibleFolderDefaults(nextSettings);
    nextSettings = migrateDefaultMemorySearchPolicy(nextSettings);

    this.settings = nextSettings;
    await this.saveData(this.settings);
    await this.writeCancipConfig();
  }

  private async loadCancipConfig(): Promise<Partial<Settings> | null> {
    try {
      if (!(await this.app.vault.adapter.exists(CANCIP_CONFIG_PATH))) return null;
      const raw = await this.app.vault.adapter.read(CANCIP_CONFIG_PATH);
      return parseCancipConfig(JSON.parse(raw));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn("Cancip config read failed", error);
      new Notice(this.t("configReadFailed", { reason }));
      return null;
    }
  }

  private async writeCancipConfig(): Promise<void> {
    try {
      const adapter = this.app.vault.adapter;
      if (!(await adapter.exists(CANCIP_CONFIG_DIR))) {
        await adapter.mkdir(CANCIP_CONFIG_DIR);
      }
      await adapter.write(CANCIP_CONFIG_PATH, `${JSON.stringify(settingsToCancipConfig(this.settings), null, 2)}\n`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn("Cancip config write failed", error);
      new Notice(this.t("configWriteFailed", { reason }));
    }
  }

  private async ensureVisibleDataFolders(): Promise<void> {
    try {
      const adapter = this.app.vault.adapter;
      await ensureFolder(adapter, SESSION_EXPORT_DIR);
      await ensureFolder(adapter, SESSION_HISTORY_DIR);
      await ensureFolder(adapter, AUTOMATION_DIR);
      await ensureFolder(adapter, REVIEW_GATE_DIR);
      await ensureFolder(adapter, REVIEW_GATE_HIDDEN_DIR);
      if (this.settings.memoryFolder.trim()) {
        await ensureFolder(adapter, this.settings.memoryFolder.trim());
      }
    } catch (error) {
      console.warn("Cancip visible data folder setup failed", error);
    }
  }

  async saveSettings(): Promise<void> {
    this.settings = normalizeSettings(this.settings);
    if (!this.settings.systemPrompt || this.settings.systemPrompt === LEGACY_SYSTEM_PROMPT || isOutdatedSystemPrompt(this.settings.systemPrompt)) {
      this.settings.systemPrompt = DEFAULT_SYSTEM_PROMPT;
    }
    await this.saveData(this.settings);
    await this.writeCancipConfig();
  }

  activeApiProfile(): ApiProfile {
    return getActiveApiProfile(this.settings);
  }

  async selectApiProfile(id: string): Promise<void> {
    if (!this.settings.apiProfiles.some((profile) => profile.id === id)) return;
    this.settings.activeApiProfileId = id;
    await this.saveSettings();
  }

  async buildReviewGate(args: Record<string, unknown> = {}): Promise<ReviewGateBuildResult> {
    const result = await buildObReviewGatePackage(this.app.vault.adapter, {
      title: typeof args.title === "string" ? args.title : undefined,
      vaultLabel: typeof args.vault_label === "string" ? args.vault_label : typeof args.vaultLabel === "string" ? args.vaultLabel : undefined,
      outputRoot: typeof args.hidden === "boolean" && args.hidden ? REVIEW_GATE_HIDDEN_DIR : REVIEW_GATE_DIR,
      output: typeof args.output === "string" ? args.output : undefined,
      paths: args.paths,
      scope: args.scope,
      items: args.items,
      maxFiles: clampInt(args.maxFiles, REVIEW_GATE_MAX_FILES, 1, 500),
      maxFileChars: clampInt(args.maxFileChars, REVIEW_GATE_MAX_FILE_CHARS, 1000, 1000000)
    });
    return result;
  }

  async listReviewGates(limit = 12): Promise<string[]> {
    return listReviewGatePackages(this.app.vault.adapter, REVIEW_GATE_DIR, limit);
  }

  async updateActiveApiProfile(patch: Partial<ApiProfile>): Promise<void> {
    const active = this.activeApiProfile();
    this.settings.apiProfiles = this.settings.apiProfiles.map((profile) =>
      profile.id === active.id ? normalizeApiProfile({ ...profile, ...patch }, profile) : profile
    );
    this.settings.activeApiProfileId = active.id;
    await this.saveSettings();
  }

  async addApiProfile(): Promise<ApiProfile> {
    const id = `profile-${Date.now().toString(36)}`;
    const profile = normalizeApiProfile(
      {
        id,
        name: `${this.t("settingsApiProfile")} ${this.settings.apiProfiles.length + 1}`,
        apiUrl: this.settings.apiUrl || DEFAULT_SETTINGS.apiUrl,
        apiKey: "",
        apiMode: this.settings.apiMode || DEFAULT_SETTINGS.apiMode,
        model: this.settings.model || DEFAULT_SETTINGS.model
      },
      getDefaultApiProfile()
    );
    this.settings.apiProfiles = [...this.settings.apiProfiles, profile];
    this.settings.activeApiProfileId = profile.id;
    await this.saveSettings();
    return profile;
  }

  async removeActiveApiProfile(): Promise<void> {
    if (this.settings.apiProfiles.length <= 1) return;
    const active = this.activeApiProfile();
    const remaining = this.settings.apiProfiles.filter((profile) => profile.id !== active.id);
    this.settings.apiProfiles = remaining.length ? remaining : [getDefaultApiProfile()];
    this.settings.activeApiProfileId = this.settings.apiProfiles[0].id;
    await this.saveSettings();
  }

  private scheduleDailyLocalVersioning(): void {
    const firstRun = window.setTimeout(() => {
      void this.maybeRunDailyLocalVersion();
    }, 15000);
    this.register(() => window.clearTimeout(firstRun));
    this.registerInterval(
      window.setInterval(() => {
        void this.maybeRunDailyLocalVersion();
      }, 60 * 60 * 1000)
    );
  }

  private async maybeRunDailyLocalVersion(): Promise<void> {
    if (!this.settings.dailyLocalVersioning || this.dailyVersionRunning) return;
    const now = new Date();
    if (now.getHours() < this.settings.localVersionHour) return;
    const index = await this.loadLocalVersionIndex();
    const today = localDateKey(now);
    if (index.lastDailyDate === today) return;

    this.dailyVersionRunning = true;
    try {
      const result = await this.createLocalVersionCommit("daily", `daily snapshot ${today}`, index);
      if (result.status === "created") {
        new Notice(this.describeLocalVersionResult(result));
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn("Cancip daily local version failed", error);
      new Notice(this.t("localVersionFailed", { reason }));
    } finally {
      this.dailyVersionRunning = false;
    }
  }

  async createLocalVersionCommit(kind: LocalVersionKind, message: string, existingIndex?: LocalVersionIndex): Promise<LocalVersionResult> {
    const index = existingIndex ?? (await this.loadLocalVersionIndex());
    const files = this.app.vault
      .getFiles()
      .filter((file) => isLocalVersionCandidate(file, this.settings.localVersionMaxFileBytes))
      .sort((a, b) => a.path.localeCompare(b.path));
    const scannedCount = files.length;
    const currentHashes: Record<string, string> = {};
    const changed: Array<{ file: TFile; content: string; hash: string }> = [];
    const hasBaseline = Object.keys(index.latestHashes).length > 0;

    for (const file of files) {
      const content = await this.app.vault.cachedRead(file);
      const hash = await sha256Text(content);
      currentHashes[file.path] = hash;
      if (index.latestHashes[file.path] !== hash) {
        changed.push({ file, content, hash });
      }
    }

    index.latestHashes = currentHashes;
    if (kind === "daily") index.lastDailyDate = localDateKey(new Date());

    if (kind === "daily" && !hasBaseline) {
      await this.saveLocalVersionIndex(index);
      return { status: "baseline", scannedCount, changedCount: changed.length };
    }

    if (!changed.length) {
      await this.saveLocalVersionIndex(index);
      return { status: "no-changes", scannedCount, changedCount: 0 };
    }

    const createdAt = new Date().toISOString();
    const id = localVersionCommitId(createdAt);
    const commitDir = `${LOCAL_VERSION_DIR}/commits/${id}`;
    const filesDir = `${commitDir}/files`;
    await ensureFolder(this.app.vault.adapter, filesDir);

    const committedFiles: LocalVersionFile[] = [];
    for (const item of changed) {
      const snapshotPath = `${filesDir}/${snapshotFileName(item.file.path)}`;
      await this.app.vault.adapter.write(snapshotPath, item.content);
      committedFiles.push({
        path: item.file.path,
        size: item.file.stat.size,
        mtime: item.file.stat.mtime,
        hash: item.hash,
        snapshotPath
      });
    }

    const commit: LocalVersionCommit = {
      id,
      kind,
      message,
      createdAt,
      scannedCount,
      fileCount: committedFiles.length,
      files: committedFiles
    };
    await this.app.vault.adapter.write(`${commitDir}/commit.json`, `${JSON.stringify(commit, null, 2)}\n`);
    const summary = {
      id: commit.id,
      kind: commit.kind,
      message: commit.message,
      createdAt: commit.createdAt,
      scannedCount: commit.scannedCount,
      fileCount: commit.fileCount
    };
    index.commits = [summary, ...index.commits].slice(0, 200);
    await this.saveLocalVersionIndex(index);
    return { status: "created", commit, scannedCount, changedCount: changed.length };
  }

  private async loadLocalVersionIndex(): Promise<LocalVersionIndex> {
    try {
      if (!(await this.app.vault.adapter.exists(LOCAL_VERSION_INDEX_PATH))) return emptyLocalVersionIndex();
      const raw = await this.app.vault.adapter.read(LOCAL_VERSION_INDEX_PATH);
      return normalizeLocalVersionIndex(JSON.parse(raw));
    } catch (error) {
      console.warn("Cancip local version index read failed", error);
      return emptyLocalVersionIndex();
    }
  }

  private async saveLocalVersionIndex(index: LocalVersionIndex): Promise<void> {
    await ensureFolder(this.app.vault.adapter, LOCAL_VERSION_DIR);
    await this.app.vault.adapter.write(LOCAL_VERSION_INDEX_PATH, `${JSON.stringify(index, null, 2)}\n`);
  }

  private async pruneLocalVersionIndex(): Promise<void> {
    try {
      if (!(await this.app.vault.adapter.exists(LOCAL_VERSION_INDEX_PATH))) return;
      const raw = await this.app.vault.adapter.read(LOCAL_VERSION_INDEX_PATH);
      const normalized = normalizeLocalVersionIndex(JSON.parse(raw));
      const nextRaw = `${JSON.stringify(normalized, null, 2)}\n`;
      if (nextRaw !== raw) {
        await this.saveLocalVersionIndex(normalized);
      }
    } catch (error) {
      console.warn("Cancip local version index prune failed", error);
    }
  }

  private async reconcileStaleRunningSessions(): Promise<void> {
    try {
      const entries = await this.readSessionHistoryIndexForPlugin();
      let changed = false;
      const now = Date.now();
      const next: SessionHistoryEntry[] = [];
      for (const entry of entries) {
        if (entry.status !== "running") {
          next.push(entry);
          continue;
        }
        const updated = Date.parse(entry.updatedAt);
        if (Number.isFinite(updated) && now - updated < 5 * 60 * 1000) {
          next.push(entry);
          continue;
        }
        const repaired = await this.repairStaleRunningSession(entry, now);
        changed = changed || repaired.changed;
        next.push(repaired.entry);
      }
      if (changed) await this.writeSessionHistoryIndexForPlugin(next);
    } catch (error) {
      console.warn("Cancip stale running session reconciliation failed", error);
    }
  }

  private async repairStaleRunningSession(entry: SessionHistoryEntry, now: number): Promise<StaleSessionRepair> {
    const adapter = this.app.vault.adapter;
    const updatedAt = new Date(now).toISOString();
    const fallback: SessionHistoryEntry = {
      ...entry,
      updatedAt,
      status: "failed",
      completedNotice: true
    };
    if (!(await adapter.exists(entry.path))) {
      await recordCancipSessionEvent(adapter, {
        kind: "session.status",
        sessionId: entry.id,
        title: entry.title,
        status: "failed",
        detail: "stale running session closed; session file missing",
        messageCount: entry.messageCount,
        mode: entry.mode,
        model: entry.model,
        pluginVersion: this.manifest.version
      });
      return { entry: fallback, changed: true };
    }

    try {
      const raw = await adapter.read(entry.path);
      const snapshot = JSON.parse(raw) as Record<string, unknown>;
      const messages = Array.isArray(snapshot.messages) ? snapshot.messages.filter(isRecord) : [];
      const decision = classifyStaleRunningMessages(messages);
      const nextMessages = decision.needsClosure
        ? [
            ...messages,
            {
              id: crypto.randomUUID(),
              role: "assistant",
              createdAt: updatedAt,
              content: decision.content
            }
          ]
        : messages;
      snapshot.messages = nextMessages;
      snapshot.status = decision.status;
      snapshot.completedNotice = true;
      snapshot.updatedAt = updatedAt;
      await adapter.write(entry.path, `${JSON.stringify(snapshot, null, 2)}\n`);
      await recordCancipSessionEvent(adapter, {
        kind: "session.status",
        sessionId: entry.id,
        title: entry.title,
        status: decision.status,
        detail: decision.detail,
        messageCount: nextMessages.length,
        mode: entry.mode,
        model: entry.model,
        pluginVersion: this.manifest.version
      });
      return {
        entry: {
          ...entry,
          updatedAt,
          messageCount: nextMessages.length,
          status: decision.status,
          completedNotice: true
        },
        changed: true
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await recordCancipSessionEvent(adapter, {
        kind: "session.status",
        sessionId: entry.id,
        title: entry.title,
        status: "failed",
        detail: `stale running session repair failed: ${reason}`,
        messageCount: entry.messageCount,
        mode: entry.mode,
        model: entry.model,
        pluginVersion: this.manifest.version
      });
      return { entry: fallback, changed: true };
    }
  }

  private async readSessionHistoryIndexForPlugin(): Promise<SessionHistoryEntry[]> {
    try {
      const adapter = this.app.vault.adapter;
      if (!(await adapter.exists(SESSION_HISTORY_INDEX_PATH))) return [];
      const raw = await adapter.read(SESSION_HISTORY_INDEX_PATH);
      const parsed = JSON.parse(raw) as unknown;
      if (!isRecord(parsed) || !Array.isArray(parsed.entries)) return [];
      return parsed.entries
        .filter(isRecord)
        .map((item): SessionHistoryEntry | null => {
          const id = typeof item.id === "string" ? item.id : "";
          const path = typeof item.path === "string" ? item.path : "";
          if (!id || !path) return null;
          return {
            id,
            title: typeof item.title === "string" ? item.title : id,
            createdAt: typeof item.createdAt === "string" ? item.createdAt : "",
            updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : "",
            messageCount: typeof item.messageCount === "number" ? item.messageCount : 0,
            mode: isComposerMode(item.mode) ? item.mode : "ask",
            model: typeof item.model === "string" ? item.model : "",
            status: isSessionStatus(item.status) ? item.status : "idle",
            completedNotice: typeof item.completedNotice === "boolean" ? item.completedNotice : false,
            path
          };
        })
        .filter((item): item is SessionHistoryEntry => item !== null);
    } catch {
      return [];
    }
  }

  private async writeSessionHistoryIndexForPlugin(entries: SessionHistoryEntry[]): Promise<void> {
    await ensureFolder(this.app.vault.adapter, SESSION_HISTORY_DIR);
    const payload = {
      schemaVersion: SESSION_HISTORY_SCHEMA_VERSION,
      entries: entries.slice(0, SESSION_HISTORY_LIMIT)
    };
    await this.app.vault.adapter.write(SESSION_HISTORY_INDEX_PATH, `${JSON.stringify(payload, null, 2)}\n`);
  }

  describeLocalVersionResult(result: LocalVersionResult): string {
    if (result.status === "created" && result.commit) {
      return this.t("localVersionCreated", { id: result.commit.id, count: result.commit.fileCount });
    }
    if (result.status === "baseline") return this.t("localVersionBaseline", { count: result.scannedCount });
    return this.t("localVersionNoChanges");
  }

  private scheduleCodexMemoryAutoImport(): void {
    const timer = window.setTimeout(() => {
      if (!this.settings.codexMemoryAutoImport) return;
      void this.importCodexCoreMemory(false).catch((error) => {
        console.warn("Cancip Codex memory auto-import skipped", error);
      });
    }, 20000);
    this.register(() => window.clearTimeout(timer));
  }

  async importCodexCoreMemory(showErrors: boolean): Promise<{ count: number; folder: string }> {
    const fs = getNodeFs();
    if (!fs) {
      if (showErrors) throw new Error(this.t("codexMemoryImportSkipped"));
      return { count: 0, folder: this.codexMemoryFolder() };
    }

    const sourceDir = normalizeExternalPath(this.settings.codexMemoryImportPath || DEFAULT_CODEX_MEMORY_IMPORT_PATH);
    if (!fs.existsSync(sourceDir)) {
      if (showErrors) throw new Error(`${this.t("codexMemoryImportSkipped")}: ${sourceDir}`);
      return { count: 0, folder: this.codexMemoryFolder() };
    }

    const adapter = this.app.vault.adapter;
    const targetFolder = this.codexMemoryFolder();
    await ensureFolder(adapter, targetFolder);

    const imported: string[] = [];
    for (const fileName of CODEX_CORE_MEMORY_FILES) {
      const sourcePath = `${sourceDir}/${fileName}`;
      if (!fs.existsSync(sourcePath)) continue;
      const raw = fs.readFileSync(sourcePath, "utf8");
      const safe = sanitizeImportedMemory(raw);
      const header = [
        "---",
        `source: codex-memory`,
        `source_file: ${fileName}`,
        `imported_at: ${new Date().toISOString()}`,
        "---",
        "",
        `# ${fileName.replace(/\.md$/i, "")}`,
        ""
      ].join("\n");
      const targetPath = `${targetFolder}/${safeVaultFileName(fileName)}`;
      await adapter.write(targetPath, `${header}${safe.trim()}\n`);
      imported.push(targetPath);
    }

    const indexPath = `${targetFolder}/README.md`;
    const index = [
      "# Cancip Long-Term Memory",
      "",
      `Imported: ${new Date().toISOString()}`,
      `Source: ${sourceDir}`,
      "",
      "This folder is visible to Cancip and can be synced to mobile. It is the default long-term memory included in every interaction. If memory is not enough, Cancip should decide whether to search the vault, then the web if needed.",
      "",
      ...imported.map((path) => `- [[${path.replace(/\.md$/i, "")}]]`)
    ].join("\n");
    await adapter.write(indexPath, `${index}\n`);
    return { count: imported.length, folder: targetFolder };
  }

  private async migrateCodexMemoryFolder(): Promise<void> {
    try {
      const adapter = this.app.vault.adapter;
      const base = this.codexMemoryFolder();
      const oldFolder = `${base}/Codex`;
      if (!(await adapter.exists(oldFolder))) return;
      await ensureFolder(adapter, base);
      for (const fileName of [...CODEX_CORE_MEMORY_FILES, "README.md"]) {
        const oldPath = `${oldFolder}/${fileName}`;
        const newPath = `${base}/${fileName}`;
        if (!(await adapter.exists(oldPath))) continue;
        const content = await adapter.read(oldPath);
        await adapter.write(newPath, content);
      }
    } catch (error) {
      console.warn("Cancip Codex memory folder migration skipped", error);
    }
  }

  codexMemoryFolder(): string {
    return normalizePath(this.settings.memoryFolder || DEFAULT_MEMORY_FOLDER);
  }

  private scheduleAutomations(): void {
    const firstRun = window.setTimeout(() => {
      void this.maybeRunDueAutomations();
    }, 30000);
    this.register(() => window.clearTimeout(firstRun));
    this.registerInterval(
      window.setInterval(() => {
        void this.maybeRunDueAutomations();
      }, Math.max(1, this.settings.automationCheckMinutes) * 60 * 1000)
    );
  }

  async maybeRunDueAutomations(): Promise<void> {
    if (!this.settings.automationsEnabled) return;
    const tasks = await this.loadAutomations();
    const now = new Date();
    for (const task of tasks) {
      if (!isAutomationDue(task, now)) continue;
      if (this.automationRunningIds.has(task.id)) continue;
      try {
        await this.runAutomationById(task.id);
      } catch (error) {
        console.warn("Cancip automation failed", task.id, error);
      }
    }
  }

  async loadAutomations(): Promise<AutomationTask[]> {
    try {
      const adapter = this.app.vault.adapter;
      if (!(await adapter.exists(AUTOMATION_STATE_PATH))) return [];
      const raw = await adapter.read(AUTOMATION_STATE_PATH);
      const parsed = JSON.parse(raw) as unknown;
      if (!isRecord(parsed) || !Array.isArray(parsed.tasks)) return [];
      return parsed.tasks.map(normalizeAutomationTask).filter((task): task is AutomationTask => task !== null);
    } catch (error) {
      console.warn("Cancip automation state read failed", error);
      return [];
    }
  }

  async saveAutomations(tasks: AutomationTask[]): Promise<void> {
    await ensureFolder(this.app.vault.adapter, CANCIP_CONFIG_DIR);
    const payload = {
      schemaVersion: AUTOMATION_SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
      tasks
    };
    await this.app.vault.adapter.write(AUTOMATION_STATE_PATH, `${JSON.stringify(payload, null, 2)}\n`);
  }

  async upsertAutomationFromAction(action: AutomationAction): Promise<AutomationTask> {
    const tasks = await this.loadAutomations();
    const now = new Date().toISOString();
    const existing = action.id ? tasks.find((task) => task.id === action.id) : undefined;
    if (!existing && action.op === "update") throw new Error(this.t("automationNotFound", { id: action.id ?? "" }));

    const fallbackTitle = existing?.title ?? action.title?.trim() ?? this.t("automationTask");
    const fallbackPrompt = existing?.prompt ?? action.prompt?.trim() ?? "";
    const fallbackCommand = existing?.command ?? action.command?.trim() ?? "";
    if (!fallbackPrompt && !fallbackCommand) throw new Error("automation requires prompt or command");

    const normalizedTask = normalizeAutomationTask({
      ...(existing ?? {}),
      id: existing?.id ?? action.id?.trim() ?? `auto-${Date.now().toString(36)}`,
      title: action.title?.trim() || fallbackTitle,
      prompt: action.prompt?.trim() || fallbackPrompt,
      command: action.command?.trim() || fallbackCommand || undefined,
      args: isRecord(action.args) ? action.args : existing?.args,
      schedule: isAutomationSchedule(action.schedule) ? action.schedule : existing?.schedule ?? "manual",
      enabled: typeof action.enabled === "boolean" ? action.enabled : existing?.enabled ?? true,
      intervalMinutes: typeof action.intervalMinutes === "number" ? action.intervalMinutes : existing?.intervalMinutes ?? 60,
      hour: typeof action.hour === "number" ? action.hour : existing?.hour ?? 9,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      lastRunAt: existing?.lastRunAt,
      lastStatus: existing?.lastStatus,
      lastResult: existing?.lastResult,
      lastResultPath: existing?.lastResultPath
    });
    if (!normalizedTask) throw new Error("invalid automation");
    const task: AutomationTask = normalizedTask;

    const next = [task, ...tasks.filter((item) => item.id !== task.id)].sort((a, b) => a.title.localeCompare(b.title));
    await this.saveAutomations(next);
    return task;
  }

  async removeAutomation(id: string): Promise<boolean> {
    const tasks = await this.loadAutomations();
    const next = tasks.filter((task) => task.id !== id);
    await this.saveAutomations(next);
    return next.length !== tasks.length;
  }

  async runAutomationById(id: string): Promise<AutomationRunResult> {
    const tasks = await this.loadAutomations();
    const task = tasks.find((item) => item.id === id);
    if (!task) throw new Error(this.t("automationNotFound", { id }));
    if (this.automationRunningIds.has(task.id)) throw new Error(this.t("todoRequestRunning"));
    this.automationRunningIds.add(task.id);
    try {
      const view = await this.activateView();
      if (!view) throw new Error("Cancip view unavailable");
      new Notice(this.t("automationStarted", { title: task.title }));
      const result = task.command
        ? await view.runAutomationCommand(task)
        : await view.runAutomationPrompt(task);
      const resultPath = await this.writeAutomationLog(task, result);
      await this.markAutomationRun(task.id, true, trimContext(result, 600), resultPath);
      new Notice(this.t("automationDone", { title: task.title }));
      return { ok: true, text: result, path: resultPath };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await this.markAutomationRun(task.id, false, reason);
      throw error;
    } finally {
      this.automationRunningIds.delete(task.id);
    }
  }

  async markAutomationRun(id: string, ok: boolean, result: string, resultPath?: string): Promise<void> {
    const tasks = await this.loadAutomations();
    const now = new Date().toISOString();
    const next = tasks.map((task) =>
      task.id === id
        ? {
            ...task,
            updatedAt: now,
            lastRunAt: now,
            lastStatus: ok ? "ok" as const : "failed" as const,
            lastResult: result,
            lastResultPath: resultPath ?? task.lastResultPath
          }
        : task
    );
    await this.saveAutomations(next);
  }

  async writeAutomationLog(task: AutomationTask, result: string): Promise<string> {
    const date = localDateKey(new Date());
    const path = `${AUTOMATION_DIR}/${date}.md`;
    await ensureFolder(this.app.vault.adapter, AUTOMATION_DIR);
    if (!(await this.app.vault.adapter.exists(path))) {
      await this.app.vault.adapter.write(path, `# Cancip Automations ${date}\n\n`);
    }
    const block = [
      `## ${task.title}`,
      "",
      `- id: ${task.id}`,
      `- run: ${new Date().toISOString()}`,
      `- schedule: ${task.schedule}`,
      "",
      "### Prompt",
      "",
      task.prompt.trim(),
      "",
      "### Result",
      "",
      result.trim(),
      ""
    ].join("\n");
    await this.app.vault.adapter.append(path, `${block}\n`);
    return path;
  }

  formatAutomations(tasks: AutomationTask[]): string {
    if (!tasks.length) return this.t("automationListEmpty");
    return tasks
      .map((task) => {
        const status = task.enabled ? "on" : "off";
        const last = task.lastRunAt ? `, last ${task.lastRunAt}` : "";
        const mode = task.command ? `command:${task.command}` : "prompt";
        return `- ${task.id}: ${task.title} [${status}, ${task.schedule}, ${mode}${last}]`;
      })
      .join("\n");
  }

  language(): Language {
    return resolveLanguage(this.settings.language);
  }

  textDirection(): "ltr" | "rtl" {
    return RTL_LANGUAGES.has(this.language()) ? "rtl" : "ltr";
  }

  responseLanguageInstruction(): string {
    const language = this.language();
    const label = LANGUAGE_LABELS[language];
    if (this.settings.language === "auto") {
      return `Language: follow the user's input language. If the user's language is unclear, use ${label}. Keep file paths, commands, code identifiers, and JSON keys unchanged.`;
    }
    return `Language: unless the user explicitly requests another language, answer in ${label}. Keep file paths, commands, code identifiers, and JSON keys unchanged.`;
  }

  t(key: I18nKey, vars?: Record<string, string | number>): string {
    return formatI18n(I18N[this.language()]?.[key] ?? EN[key], vars);
  }

  refreshOpenViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (leaf.view instanceof CancipView) {
        leaf.view.refreshLanguage();
      }
    }
  }

  async activateView(): Promise<CancipView | null> {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      const rightLeaf = this.app.workspace.getRightLeaf(false);
      if (!rightLeaf) return null;
      leaf = rightLeaf;
      await leaf?.setViewState({ type: VIEW_TYPE, active: true });
    }
    if (!leaf) return null;
    await this.app.workspace.revealLeaf(leaf);
    return leaf.view instanceof CancipView ? leaf.view : null;
  }
}

class CancipView extends ItemView {
  private sessionId = sessionExportId(new Date());
  private sessionCreatedAt = new Date().toISOString();
  private messages: ChatMessage[] = [];
  private mode: ComposerMode = "ask";
  private vaultIndex: SearchHit[] = [];
  private draftContext: DraftContext[] = [];
  private manualTodos: ManualTodo[] = [];
  private sourceHits: SearchHit[] = [];
  private hiddenContextKeys = new Set<string>();
  private messagesEl!: HTMLElement;
  private inputEl!: HTMLTextAreaElement;
  private statusEl!: HTMLElement;
  private contextEl: HTMLElement | null = null;
  private queueEl: HTMLElement | null = null;
  private scrollBottomButtonEl: HTMLButtonElement | null = null;
  private sendButtonEl: HTMLButtonElement | null = null;
  private modeButtons: Partial<Record<ComposerMode, HTMLButtonElement>> | null = null;
  private mentionEl: HTMLElement | null = null;
  private menuEl: HTMLElement | null = null;
  private headerMenuEl: HTMLElement | null = null;
  private headerSessionIdEl: HTMLElement | null = null;
  private headerSessionTitleEl: HTMLElement | null = null;
  private mentionItems: MentionTarget[] = [];
  private mentionActiveIndex = 0;
  private mentionRequestId = 0;
  private activeMention: ActiveMention | null = null;
  private activeMenu: ComposerMenuKind | null = null;
  private activeHeaderMenu: HeaderMenuKind | null = null;
  private activeRequests = new Map<string, AbortController>();
  private queuedPrompts: QueuedPrompt[] = [];
  private progressStepTimers = new Map<string, number>();
  private toolRunTimers = new Map<string, number>();
  private detailsOpenState = new Map<string, boolean>();
  private userPinnedScroll = false;
  private autoFollowMessages = true;
  private userInteractingWithMessages = false;
  private programmaticScrollRestore = false;
  private pendingMessageRender = false;
  private messageInteractionIdleTimer: number | null = null;
  private programmaticScrollReleaseTimer: number | null = null;
  private drainQueueAfterRequest = true;
  private currentSessionStatus: NonNullable<SessionHistoryEntry["status"]> = "idle";
  private currentSessionCompletedNotice = false;

  constructor(
    leaf: WorkspaceLeaf,
    private plugin: CancipPlugin
  ) {
    super(leaf);
  }

  refreshLanguage(): void {
    this.render();
  }

  private t(key: I18nKey, vars?: Record<string, string | number>): string {
    return this.plugin.t(key, vars);
  }

  private get activeRequest(): AbortController | null {
    return this.activeRequests.get(this.sessionId) ?? null;
  }

  private set activeRequest(request: AbortController | null) {
    if (request) {
      this.activeRequests.set(this.sessionId, request);
    } else {
      this.activeRequests.delete(this.sessionId);
    }
  }

  private isSessionRunning(sessionId: string): boolean {
    return this.activeRequests.has(sessionId);
  }

  private clearRequest(request: AbortController): void {
    for (const [sessionId, active] of this.activeRequests) {
      if (active === request) this.activeRequests.delete(sessionId);
    }
  }

  private isCurrentRequest(request: AbortController): boolean {
    return this.activeRequests.get(this.sessionId) === request;
  }

  private requestSessionId(request: AbortController): string {
    for (const [sessionId, active] of this.activeRequests) {
      if (active === request) return sessionId;
    }
    return "";
  }

  private hasRequest(request: AbortController): boolean {
    for (const active of this.activeRequests.values()) {
      if (active === request) return true;
    }
    return false;
  }

  getViewType(): string {
    return VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Cancip";
  }

  getIcon(): string {
    return "bot";
  }

  async onOpen(): Promise<void> {
    this.render();
    this.registerEvent(this.app.workspace.on("file-open", () => this.renderContextChips()));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.renderContextChips()));
    this.registerDomEvent(document, "pointerdown", (event) => this.handleDocumentPointerDown(event));
    await this.ensureCurrentSessionRecord();
    await this.refreshVaultIndex(false);
  }

  async onClose(): Promise<void> {
    for (const request of this.activeRequests.values()) request.abort();
    this.activeRequests.clear();
    this.clearLiveTimers();
    if (this.programmaticScrollReleaseTimer !== null) window.clearTimeout(this.programmaticScrollReleaseTimer);
    this.programmaticScrollReleaseTimer = null;
    this.queuedPrompts = [];
  }

  async newChat(): Promise<void> {
    this.queuedPrompts = [];
    this.renderQueueStatus();
    await this.saveCurrentSession();
    this.sessionId = sessionExportId(new Date());
    this.sessionCreatedAt = new Date().toISOString();
    this.messages = [];
    this.draftContext = [];
    this.manualTodos = [];
    this.currentSessionStatus = "idle";
    this.currentSessionCompletedNotice = false;
    this.hiddenContextKeys.clear();
    this.detailsOpenState.clear();
    this.userPinnedScroll = false;
    this.autoFollowMessages = true;
    this.closeHeaderMenu();
    this.renderQueueStatus();
    this.syncRequestControls();
    this.syncSessionChrome();
    this.renderMessages();
    this.renderSources([]);
    this.setStatus(this.t("newChatStatus"));
    void this.recordSessionEvent({ kind: "session.new", status: this.currentSessionStatus });
    await this.ensureCurrentSessionRecord();
    this.focusInput();
  }

  addDraftContext(label: string, content: string, path?: string, source: ContextSource = "virtual"): void {
    this.draftContext.push({ id: crypto.randomUUID(), label, content, path, source });
    this.renderSources(this.sourceHits);
    this.setStatus(this.t("contextAdded", { label }));
    this.focusInput();
  }

  async refreshVaultIndex(forceNotice: boolean): Promise<void> {
    const files = this.loadedContextFiles();
    const hits: SearchHit[] = [];
    for (const file of files) {
      hits.push({
        path: file.path,
        title: file.basename,
        excerpt: "",
        score: 0
      });
    }
    this.vaultIndex = hits;
    this.setStatus(this.t("indexedStatus", { count: hits.length }));
    if (forceNotice) new Notice(this.t("indexedNotice", { count: hits.length }));
  }

  private render(): void {
    const root = this.containerEl.children[1];
    root.empty();
    root.addClass("obcc-root");
    root.toggleClass("is-compact-header", this.plugin.settings.compactHeader);
    root.setAttr("lang", this.plugin.language());
    root.setAttr("dir", this.plugin.textDirection());

    const shell = root.createDiv({ cls: "obcc-shell" });

    const header = shell.createDiv({ cls: "obcc-header" });
    const titleWrap = header.createDiv({ cls: "obcc-title-wrap" });
    titleWrap.createEl("div", { cls: "obcc-kicker", text: this.t("agentKicker") });
    const titleLine = titleWrap.createDiv({ cls: "obcc-title-line" });
    titleLine.createEl("h2", { text: "Cancip" });
    const sessionIdWrap = titleLine.createEl("button", {
      cls: "obcc-session-id-copy",
      attr: { type: "button", title: this.t("copySessionId"), "aria-label": this.t("copySessionId") }
    });
    this.headerSessionIdEl = sessionIdWrap.createSpan({ cls: "obcc-session-id" });
    setIcon(sessionIdWrap.createSpan({ cls: "obcc-session-copy-icon" }), "copy");
    sessionIdWrap.addEventListener("click", () => {
      void this.copySessionId();
    });
    this.headerSessionTitleEl = titleWrap.createDiv({ cls: "obcc-session-title" });
    this.syncSessionChrome();
    const headerActions = header.createDiv({ cls: "obcc-header-actions" });
    const historyButton = headerActions.createEl("button", {
      cls: "obcc-icon-button",
      attr: { "aria-label": this.t("sessionHistory"), title: this.t("sessionHistory") }
    });
    setIcon(historyButton, "history");
    historyButton.addEventListener("click", () => {
      void this.toggleHistoryMenu();
    });

    const outlineButton = headerActions.createEl("button", {
      cls: "obcc-icon-button",
      attr: { "aria-label": this.t("sessionOutline"), title: this.t("sessionOutline") }
    });
    setIcon(outlineButton, "list-tree");
    outlineButton.addEventListener("click", () => {
      this.toggleOutlineMenu();
    });

    const compactModeBar = headerActions.createDiv({ cls: "obcc-header-modes" });
    this.modeButtons = {
      plan: this.createPlanButton(compactModeBar)
    };

    const reviewButton = headerActions.createEl("button", {
      cls: "obcc-icon-button obcc-review-button",
      attr: { "aria-label": this.t("reviewGate"), title: this.t("reviewGate") }
    });
    setIcon(reviewButton, "shield-check");
    reviewButton.addEventListener("click", () => {
      void this.startReviewGate();
    });

    const exportButton = headerActions.createEl("button", {
      cls: "obcc-icon-button",
      attr: { "aria-label": this.t("exportSession"), title: this.t("exportSession") }
    });
    setIcon(exportButton, "download");
    exportButton.addEventListener("click", () => {
      void this.exportSession();
    });

    const newButton = headerActions.createEl("button", {
      cls: "obcc-icon-button",
      attr: { "aria-label": this.t("newChatTitle"), title: this.t("newChatTitle") }
    });
    setIcon(newButton, "plus");
    newButton.addEventListener("click", () => {
      void this.newChat();
    });
    this.syncModeButtons();

    const messagesFrame = shell.createDiv({ cls: "obcc-messages-frame" });
    this.messagesEl = messagesFrame.createDiv({ cls: "obcc-messages" });
    this.messagesEl.addEventListener("scroll", () => {
      if (this.programmaticScrollRestore) {
        this.syncScrollBottomButton();
        return;
      }
      this.markMessageScrollInteraction();
      this.userPinnedScroll = !this.shouldStickToMessageBottom();
      this.syncScrollBottomButton();
    });
    this.messagesEl.addEventListener("touchstart", () => this.markMessageScrollInteraction(), { passive: true });
    this.messagesEl.addEventListener("touchmove", () => this.markMessageScrollInteraction(), { passive: true });
    this.messagesEl.addEventListener("pointerdown", () => this.markMessageScrollInteraction());
    this.messagesEl.addEventListener("wheel", () => this.markMessageScrollInteraction(), { passive: true });
    this.scrollBottomButtonEl = messagesFrame.createEl("button", {
      cls: "obcc-scroll-bottom is-hidden",
      attr: { type: "button", title: this.t("scrollToBottom"), "aria-label": this.t("scrollToBottom") }
    });
    setIcon(this.scrollBottomButtonEl, "arrow-down");
    this.scrollBottomButtonEl.addEventListener("click", () => this.scrollMessagesToBottom(true));

    const footer = shell.createDiv({ cls: "obcc-footer" });
    this.mentionEl = footer.createDiv({ cls: "obcc-mention-popover is-hidden" });
    this.headerMenuEl = footer.createDiv({ cls: "obcc-history-popover is-hidden" });
    this.statusEl = footer.createDiv({ cls: "obcc-status" });
    const form = footer.createEl("form", { cls: "obcc-composer" });
    this.menuEl = form.createDiv({ cls: "obcc-command-popover is-hidden" });
    this.contextEl = form.createDiv({ cls: "obcc-composer-context obcc-context-strip is-hidden" });
    this.inputEl = form.createEl("textarea", {
      cls: "obcc-input",
      attr: {
        rows: "1",
        placeholder: this.t("placeholder")
      }
    });

    this.queueEl = form.createDiv({ cls: "obcc-queue-status is-hidden" });
    const composerBar = form.createDiv({ cls: "obcc-composer-bar" });
    const leftControls = composerBar.createDiv({ cls: "obcc-composer-left" });
    const addButton = leftControls.createEl("button", {
      cls: "obcc-tool-button",
      attr: { type: "button", title: this.t("addMenuTitle"), "aria-label": this.t("addMenuTitle") }
    });
    setIcon(addButton, "plus");
    addButton.addEventListener("click", () => this.toggleAddMenu());

    const accessMode = this.plugin.settings.accessMode;
    const accessLabel = accessMode === "full-access" ? this.t("accessFullAccess") : this.t("accessAskApproval");
    const accessButton = leftControls.createEl("button", {
      cls: `obcc-access-button ${accessMode === "full-access" ? "is-full-access" : "is-ask-approval"}`,
      attr: { type: "button", title: accessLabel, "aria-label": accessLabel }
    });
    setIcon(accessButton.createSpan({ cls: "obcc-access-icon" }), "shield-alert");
    accessButton.createSpan({ cls: "obcc-access-label", text: this.formatAccessLabel(accessMode) });
    setIcon(accessButton.createSpan({ cls: "obcc-chevron" }), "chevron-up");
    accessButton.addEventListener("click", () => this.toggleAccessMenu());

    if (this.plugin.settings.showAttachmentButton) {
      const attachmentButton = leftControls.createEl("button", {
        cls: "obcc-tool-button obcc-attachment-button",
        attr: { type: "button", title: this.t("addAttachment"), "aria-label": this.t("addAttachment") }
      });
      setIcon(attachmentButton, "paperclip");
      attachmentButton.addEventListener("click", () => {
        this.startMentionQuery("");
        this.setStatus(this.t("addAttachment"));
      });
    }

    const rightControls = composerBar.createDiv({ cls: "obcc-composer-right" });
    const activeProfile = this.plugin.activeApiProfile();
    const modelButton = rightControls.createEl("button", {
      cls: "obcc-model-button",
      attr: { type: "button", title: activeProfile.model || this.t("settingsModel"), "aria-label": this.t("settingsModel") }
    });
    modelButton.createSpan({ cls: "obcc-model-name", text: this.formatModelLabel(activeProfile.model) });
    setIcon(modelButton.createSpan({ cls: "obcc-chevron" }), "chevron-up");
    modelButton.addEventListener("click", () => this.toggleModelMenu());

    const sendButton = form.createEl("button", {
      cls: "obcc-send",
      attr: { type: "submit", title: this.t("send"), "aria-label": this.t("send") }
    });
    this.sendButtonEl = sendButton;
    setIcon(sendButton, "arrow-up");
    rightControls.appendChild(sendButton);

    this.inputEl.addEventListener("input", () => {
      this.resizeInput();
      this.syncRequestControls();
      void this.updateMentionPopup();
    });
    this.inputEl.addEventListener("keydown", (event) => {
      if (this.handleMentionKeydown(event)) return;
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        form.requestSubmit();
      }
    });
    this.inputEl.addEventListener("focus", () => void this.updateMentionPopup());
    this.inputEl.addEventListener("blur", () => window.setTimeout(() => this.closeMentionPopup(), 120));
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.submit();
    });

    this.setStatus(this.t("ready"));
    this.renderContextChips();
    this.renderQueueStatus();
    this.syncRequestControls();
    this.renderMessages();
  }

  private async startReviewGate(): Promise<void> {
    this.closeHeaderMenu();
    this.closeCommandMenu();
    this.closeMentionPopup();
    this.setStatus(this.t("reviewGateStatus"));
    const activeFile = this.app.workspace.getActiveFile()?.path;
    const args: Record<string, unknown> = {
      title: activeFile ? `Cancip Review: ${activeFile}` : "Cancip OB Review Gate",
      paths: activeFile ? [activeFile] : [],
      maxFiles: activeFile ? 1 : 40
    };
    const action: CancipAction = { type: "command", command: "cancip.reviewGate", args };
    const run = this.createToolRun(action);
    const message = this.addMessage("assistant", this.t("reviewGatePrompt"));
    message.toolRuns = [run];
    this.renderMessages();

    if (this.plugin.settings.accessMode === "full-access") {
      const result = await this.executeToolRun(run);
      this.addMessage("assistant", this.t("reviewGateActionResult", { summary: result }));
      this.setStatus(run.status === "executed" ? this.t("done") : this.t("callFailed"));
      await this.saveCurrentSession();
      this.renderMessages();
      return;
    }

    this.addMessage("assistant", `${this.t("actionsNeedApproval", { summary: run.summary })}\n\n${this.t("toolRunsQueued", { count: 1 })}`);
    await this.saveCurrentSession();
    this.renderMessages();
  }

  private createModeButton(parent: HTMLElement, mode: ComposerMode, icon: string, label: string): HTMLButtonElement {
    const button = parent.createEl("button", {
      cls: "obcc-mode",
      attr: { title: label, "aria-label": label }
    });
    setIcon(button, icon);
    button.addEventListener("click", () => {
      this.closeCommandMenu();
      this.setMode(mode);
    });
    return button;
  }

  private createPlanButton(parent: HTMLElement): HTMLButtonElement {
    const button = parent.createEl("button", {
      cls: "obcc-mode obcc-plan-button",
      attr: { title: this.t("planPanelTitle"), "aria-label": this.t("planPanelTitle") }
    });
    setIcon(button, "list-todo");
    button.addEventListener("click", () => {
      this.togglePlanMode();
      this.togglePlanMenu();
    });
    return button;
  }

  private createQuickButton(parent: HTMLElement, icon: string, label: string, onClick: () => void): void {
    const button = parent.createEl("button", {
      cls: "obcc-chip",
      attr: { title: label, "aria-label": label }
    });
    setIcon(button, icon);
    button.addEventListener("click", onClick);
  }

  private syncModeButtons(): void {
    if (!this.modeButtons) return;
    for (const [mode, button] of Object.entries(this.modeButtons) as [ComposerMode, HTMLButtonElement][]) {
      button.toggleClass("is-active", mode === this.mode);
    }
  }

  private syncRequestControls(): void {
    const running = Boolean(this.activeRequest);
    if (!this.sendButtonEl) return;
    const queueing = running && Boolean(this.inputEl?.value.trim());
    const label = running ? (queueing ? this.t("queueMessage") : this.t("stop")) : this.t("send");
    this.sendButtonEl.toggleClass("is-stopping", running && !queueing);
    this.sendButtonEl.toggleClass("is-queueing", queueing);
    this.sendButtonEl.setAttr("title", label);
    this.sendButtonEl.setAttr("aria-label", label);
    this.sendButtonEl.empty();
    setIcon(this.sendButtonEl, running && !queueing ? "square" : "arrow-up");
  }

  private renderQueueStatus(): void {
    if (!this.queueEl) return;
    this.queueEl.empty();
    const count = this.queuedPrompts.length;
    this.queueEl.toggleClass("is-hidden", count === 0);
    if (!count) return;
    this.queueEl.createSpan({ cls: "obcc-queue-count", text: this.t("queuedCount", { count }) });
    const next = this.queuedPrompts[0]?.prompt.trim();
    if (next) this.queueEl.createSpan({ cls: "obcc-queue-next", text: trimContext(next, 42) });
    const clearButton = this.queueEl.createEl("button", {
      cls: "obcc-queue-clear",
      attr: { type: "button", title: this.t("clearQueue"), "aria-label": this.t("clearQueue") }
    });
    setIcon(clearButton, "x");
    clearButton.addEventListener("click", () => {
      this.queuedPrompts = [];
      this.renderQueueStatus();
      this.setStatus(this.t("queueCleared"));
    });
  }

  private resizeInput(): void {
    this.inputEl.style.height = "auto";
    this.inputEl.style.height = `${Math.min(this.inputEl.scrollHeight, 150)}px`;
  }

  private focusInput(): void {
    window.setTimeout(() => this.inputEl?.focus(), 20);
  }

  private handleMentionKeydown(event: KeyboardEvent): boolean {
    if (!this.activeMention) return false;
    if (event.key === "Escape") {
      event.preventDefault();
      this.closeMentionPopup();
      return true;
    }
    if (!this.mentionItems.length) return false;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      this.mentionActiveIndex = (this.mentionActiveIndex + 1) % this.mentionItems.length;
      this.renderMentionPopup();
      return true;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      this.mentionActiveIndex = (this.mentionActiveIndex - 1 + this.mentionItems.length) % this.mentionItems.length;
      this.renderMentionPopup();
      return true;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      this.insertMention(this.mentionItems[this.mentionActiveIndex]);
      return true;
    }
    return false;
  }

  private async updateMentionPopup(): Promise<void> {
    const previousQuery = this.activeMention?.query;
    const active = this.detectActiveMention();
    this.activeMention = active;
    if (!active) {
      this.closeMentionPopup();
      return;
    }
    this.closeCommandMenu();
    if (previousQuery !== active.query) this.mentionActiveIndex = 0;
    const requestId = ++this.mentionRequestId;
    const items = await this.findMentionCandidates(active.query, this.plugin.settings.maxMentionResults);
    if (requestId !== this.mentionRequestId) return;
    this.mentionItems = items;
    if (this.mentionActiveIndex >= this.mentionItems.length) this.mentionActiveIndex = 0;
    this.renderMentionPopup();
  }

  private detectActiveMention(): ActiveMention | null {
    const cursor = this.inputEl.selectionStart;
    if (cursor !== this.inputEl.selectionEnd) return null;
    const before = this.inputEl.value.slice(0, cursor);
    const bracket = before.match(/(^|[\s([{，。；,;])@\[([^\]\n]*)$/);
    if (bracket) {
      return {
        start: before.length - bracket[2].length - 2,
        end: cursor,
        query: bracket[2]
      };
    }
    const simple = before.match(/(^|[\s([{，。；,;])@([^\s@[\]\n]*)$/);
    if (!simple) return null;
    return {
      start: before.length - simple[2].length - 1,
      end: cursor,
      query: simple[2]
    };
  }

  private renderMentionPopup(): void {
    if (!this.mentionEl || !this.activeMention) return;
    this.mentionEl.empty();
    this.mentionEl.removeClass("is-hidden");
    const head = this.mentionEl.createDiv({ cls: "obcc-mention-head" });
    head.createSpan({ text: this.t("mentionPanelTitle") });
    head.createSpan({ text: "@" });

    if (!this.mentionItems.length) {
      this.mentionEl.createDiv({ cls: "obcc-mention-empty", text: this.t("mentionNoResults") });
      return;
    }

    this.mentionItems.forEach((item, index) => {
      const row = this.mentionEl!.createEl("button", {
        cls: `obcc-mention-item ${index === this.mentionActiveIndex ? "is-active" : ""}`,
        attr: { type: "button", title: item.path }
      });
      setIcon(row.createSpan({ cls: "obcc-mention-icon" }), mentionIcon(item.kind));
      const body = row.createDiv({ cls: "obcc-mention-body" });
      body.createDiv({ cls: "obcc-mention-title", text: item.title });
      body.createDiv({ cls: "obcc-mention-path", text: item.path });
      row.createSpan({ cls: `obcc-mention-kind is-${item.kind}`, text: item.detail });
      row.addEventListener("pointerdown", (event) => event.preventDefault());
      row.addEventListener("mouseenter", () => {
        this.mentionActiveIndex = index;
        this.renderMentionPopup();
      });
      row.addEventListener("click", () => this.insertMention(item));
    });
  }

  private closeMentionPopup(): void {
    this.activeMention = null;
    this.mentionItems = [];
    this.mentionActiveIndex = 0;
    if (!this.mentionEl) return;
    this.mentionEl.empty();
    this.mentionEl.addClass("is-hidden");
  }

  private insertMention(item: MentionTarget): void {
    if (!this.activeMention) return;
    const value = this.inputEl.value;
    const replacement = `@[${item.path}] `;
    this.inputEl.value = `${value.slice(0, this.activeMention.start)}${replacement}${value.slice(this.activeMention.end)}`;
    const cursor = this.activeMention.start + replacement.length;
    this.inputEl.setSelectionRange(cursor, cursor);
    this.resizeInput();
    this.closeMentionPopup();
    this.focusInput();
  }

  private toggleAddMenu(): void {
    const items: ComposerMenuItem[] = [
      { icon: "file-search", label: this.t("addFileFolder"), shortLabel: this.t("mentionFile"), detail: "@", action: () => this.startMentionQuery("") },
      { icon: "plug", label: this.t("addPlugin"), shortLabel: "Plugin", detail: "@plugin", action: () => this.startMentionQuery("plugin") },
      { icon: "sparkles", label: this.t("addSkill"), shortLabel: "Skill", detail: "@skill", action: () => this.startMentionQuery("skill") },
      { icon: "file-plus", label: this.t("addCurrentFile"), shortLabel: this.t("currentFile"), action: () => void this.addCurrentFileContext() },
      {
        icon: "brain",
        label: this.t("importCodexMemory"),
        shortLabel: this.t("codexMemory"),
        action: () => void this.plugin.importCodexCoreMemory(true).then((result) => {
          new Notice(this.t("codexMemoryImported", { count: result.count, path: result.folder }));
        }).catch((error) => {
          const reason = error instanceof Error ? error.message : String(error);
          new Notice(this.t("codexMemoryImportFailed", { reason }));
        })
      },
      { icon: "calendar-clock", label: this.t("automationTask"), shortLabel: this.t("automationTask"), detail: "@automation", action: () => this.startMentionQuery("automation") },
      {
        icon: "list-todo",
        label: this.t("addPlanMode"),
        shortLabel: this.t("modePlan"),
        active: this.mode === "plan",
        action: () => {
          this.togglePlanMode();
          if (this.plugin.settings.autoOpenPlanPanel) this.openPlanMenu();
        }
      },
      {
        icon: "target",
        label: this.t("addPursueGoal"),
        shortLabel: this.t("addPursueGoal"),
        active: this.mode === "plan",
        action: () => {
          this.setMode("plan");
          this.insertPromptText(this.t("pursueGoalPrompt"));
        }
      }
    ];
    if (this.plugin.settings.commandBusEnabled) {
      items.splice(3, 0, {
        icon: "terminal",
        label: this.t("commandBus"),
        shortLabel: this.t("mentionCommand"),
        detail: "cancip-action command",
        action: () => this.startMentionQuery("command")
      });
    }
    this.toggleCommandMenu("add", this.t("addMenuTitle"), items);
  }

  private toggleAccessMenu(): void {
    this.toggleCommandMenu("access", this.t("accessMenuTitle"), [
      {
        icon: "shield-question",
        label: this.t("accessAskApproval"),
        shortLabel: this.formatAccessLabel("ask-for-approval"),
        active: this.plugin.settings.accessMode === "ask-for-approval",
        action: () => void this.setAccessMode("ask-for-approval")
      },
      {
        icon: "shield-alert",
        label: this.t("accessFullAccess"),
        shortLabel: this.formatAccessLabel("full-access"),
        active: this.plugin.settings.accessMode === "full-access",
        action: () => void this.setAccessMode("full-access")
      }
    ]);
  }

  private toggleModelMenu(): void {
    const active = this.plugin.activeApiProfile();
    const presets = normalizeModelOptions(this.plugin.settings.modelOptions, active.model);
    this.toggleCommandMenu("model", this.t("modelMenuTitle"), presets.map((model) => ({
      icon: "cpu",
      label: model,
      shortLabel: this.formatModelLabel(model),
      active: model === active.model,
      action: () => void this.setModel(model)
    })));
  }

  private toggleCommandMenu(kind: ComposerMenuKind, title: string, items: ComposerMenuItem[]): void {
    if (!this.menuEl) return;
    if (this.activeMenu === kind && !this.menuEl.hasClass("is-hidden")) {
      this.closeCommandMenu();
      return;
    }
    this.activeMenu = kind;
    this.closeMentionPopup();
    this.menuEl.empty();
    this.menuEl.removeClass("is-add");
    this.menuEl.removeClass("is-access");
    this.menuEl.removeClass("is-model");
    this.menuEl.addClass(`is-${kind}`);
    this.menuEl.removeClass("is-hidden");

    for (const item of items) {
      const row = this.menuEl.createEl("button", {
        cls: `obcc-command-item ${item.active ? "is-active" : ""}`,
        attr: { type: "button", title: item.detail ? `${item.label} · ${item.detail}` : item.label, "aria-label": item.label }
      });
      setIcon(row.createSpan({ cls: "obcc-command-icon" }), item.icon);
      row.createSpan({ cls: "obcc-command-title", text: item.shortLabel ?? item.label });
      if (item.active) setIcon(row.createSpan({ cls: "obcc-command-check" }), "check");
      row.addEventListener("pointerdown", (event) => event.preventDefault());
      row.addEventListener("click", async () => {
        await item.action();
        this.closeCommandMenu();
      });
    }
  }

  private closeCommandMenu(): void {
    this.activeMenu = null;
    if (!this.menuEl) return;
    this.menuEl.empty();
    this.menuEl.addClass("is-hidden");
    this.menuEl.removeClass("is-add");
    this.menuEl.removeClass("is-access");
    this.menuEl.removeClass("is-model");
  }

  private handleDocumentPointerDown(event: PointerEvent): void {
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (this.activeMenu) {
      if (
        target instanceof Element &&
        target.closest(".obcc-command-popover, .obcc-tool-button, .obcc-access-button, .obcc-model-button")
      ) {
        return;
      }
      this.closeCommandMenu();
    }
    if (this.activeHeaderMenu) {
      if (
        target instanceof Element &&
        target.closest(".obcc-history-popover, .obcc-icon-button, .obcc-plan-button")
      ) {
        return;
      }
      this.closeHeaderMenu();
    }
  }

  private async toggleHistoryMenu(): Promise<void> {
    if (!this.headerMenuEl) return;
    if (this.activeHeaderMenu === "history" && !this.headerMenuEl.hasClass("is-hidden")) {
      this.closeHeaderMenu();
      return;
    }
    await this.openHistoryMenu();
  }

  private async openHistoryMenu(): Promise<void> {
    if (!this.headerMenuEl) return;
    this.activeHeaderMenu = "history";
    this.closeCommandMenu();
    this.closeMentionPopup();
    this.headerMenuEl.empty();
    this.headerMenuEl.removeClass("is-hidden");
    this.headerMenuEl.removeClass("is-plan");
    this.headerMenuEl.removeClass("is-events");
    this.headerMenuEl.removeClass("is-outline");
    this.headerMenuEl.addClass("is-history");

    const head = this.headerMenuEl.createDiv({ cls: "obcc-command-head" });
    head.createSpan({ text: this.t("sessionHistory") });
    const eventsButton = head.createEl("button", {
      cls: "obcc-link-button",
      attr: { type: "button", title: this.t("sessionEvents"), "aria-label": this.t("sessionEvents") }
    });
    setIcon(eventsButton, "list-checks");
    eventsButton.addEventListener("click", () => {
      void this.openSessionEventsMenu();
    });
    const closeButton = head.createEl("button", {
      cls: "obcc-link-button",
      attr: { type: "button", title: this.t("clearContext"), "aria-label": this.t("clearContext") }
    });
    setIcon(closeButton, "x");
    closeButton.addEventListener("click", () => this.closeHeaderMenu());

    const entries = await this.readSessionHistoryIndex();
    if (!entries.length) {
      this.headerMenuEl.createDiv({ cls: "obcc-mention-empty", text: this.t("sessionNoHistory") });
      return;
    }

    for (const entry of entries.slice(0, 20)) {
      const status = this.isSessionRunning(entry.id) ? "running" : entry.status ?? "idle";
      const hasNotice = Boolean(entry.completedNotice && entry.id !== this.sessionId);
      const row = this.headerMenuEl.createEl("button", {
        cls: `obcc-command-item obcc-session-item ${entry.id === this.sessionId ? "is-active" : ""} is-${status} ${hasNotice ? "has-notice" : ""}`,
        attr: { type: "button", title: entry.title }
      });
      const icon = row.createSpan({ cls: "obcc-command-icon obcc-session-icon" });
      if (entry.eventOnly) {
        setIcon(icon, "list-checks");
      } else if (status === "running") {
        setIcon(icon, "loader-2");
      } else {
        setIcon(icon, "messages-square");
      }
      const body = row.createDiv({ cls: "obcc-command-body" });
      body.createDiv({ cls: "obcc-command-title", text: entry.title });
      body.createDiv({ cls: "obcc-command-detail", text: entry.eventOnly
        ? `${this.t("sessionEvents")} · ${formatSessionHistoryTime(entry.updatedAt)}`
        : `${this.sessionStatusLabel(status)} · ${this.composerModeLabel(entry.mode)} · ${entry.messageCount} · ${formatSessionHistoryTime(entry.updatedAt)}` });
      const state = row.createSpan({ cls: "obcc-session-state" });
      if (hasNotice) state.createSpan({ cls: "obcc-session-dot" });
      row.addEventListener("pointerdown", (event) => event.preventDefault());
      row.addEventListener("click", () => {
        if (entry.eventOnly) {
          void this.openSessionEventsMenu(entry.id);
          return;
        }
        void this.loadSessionHistoryEntry(entry);
      });
    }
  }

  private async openSessionEventsMenu(sessionId?: string): Promise<void> {
    if (!this.headerMenuEl) return;
    this.activeHeaderMenu = "events";
    this.closeCommandMenu();
    this.closeMentionPopup();
    this.headerMenuEl.empty();
    this.headerMenuEl.removeClass("is-hidden");
    this.headerMenuEl.removeClass("is-plan");
    this.headerMenuEl.removeClass("is-outline");
    this.headerMenuEl.removeClass("is-history");
    this.headerMenuEl.addClass("is-events");

    const head = this.headerMenuEl.createDiv({ cls: "obcc-command-head" });
    head.createSpan({ text: this.t("sessionEvents") });
    const copyButton = head.createEl("button", {
      cls: "obcc-link-button",
      attr: { type: "button", title: this.t("copyMessage"), "aria-label": this.t("copyMessage") }
    });
    setIcon(copyButton, "copy");
    const backButton = head.createEl("button", {
      cls: "obcc-link-button",
      attr: { type: "button", title: this.t("sessionHistory"), "aria-label": this.t("sessionHistory") }
    });
    setIcon(backButton, "history");
    backButton.addEventListener("click", () => {
      void this.openHistoryMenu();
    });
    const closeButton = head.createEl("button", {
      cls: "obcc-link-button",
      attr: { type: "button", title: this.t("clearContext"), "aria-label": this.t("clearContext") }
    });
    setIcon(closeButton, "x");
    closeButton.addEventListener("click", () => this.closeHeaderMenu());

    const events = await this.readSessionEvents(50, sessionId);
    const text = this.formatSessionEvents(events, 50);
    copyButton.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(text);
        this.setStatus(this.t("sessionEventsCopied"));
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        new Notice(this.t("copyFailed", { reason }));
      }
    });

    if (!events.length) {
      this.headerMenuEl.createDiv({ cls: "obcc-mention-empty", text: this.t("sessionEventsEmpty") });
      return;
    }

    for (const event of events.slice(-20).reverse()) {
      const row = this.headerMenuEl.createDiv({ cls: "obcc-command-item obcc-session-event-item" });
      const icon = row.createSpan({ cls: "obcc-command-icon" });
      setIcon(icon, sessionEventIcon(event.kind));
      const body = row.createDiv({ cls: "obcc-command-body" });
      body.createDiv({ cls: "obcc-command-title", text: `${event.kind}${event.status ? ` · ${event.status}` : ""}` });
      body.createDiv({ cls: "obcc-command-detail", text: formatSessionEventLine(event) });
    }
  }

  private toggleOutlineMenu(): void {
    if (!this.headerMenuEl) return;
    if (this.activeHeaderMenu === "outline" && !this.headerMenuEl.hasClass("is-hidden")) {
      this.closeHeaderMenu();
      return;
    }
    this.openOutlineMenu();
  }

  private openOutlineMenu(): void {
    if (!this.headerMenuEl) return;
    this.activeHeaderMenu = "outline";
    this.closeCommandMenu();
    this.closeMentionPopup();
    this.headerMenuEl.empty();
    this.headerMenuEl.removeClass("is-hidden");
    this.headerMenuEl.removeClass("is-history");
    this.headerMenuEl.removeClass("is-events");
    this.headerMenuEl.removeClass("is-plan");
    this.headerMenuEl.addClass("is-outline");

    const head = this.headerMenuEl.createDiv({ cls: "obcc-command-head" });
    head.createSpan({ text: this.t("sessionOutline") });
    const closeButton = head.createEl("button", {
      cls: "obcc-link-button",
      attr: { type: "button", title: this.t("clearContext"), "aria-label": this.t("clearContext") }
    });
    setIcon(closeButton, "x");
    closeButton.addEventListener("click", () => this.closeHeaderMenu());

    const outline = this.currentSessionOutlineItems();
    if (!outline.length) {
      this.headerMenuEl.createDiv({ cls: "obcc-mention-empty", text: this.t("sessionOutlineEmpty") });
      return;
    }

    for (const item of outline) {
      const row = this.headerMenuEl.createEl("button", {
        cls: `obcc-command-item obcc-outline-item is-${item.role}`,
        attr: { type: "button", title: item.preview }
      });
      const icon = row.createSpan({ cls: "obcc-command-icon" });
      setIcon(icon, item.role === "user" ? "user" : "bot");
      const body = row.createDiv({ cls: "obcc-command-body" });
      body.createDiv({ cls: "obcc-command-title", text: item.title });
      body.createDiv({ cls: "obcc-command-detail", text: item.preview });
      row.addEventListener("pointerdown", (event) => event.preventDefault());
      row.addEventListener("click", () => {
        this.scrollToMessage(item.id);
        this.closeHeaderMenu();
      });
    }
  }

  private currentSessionOutlineItems(): Array<{ id: string; role: "user" | "assistant"; title: string; preview: string }> {
    return this.messages
      .filter((message) => message.role === "user" || message.role === "assistant")
      .filter((message) => !isProgressMessage(message.content))
      .map((message) => {
        const text = messageOutlineText(message.content);
        return {
          id: message.id,
          role: message.role as "user" | "assistant",
          title: `${message.role === "user" ? this.t("userQuestion") : PLUGIN_NAME} · ${formatSessionHistoryTime(new Date(message.createdAt).toISOString())}`,
          preview: trimContext(text || this.t("none"), 150).replace(/\s+/g, " ")
        };
      })
      .filter((item) => item.preview && item.preview !== this.t("none"))
      .slice(-40);
  }

  private scrollToMessage(messageId: string): void {
    const target = this.messagesEl.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`);
    if (target instanceof HTMLElement) {
      target.scrollIntoView({ block: "center", behavior: "smooth" });
      target.addClass("is-outline-target");
      window.setTimeout(() => target.removeClass("is-outline-target"), 1200);
    }
  }

  private sessionStatusLabel(status: NonNullable<SessionHistoryEntry["status"]>): string {
    if (status === "running") return this.t("sessionRunning");
    if (status === "completed") return this.t("sessionCompleted");
    if (status === "failed") return this.t("sessionFailed");
    return this.t("done");
  }

  private composerModeLabel(mode: ComposerMode): string {
    if (mode === "ask") return this.t("modeAsk");
    if (mode === "search") return this.t("modeSearch");
    if (mode === "plan") return this.t("modePlan");
    return this.t("modeEdit");
  }

  private togglePlanMenu(): void {
    if (!this.headerMenuEl) return;
    if (this.activeHeaderMenu === "plan" && !this.headerMenuEl.hasClass("is-hidden")) {
      this.closeHeaderMenu();
      return;
    }
    this.openPlanMenu();
  }

  private openPlanMenu(): void {
    if (!this.headerMenuEl) return;
    this.activeHeaderMenu = "plan";
    this.closeCommandMenu();
    this.closeMentionPopup();
    this.headerMenuEl.empty();
    this.headerMenuEl.removeClass("is-hidden");
    this.headerMenuEl.removeClass("is-history");
    this.headerMenuEl.removeClass("is-events");
    this.headerMenuEl.removeClass("is-outline");
    this.headerMenuEl.addClass("is-plan");

    const head = this.headerMenuEl.createDiv({ cls: "obcc-command-head" });
    head.createSpan({ text: this.t("planPanelTitle") });
    const closeButton = head.createEl("button", {
      cls: "obcc-link-button",
      attr: { type: "button", title: this.t("clearContext"), "aria-label": this.t("clearContext") }
    });
    setIcon(closeButton, "x");
    closeButton.addEventListener("click", () => this.closeHeaderMenu());

    if (this.plugin.settings.showLiveTodos) {
      const liveSection = this.headerMenuEl.createDiv({ cls: "obcc-plan-section" });
      liveSection.createDiv({ cls: "obcc-plan-section-title", text: this.t("realtimeTodos") });
      for (const todo of this.realtimeTodos()) {
        this.renderTodoRow(liveSection, todo, true);
      }
    }

    if (this.plugin.settings.showManualTodos) {
      const manualSection = this.headerMenuEl.createDiv({ cls: "obcc-plan-section" });
      manualSection.createDiv({ cls: "obcc-plan-section-title", text: this.t("manualTodos") });
      const manualList = manualSection.createDiv({ cls: "obcc-manual-todos" });
      this.renderManualTodoList(manualList);

      const form = manualSection.createEl("form", { cls: "obcc-manual-todo-form" });
      const input = form.createEl("input", {
        cls: "obcc-manual-todo-input",
        attr: { type: "text", placeholder: this.t("manualTodoPlaceholder"), "aria-label": this.t("manualTodoPlaceholder") }
      });
      const addButton = form.createEl("button", {
        cls: "obcc-icon-button",
        attr: { type: "submit", title: this.t("addManualTodo"), "aria-label": this.t("addManualTodo") }
      });
      setIcon(addButton, "plus");
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        this.manualTodos.push({ id: crypto.randomUUID(), text, done: false, createdAt: new Date().toISOString() });
        input.value = "";
        void this.saveCurrentSession();
        this.openPlanMenu();
      });
    }
  }

  private realtimeTodos(): string[] {
    const todos: string[] = [this.t("todoPlanMode")];
    const activeFile = this.app.workspace.getActiveFile();
    todos.push(activeFile ? this.t("todoCurrentFile", { path: activeFile.path }) : this.t("todoNoCurrentFile"));
    if (this.draftContext.length) todos.push(this.t("todoDraftContext", { count: this.draftContext.length }));
    const openManualTodos = this.manualTodos.filter((todo) => !todo.done).length;
    if (openManualTodos) todos.push(this.t("todoManualOpen", { count: openManualTodos }));
    if (this.activeRequest) todos.push(this.t("todoRequestRunning"));
    if (this.queuedPrompts.length) todos.push(this.t("todoQueuedPrompts", { count: this.queuedPrompts.length }));
    if (this.messages.length) todos.push(this.t("todoCanExport"));
    todos.push(this.t("todoLocalVersion"));
    if (this.plugin.settings.automationsEnabled) todos.push(this.t("todoAutomations"));
    return todos;
  }

  private renderTodoRow(parent: HTMLElement, text: string, readonly: boolean, todo?: ManualTodo): void {
    const row = parent.createDiv({ cls: `obcc-todo-row ${todo?.done ? "is-done" : ""}` });
    const check = row.createEl("button", {
      cls: "obcc-todo-check",
      attr: { type: "button", "aria-label": text, title: text }
    });
    setIcon(check, todo?.done ? "check-circle-2" : readonly ? "circle-dot" : "circle");
    if (!readonly && todo) {
      check.addEventListener("click", () => {
        todo.done = !todo.done;
        void this.saveCurrentSession();
        this.openPlanMenu();
      });
    }
    row.createDiv({ cls: "obcc-todo-text", text });
    if (!readonly && todo) {
      const remove = row.createEl("button", {
        cls: "obcc-todo-remove",
        attr: { type: "button", title: this.t("clearContext"), "aria-label": this.t("clearContext") }
      });
      setIcon(remove, "x");
      remove.addEventListener("click", () => {
        this.manualTodos = this.manualTodos.filter((item) => item.id !== todo.id);
        void this.saveCurrentSession();
        this.openPlanMenu();
      });
    }
  }

  private renderManualTodoList(parent: HTMLElement): void {
    parent.empty();
    if (!this.manualTodos.length) {
      parent.createDiv({ cls: "obcc-mention-empty", text: this.t("noManualTodos") });
      return;
    }
    for (const todo of this.manualTodos) {
      this.renderTodoRow(parent, todo.text, false, todo);
    }
  }

  private closeHeaderMenu(): void {
    this.activeHeaderMenu = null;
    if (!this.headerMenuEl) return;
    this.headerMenuEl.empty();
    this.headerMenuEl.addClass("is-hidden");
    this.headerMenuEl.removeClass("is-history");
    this.headerMenuEl.removeClass("is-events");
    this.headerMenuEl.removeClass("is-outline");
    this.headerMenuEl.removeClass("is-plan");
  }

  private async loadSessionHistoryEntry(entry: SessionHistoryEntry): Promise<void> {
    try {
      await this.saveCurrentSession();
      const raw = await this.app.vault.adapter.read(entry.path);
      const snapshot = JSON.parse(raw) as unknown;
      if (!isRecord(snapshot) || !Array.isArray(snapshot.messages)) throw new Error("Invalid session file");
      this.sessionId = entry.id;
      this.sessionCreatedAt = typeof snapshot.sessionCreatedAt === "string" ? snapshot.sessionCreatedAt : entry.createdAt;
      this.currentSessionStatus = entry.status ?? "idle";
      this.currentSessionCompletedNotice = Boolean(entry.completedNotice);
      this.mode = isComposerMode(snapshot.mode) ? snapshot.mode : entry.mode;
      this.draftContext = Array.isArray(snapshot.draftContext)
        ? snapshot.draftContext
            .filter(isRecord)
            .map((item) => ({
              id: typeof item.id === "string" ? item.id : crypto.randomUUID(),
              label: typeof item.label === "string" ? item.label : "",
              content: typeof item.content === "string" ? item.content : "",
              path: typeof item.path === "string" ? item.path : undefined,
              source: isContextSource(item.source) ? item.source : undefined
            }))
            .filter((item) => item.label || item.content)
        : [];
      this.manualTodos = normalizeManualTodos(snapshot.manualTodos);
      this.queuedPrompts = [];
      this.messages = snapshot.messages
        .filter(isRecord)
        .map((item): ChatMessage | null => this.normalizeSessionMessage(item))
        .filter((item): item is ChatMessage => item !== null);
      this.hiddenContextKeys.clear();
      this.detailsOpenState.clear();
      this.userPinnedScroll = false;
      this.autoFollowMessages = true;
      this.closeHeaderMenu();
      this.renderQueueStatus();
      this.syncRequestControls();
      this.syncSessionChrome();
      this.renderMessages();
      this.renderSources(this.messages.at(-1)?.sources ?? []);
      this.syncModeButtons();
      this.setStatus(this.t("sessionLoaded"));
      if (this.isSessionRunning(entry.id)) {
        void this.updateCurrentSessionStatus("running", false);
      } else if (entry.status === "completed" || entry.status === "failed") {
        void this.updateCurrentSessionStatus(entry.status, Boolean(entry.completedNotice));
      }
      this.focusInput();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn("Cancip session load failed", error);
      new Notice(this.t("sessionLoadFailed", { reason }));
      this.setStatus(this.t("sessionLoadFailed", { reason }));
    }
  }

  private normalizeSessionMessage(item: Record<string, unknown>): ChatMessage | null {
    if (item.role !== "system" && item.role !== "user" && item.role !== "assistant") return null;
    const created = typeof item.createdAt === "string" ? Date.parse(item.createdAt) : Number(item.createdAt);
    const sources = Array.isArray(item.sources)
      ? item.sources.filter(isRecord).map((source) => ({
          path: typeof source.path === "string" ? source.path : "",
          title: typeof source.title === "string" ? source.title : "",
          excerpt: typeof source.excerpt === "string" ? source.excerpt : "",
          score: typeof source.score === "number" ? source.score : 0
        }))
      : [];
    return {
      id: typeof item.id === "string" ? item.id : crypto.randomUUID(),
      role: item.role,
      content: typeof item.content === "string" ? item.content : "",
      createdAt: Number.isFinite(created) ? created : Date.now(),
      sources,
      mode: isComposerMode(item.mode) ? item.mode : undefined,
      accessMode: isAccessMode(item.accessMode) ? item.accessMode : undefined,
      apiProfile: isRecord(item.apiProfile) ? normalizeSessionApiProfile(item.apiProfile) : undefined,
      systemPrompt: typeof item.systemPrompt === "string" ? item.systemPrompt : undefined,
      contextText: typeof item.contextText === "string" ? item.contextText : undefined,
      toolRuns: normalizeToolRuns(item.toolRuns)
    };
  }

  private setMode(mode: ComposerMode): void {
    this.mode = mode;
    this.syncModeButtons();
    this.focusInput();
  }

  private togglePlanMode(): void {
    this.setMode(this.mode === "plan" ? "ask" : "plan");
  }

  private async setAccessMode(mode: AccessMode): Promise<void> {
    this.plugin.settings.accessMode = mode;
    await this.plugin.saveSettings();
    const label = this.plugin.settings.accessMode === "full-access" ? this.t("accessFullAccess") : this.t("accessAskApproval");
    this.render();
    this.setStatus(this.t("accessModeChanged", { mode: label }));
    this.focusInput();
  }

  private async setModel(model: string): Promise<void> {
    await this.plugin.updateActiveApiProfile({ model });
    this.render();
    this.setStatus(this.t("modelChanged", { model }));
    this.focusInput();
  }

  startMentionQuery(query: string): void {
    this.insertPromptText(`@${query}`);
    void this.updateMentionPopup();
  }

  private insertPromptText(text: string): void {
    const start = this.inputEl.selectionStart ?? this.inputEl.value.length;
    const end = this.inputEl.selectionEnd ?? start;
    const value = this.inputEl.value;
    const needsSpace = start > 0 && !/\s$/.test(value.slice(0, start));
    const insertion = `${needsSpace ? " " : ""}${text}`;
    this.inputEl.value = `${value.slice(0, start)}${insertion}${value.slice(end)}`;
    const cursor = start + insertion.length;
    this.inputEl.setSelectionRange(cursor, cursor);
    this.resizeInput();
    this.focusInput();
  }

  private formatModelLabel(model: string): string {
    const trimmed = model.trim();
    if (!trimmed) return this.t("settingsModel");
    const compact = trimmed.replace(/^openai\//i, "");
    return compact.length > 18 ? `${compact.slice(0, 18)}...` : compact;
  }

  private formatAccessLabel(mode: AccessMode): string {
    const labels: Record<Language, Record<AccessMode, string>> = {
      zh: { "ask-for-approval": "确认", "full-access": "全权" },
      "zh-TW": { "ask-for-approval": "確認", "full-access": "全權" },
      en: { "ask-for-approval": "Approve", "full-access": "Full" },
      ug: { "ask-for-approval": "تەستىق", "full-access": "تولۇق" },
      tr: { "ask-for-approval": "Onay", "full-access": "Tam" },
      ru: { "ask-for-approval": "Запрос", "full-access": "Полный" },
      ja: { "ask-for-approval": "承認", "full-access": "全権" },
      ko: { "ask-for-approval": "승인", "full-access": "전체" },
      es: { "ask-for-approval": "Pedir", "full-access": "Total" },
      fr: { "ask-for-approval": "Accord", "full-access": "Total" },
      de: { "ask-for-approval": "Fragen", "full-access": "Voll" },
      ar: { "ask-for-approval": "موافقة", "full-access": "كامل" }
    };
    return labels[this.plugin.language()][mode];
  }

  private async submit(mode: ComposerSubmitMode = "queue"): Promise<void> {
    const rawPrompt = this.inputEl.value.trim();
    if (this.activeRequest && mode === "queue" && !rawPrompt) {
      this.stopRequest({ drainQueue: false });
      return;
    }
    if (!rawPrompt) return;
    this.inputEl.value = "";
    this.resizeInput();

    if (this.activeRequest) {
      this.enqueuePrompt(rawPrompt, mode === "direct");
      if (mode === "direct") {
        this.stopRequest({ drainQueue: true, notice: false });
        this.setStatus(this.t("directSendQueued"));
      }
      this.syncRequestControls();
      return;
    }

    await this.sendPromptNow(rawPrompt);
  }

  private enqueuePrompt(prompt: string, priority: boolean): void {
    const item: QueuedPrompt = { id: crypto.randomUUID(), prompt, createdAt: Date.now() };
    if (priority) {
      this.queuedPrompts.unshift(item);
      this.setStatus(this.t("directSendQueued"));
    } else {
      this.queuedPrompts.push(item);
      this.setStatus(this.t("queuedPrompt", { count: this.queuedPrompts.length }));
    }
    this.renderQueueStatus();
  }

  private async drainQueuedPrompts(): Promise<void> {
    if (this.activeRequest || !this.queuedPrompts.length) return;
    const next = this.queuedPrompts.shift();
    this.renderQueueStatus();
    if (!next) return;
    this.setStatus(this.t("queuedPromptRunning", { count: this.queuedPrompts.length }));
    await this.sendPromptNow(next.prompt);
  }

  private async sendPromptNow(rawPrompt: string): Promise<void> {
    const startedAt = Date.now();
    this.drainQueueAfterRequest = true;
    void this.recordSessionEvent({ kind: "prompt.send", detail: rawPrompt });
    if (isRepairSlashCommand(rawPrompt)) {
      await this.runRepairCommand(rawPrompt);
      return;
    }

    this.resetMessageAutoFollow();
    const userMessage = this.addMessage("user", rawPrompt);
    const taskGoal = this.resolveTaskGoal(rawPrompt);
    const modelPrompt = this.modelPromptForTurn(rawPrompt, taskGoal);
    const suppressToolActions = shouldSuppressToolActionsForPrompt(taskGoal);
    this.syncSessionChrome();
    this.renderMessages();
    this.scrollMessagesToBottom(false);

    const request = new AbortController();
    this.activeRequest = request;
    this.syncRequestControls();
    void this.updateCurrentSessionStatus("running", false);
    let context = { system: this.modePrompt(), contextText: "", searchHits: [] as SearchHit[] };
    const contextStep = this.addProgressStep(this.t("preparingContext"));
    const requestProgressSteps: ChatMessage[] = [contextStep];
    try {
      this.setStatus(this.t("preparingContext"));
      context = await this.buildContext(taskGoal);
      if (request.signal.aborted || !this.hasRequest(request)) return;
      this.updateProgressStep(contextStep, this.t("preparingContext"), `${this.t("obsidianContext")}: ${context.contextText.length} chars\n${this.t("hitCount", { count: context.searchHits.length })}`);

      userMessage.sources = context.searchHits;
      userMessage.contextText = context.contextText;
      userMessage.systemPrompt = context.system;
      userMessage.mode = this.mode;
      userMessage.accessMode = this.plugin.settings.accessMode;
      userMessage.apiProfile = this.redactedApiProfile(this.plugin.activeApiProfile());
      this.renderSources(context.searchHits);

      const activeProfile = this.plugin.activeApiProfile();
      if (!activeProfile.apiUrl || !activeProfile.apiKey || !activeProfile.model) {
        this.addMessage(
          "assistant",
          this.localFallback(rawPrompt, context.searchHits, this.t("missingApi"))
        );
        this.setStatus(this.t("callFailed"));
        await this.finishCurrentSessionStatus("failed", true, request);
        return;
      }

      this.setStatus(this.t("generating"));
      const generationStep = this.addProgressStep(this.t("generating"));
      requestProgressSteps.push(generationStep);
      const answer = await withTimeout(this.callModel(modelPrompt, context), MODEL_CALL_TIMEOUT_MS, "model request timed out");
      if (request.signal.aborted || !this.hasRequest(request)) return;
      const requestSessionId = this.requestSessionId(request);
      if (requestSessionId && requestSessionId !== this.sessionId) {
        await this.completeDetachedApiResponse(requestSessionId, modelPrompt, answer, startedAt, suppressToolActions);
        this.clearRequest(request);
        this.syncRequestControls();
        if (this.drainQueueAfterRequest) void this.drainQueuedPrompts();
        return;
      }
      this.updateProgressStep(generationStep, this.t("generating"), this.t("done"));
      const suppressedActions = suppressToolActions && extractCancipActions(answer).length > 0;
      const visibleAnswer = suppressToolActions ? removeCancipActionBlocks(answer).trim() : answer.trim();
      if (!visibleAnswer) {
        this.addMessage("assistant", suppressedActions ? this.t("emptyApiReplyWithSuppressedTools") : this.t("emptyApiReply"));
        this.setStatus(this.t("callFailed"));
        await this.finishCurrentSessionStatus("failed", true, request);
        return;
      }
      const assistantMessage = this.addMessage("assistant", visibleAnswer);
      this.renderMessages();
      let actionReport = suppressToolActions ? null : await this.handleActionBlocks(answer, assistantMessage);
      if (!actionReport && !suppressToolActions) {
        actionReport = await this.forceToolActionForImplementationTask(taskGoal, context, request);
      }
      if (actionReport) {
        this.addMessage("assistant", actionReport.report);
        this.renderMessages();
        const finalReport = await this.continueAfterToolRuns(context, actionReport, request, taskGoal);
        const finalActionReport = finalReport ?? actionReport;
        const needsMoreAction = shouldExpectToolActionForPrompt(taskGoal) && shouldNeedMoreActionForPrompt(taskGoal, finalActionReport.runs);
        this.ensureFinalConclusion(finalActionReport, startedAt, needsMoreAction, taskGoal);
        if (needsMoreAction) {
          this.setStatus(this.t("callFailed"));
          await this.finishCurrentSessionStatus("failed", true, request);
          return;
        }
      } else {
        this.ensurePlainFinalConclusion(startedAt);
      }
      this.setStatus(this.t("done"));
      await this.finishCurrentSessionStatus("completed", true, request);
    } catch (error) {
      if (request.signal.aborted || !this.hasRequest(request)) {
        if (!this.hasRequest(request)) {
          this.setStatus(this.t("stopped"));
          await this.finishCurrentSessionStatus("idle", false, request);
        }
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      void this.recordSessionEvent({ kind: "prompt.error", detail: message });
      void this.recordSessionEvent({ kind: "prompt.recoverable_error", detail: message, status: "failed" });
      this.addMessage("assistant", this.localFallback(taskGoal, context.searchHits, message));
      this.setStatus(this.t("callFailed"));
      await this.finishCurrentSessionStatus("failed", true, request);
    } finally {
      for (const step of requestProgressSteps) this.stopProgressStepTimer(step.id);
      if (this.hasRequest(request)) this.clearRequest(request);
      this.syncRequestControls();
      this.renderMessages();
      if (this.drainQueueAfterRequest) void this.drainQueuedPrompts();
    }
  }

  private async runRepairCommand(rawPrompt: string): Promise<void> {
    this.resetMessageAutoFollow();
    const userMessage = this.addMessage("user", rawPrompt);
    userMessage.mode = this.mode;
    userMessage.accessMode = this.plugin.settings.accessMode;
    userMessage.apiProfile = this.redactedApiProfile(this.plugin.activeApiProfile());
    this.renderMessages();
    this.scrollMessagesToBottom(false);

    const request = new AbortController();
    this.activeRequest = request;
    this.syncRequestControls();
    void this.updateCurrentSessionStatus("running", false);
    try {
      this.setStatus(this.t("repairRunning"));
      const profile = this.plugin.activeApiProfile();
      if (!profile.apiUrl || !profile.apiKey || !profile.model) {
        this.addMessage("assistant", this.t("repairNoApi"));
        this.setStatus(this.t("callFailed"));
        await this.finishCurrentSessionStatus("failed", true, request);
        return;
      }

      const probe = await withTimeout(this.probeBasicChat(profile), MODEL_CALL_TIMEOUT_MS, "basic chat repair timed out");
      if (request.signal.aborted || !this.isCurrentRequest(request)) return;
      const changes = await this.applyBasicChatRepairSettings(probe.mode);
      const changeText = changes.length ? changes.join("；") : this.t("repairNoSettingChanges");
      this.addMessage("assistant", this.t("repairSuccess", {
        apiMode: probe.mode,
        model: this.plugin.activeApiProfile().model,
        changes: changeText
      }));
      this.setStatus(this.t("done"));
      await this.finishCurrentSessionStatus("completed", true, request);
    } catch (error) {
      if (request.signal.aborted || !this.isCurrentRequest(request)) {
        if (!this.activeRequest || this.isCurrentRequest(request)) {
          this.setStatus(this.t("stopped"));
          await this.finishCurrentSessionStatus("idle", false, request);
        }
        return;
      }
      const reason = error instanceof Error ? error.message : String(error);
      this.addMessage("assistant", this.t("repairFailed", { reason }));
      this.setStatus(this.t("callFailed"));
      await this.finishCurrentSessionStatus("failed", true, request);
    } finally {
      if (this.isCurrentRequest(request)) this.clearRequest(request);
      this.syncRequestControls();
      this.renderMessages();
      if (this.drainQueueAfterRequest) void this.drainQueuedPrompts();
    }
  }

  private async probeBasicChat(profile: ApiProfile): Promise<{ mode: ApiMode; text: string }> {
    const endpoint = normalizeApiUrl(profile.apiUrl);
    const system = "You are Cancip's repair probe. Reply with OK only.";
    const inputText = "Reply with OK only.";
    const order: ApiMode[] = profile.apiMode === "responses" ? ["responses", "compatible"] : ["compatible", "responses"];
    const errors: string[] = [];
    for (const mode of order) {
      try {
        const text = mode === "responses"
          ? await this.callResponsesApi(profile, endpoint.responsesUrl, system, inputText)
          : await this.callCompatibleApi(profile, endpoint.chatUrl, system, inputText);
        return { mode, text };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        errors.push(`${mode}: ${reason}`);
      }
    }
    throw new Error(errors.join("; "));
  }

  private async applyBasicChatRepairSettings(apiMode: ApiMode): Promise<string[]> {
    const changes: string[] = [];
    if (this.plugin.activeApiProfile().apiMode !== apiMode) {
      await this.plugin.updateActiveApiProfile({ apiMode });
      changes.push(`apiMode=${apiMode}`);
    }
    const settings = this.plugin.settings;
    if (settings.useVaultSearchByDefault) {
      settings.useVaultSearchByDefault = false;
      changes.push("useVaultSearchByDefault=false");
    }
    if (settings.codexMemoryAutoSearch) {
      settings.codexMemoryAutoSearch = false;
      changes.push("codexMemoryAutoSearch=false");
    }
    if (!settings.includeCoreMemory) {
      settings.includeCoreMemory = true;
      changes.push("includeCoreMemory=true");
    }
    if (!settings.memoryFolder.trim()) {
      settings.memoryFolder = DEFAULT_MEMORY_FOLDER;
      changes.push(`memoryFolder=${DEFAULT_MEMORY_FOLDER}`);
    }
    if (changes.length) await this.plugin.saveSettings();
    return changes;
  }

  private addMessage(role: ChatRole, content: unknown): ChatMessage {
    const message = {
      id: crypto.randomUUID(),
      role,
      content: ensureDisplayText(content),
      createdAt: Date.now()
    };
    this.messages.push(message);
    this.syncSessionChrome();
    void this.recordSessionEvent({
      kind: "message.add",
      messageId: message.id,
      role,
      detail: messageOutlineText(message.content) || message.content
    });
    void this.saveCurrentSession();
    return message;
  }

  private resetMessageAutoFollow(): void {
    this.userPinnedScroll = false;
    this.autoFollowMessages = true;
    this.userInteractingWithMessages = false;
    this.pendingMessageRender = false;
    if (this.messageInteractionIdleTimer !== null) {
      window.clearTimeout(this.messageInteractionIdleTimer);
      this.messageInteractionIdleTimer = null;
    }
  }

  private resolveTaskGoal(rawPrompt: string): string {
    if (!isContinuePrompt(rawPrompt)) return rawPrompt;
    return this.previousActionableUserPrompt() || "上一项未完成任务";
  }

  private modelPromptForTurn(rawPrompt: string, taskGoal: string): string {
    if (!isContinuePrompt(rawPrompt) || taskGoal === rawPrompt) return rawPrompt;
    const workingState = this.sessionWorkingState();
    return [
      rawPrompt,
      "",
      "Continue the previous user task below. Do not treat the word \"continue\" as the task itself.",
      `Previous task: ${taskGoal}`,
      workingState ? `Latest session state:\n${workingState}` : "",
      "Use the latest visible tool results and session state; do not restart with a broad search unless the target is unknown."
    ].filter(Boolean).join("\n");
  }

  private previousActionableUserPrompt(): string {
    for (let index = this.messages.length - 1; index >= 0; index -= 1) {
      const message = this.messages[index];
      if (message.role !== "user") continue;
      const text = message.content.trim();
      if (!text || isContinuePrompt(text) || isTrivialChatPrompt(text)) continue;
      return text;
    }
    return "";
  }

  private addProgressStep(summary: string, detail = "", status = this.t("toolRunExecuting")): ChatMessage {
    const body = this.formatProgressStep(summary, detail, status, 0);
    const message = this.addMessage("assistant", body);
    this.startProgressStepTimer(message, summary, detail, status);
    this.renderMessages();
    return message;
  }

  private updateProgressStep(message: ChatMessage | null | undefined, summary: string, detail = "", status = this.t("toolRunExecuted")): void {
    if (!message) return;
    this.stopProgressStepTimer(message.id);
    const elapsed = Date.now() - message.createdAt;
    message.content = this.formatProgressStep(summary, detail, status, elapsed);
    void this.saveCurrentSession();
    this.renderMessages();
  }

  private startProgressStepTimer(message: ChatMessage, summary: string, detail: string, status: string): void {
    this.stopProgressStepTimer(message.id);
    const tick = () => {
      const current = this.messages.find((item) => item.id === message.id);
      if (!current) {
        this.stopProgressStepTimer(message.id);
        return;
      }
      current.content = this.formatProgressStep(summary, detail, status, Date.now() - current.createdAt);
      this.renderMessages();
    };
    tick();
    this.progressStepTimers.set(message.id, window.setInterval(tick, 1000));
  }

  private stopProgressStepTimer(messageId: string): void {
    const timer = this.progressStepTimers.get(messageId);
    if (timer !== undefined) window.clearInterval(timer);
    this.progressStepTimers.delete(messageId);
  }

  private clearLiveTimers(): void {
    for (const timer of this.progressStepTimers.values()) window.clearInterval(timer);
    for (const timer of this.toolRunTimers.values()) window.clearInterval(timer);
    this.progressStepTimers.clear();
    this.toolRunTimers.clear();
  }

  private formatProgressStep(summary: string, detail: string, status: string, elapsedMs?: number): string {
    const elapsed = typeof elapsedMs === "number" ? this.t("elapsedSuffix", { elapsed: formatElapsed(elapsedMs) }) : "";
    const headline = [this.t("progressStep", { status, summary }), elapsed].filter(Boolean).join(" · ");
    const trimmed = detail.trim();
    if (!trimmed) return `${PROGRESS_STEP_MARKER}\n${PROCESS_MESSAGE_MARKER}\n${headline}`;
    return [
      PROGRESS_STEP_MARKER,
      PROCESS_MESSAGE_MARKER,
      headline,
      "",
      "<details>",
      `<summary>${this.t("progressDetails")}</summary>`,
      "",
      "```text",
      trimContext(redactSensitiveText(trimmed), 4000),
      "```",
      "</details>"
    ].join("\n");
  }

  async runAutomationPrompt(task: AutomationTask): Promise<string> {
    const startedAt = Date.now();
    if (this.activeRequest) throw new Error(this.t("todoRequestRunning"));
    const prompt = `${this.t("automationTask")}: ${task.title}\n\n${task.prompt}`;
    const userMessage = this.addMessage("user", prompt);
    this.renderMessages();
    this.scrollMessagesToBottom(false);

    const contextStep = this.addProgressStep(this.t("preparingContext"));
    const context = await this.buildContext(task.prompt);
    this.updateProgressStep(contextStep, this.t("preparingContext"), `${this.t("obsidianContext")}: ${context.contextText.length} chars\n${this.t("hitCount", { count: context.searchHits.length })}`);
    userMessage.sources = context.searchHits;
    userMessage.contextText = context.contextText;
    userMessage.systemPrompt = context.system;
    userMessage.mode = this.mode;
    userMessage.accessMode = this.plugin.settings.accessMode;
    userMessage.apiProfile = this.redactedApiProfile(this.plugin.activeApiProfile());
    this.renderSources(context.searchHits);

    const activeProfile = this.plugin.activeApiProfile();
    if (!activeProfile.apiUrl || !activeProfile.apiKey || !activeProfile.model) {
      const fallback = this.localFallback(task.prompt, context.searchHits, this.t("missingApi"));
      this.addMessage("assistant", fallback);
      this.renderMessages();
      return fallback;
    }

    const request = new AbortController();
    this.activeRequest = request;
    this.syncRequestControls();
    void this.updateCurrentSessionStatus("running", false);
    this.setStatus(this.t("automationStarted", { title: task.title }));
    try {
      const generationStep = this.addProgressStep(this.t("automationStarted", { title: task.title }));
      const answer = await this.callModel(task.prompt, context);
      if (request.signal.aborted || !this.isCurrentRequest(request)) return this.t("stopped");
      this.updateProgressStep(generationStep, this.t("automationStarted", { title: task.title }), this.t("done"));
      const assistantMessage = this.addMessage("assistant", answer);
      this.renderMessages();
      const actionReport = await this.handleActionBlocks(answer, assistantMessage);
      let result = answer;
      if (actionReport) {
        this.addMessage("assistant", actionReport.report);
        this.renderMessages();
        result = `${result}\n\n${actionReport.report}`;
        const finalReport = await this.continueAfterToolRuns(context, actionReport, request, task.prompt);
        this.ensureFinalConclusion(finalReport ?? actionReport, startedAt, false, task.prompt);
      } else {
        this.ensurePlainFinalConclusion(startedAt);
      }
      this.setStatus(this.t("automationDone", { title: task.title }));
      await this.finishCurrentSessionStatus("completed", true, request);
      return result;
    } catch (error) {
      await this.finishCurrentSessionStatus("failed", true, request);
      throw error;
    } finally {
      if (this.isCurrentRequest(request)) this.clearRequest(request);
      this.syncRequestControls();
      this.renderMessages();
    }
  }

  async runAutomationCommand(task: AutomationTask): Promise<string> {
    if (!task.command) throw new Error("automation command is empty");
    const result = await this.executeCommandAction(task.command, task.args ?? {});
    this.addMessage("assistant", `${this.t("automationTask")}: ${task.title}\n\n${result}`);
    this.renderMessages();
    return result;
  }

  private async saveCurrentSession(): Promise<void> {
    try {
      const adapter = this.app.vault.adapter;
      await ensureFolder(adapter, SESSION_HISTORY_DIR);
      const now = new Date();
      const path = `${SESSION_HISTORY_DIR}/${this.sessionId}.json`;
      const snapshot = this.sessionExportSnapshot(now);
      await adapter.write(path, `${JSON.stringify(snapshot, null, 2)}\n`);
      const previous = (await this.readSessionHistoryIndex()).find((entry) => entry.id === this.sessionId);
      const currentTerminal = this.currentSessionStatus === "completed" || this.currentSessionStatus === "failed";
      const status = currentTerminal
        ? this.currentSessionStatus
        : this.activeRequest
          ? "running"
          : previous?.status ?? this.currentSessionStatus;
      const completedNotice = currentTerminal
        ? this.currentSessionCompletedNotice
        : this.activeRequest
          ? false
          : previous?.completedNotice ?? this.currentSessionCompletedNotice;
      await this.upsertSessionHistoryIndex({
        id: this.sessionId,
        title: this.sessionTitle(),
        createdAt: this.sessionCreatedAt,
        updatedAt: now.toISOString(),
        messageCount: this.messages.length,
        mode: this.mode,
        model: this.plugin.activeApiProfile().model,
        status,
        completedNotice,
        path
      });
      void this.recordSessionEvent({ kind: "session.save", path, messageCount: this.messages.length, status, model: this.plugin.activeApiProfile().model });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn("Cancip session save failed", error);
      void this.recordSessionEvent({ kind: "session.save_failed", detail: reason });
      this.setStatus(this.t("sessionSaveFailed", { reason }));
    }
  }

  private async recordSessionEvent(event: SessionEvent): Promise<void> {
    try {
      const payload: SessionEvent = {
        ...event,
        at: event.at ?? new Date().toISOString(),
        sessionId: event.sessionId ?? this.sessionId,
        title: event.title ?? this.sessionTitle(),
        messageCount: event.messageCount ?? this.messages.length,
        mode: event.mode ?? this.mode,
        model: event.model ?? this.plugin.activeApiProfile().model,
        pluginVersion: event.pluginVersion ?? this.plugin.manifest.version
      };
      await recordCancipSessionEvent(this.app.vault.adapter, payload);
    } catch (error) {
      console.warn("Cancip session event write failed", error);
    }
  }

  private async ensureCurrentSessionRecord(): Promise<void> {
    try {
      await this.recordSessionEvent({ kind: "session.open", status: this.currentSessionStatus });
      await this.saveCurrentSession();
    } catch (error) {
      console.warn("Cancip session bootstrap save failed", error);
    }
  }

  private async finishCurrentSessionStatus(
    status: NonNullable<SessionHistoryEntry["status"]>,
    completedNotice: boolean,
    request: AbortController
  ): Promise<void> {
    const requestSessionId = this.requestSessionId(request);
    if (!this.hasRequest(request) && !request.signal.aborted) return;
    this.clearRequest(request);
    this.syncRequestControls();
    this.currentSessionStatus = status;
    this.currentSessionCompletedNotice = completedNotice;
    if (requestSessionId && requestSessionId !== this.sessionId) {
      void this.recordSessionEvent({ kind: "session.status", sessionId: requestSessionId, status, detail: completedNotice ? "completedNotice=true" : "completedNotice=false" });
      await this.saveDetachedSessionStatus(requestSessionId, status, completedNotice);
      return;
    }
    void this.recordSessionEvent({ kind: "session.status", status, detail: completedNotice ? "completedNotice=true" : "completedNotice=false" });
    await this.saveCurrentSession();
    await this.updateCurrentSessionStatus(status, completedNotice);
  }

  private async saveDetachedSessionStatus(
    sessionId: string,
    status: NonNullable<SessionHistoryEntry["status"]>,
    completedNotice: boolean
  ): Promise<void> {
    const adapter = this.app.vault.adapter;
    const path = `${SESSION_HISTORY_DIR}/${sessionId}.json`;
    if (!(await adapter.exists(path))) return;
    const raw = await adapter.read(path);
    const snapshot = JSON.parse(raw) as Record<string, unknown>;
    snapshot.status = status;
    snapshot.completedNotice = completedNotice;
    snapshot.updatedAt = new Date().toISOString();
    await adapter.write(path, `${JSON.stringify(snapshot, null, 2)}\n`);
    const index = await this.readSessionHistoryIndex();
    const existing = index.find((entry) => entry.id === sessionId);
    await this.upsertSessionHistoryIndex({
      id: sessionId,
      title: existing?.title ?? sessionId,
      createdAt: existing?.createdAt ?? String(snapshot.sessionCreatedAt ?? new Date().toISOString()),
      updatedAt: String(snapshot.updatedAt),
      messageCount: Array.isArray(snapshot.messages) ? snapshot.messages.length : existing?.messageCount ?? 0,
      mode: existing?.mode ?? "ask",
      model: this.plugin.activeApiProfile().model,
      status,
      completedNotice,
      path
    });
  }

  private async completeDetachedApiResponse(
    sessionId: string,
    rawPrompt: string,
    answer: string,
    startedAt: number,
    suppressToolActions: boolean
  ): Promise<void> {
    const adapter = this.app.vault.adapter;
    const path = `${SESSION_HISTORY_DIR}/${sessionId}.json`;
    if (!(await adapter.exists(path))) return;
    const raw = await adapter.read(path);
    const snapshot = JSON.parse(raw) as Record<string, unknown>;
    const messages = Array.isArray(snapshot.messages) ? snapshot.messages.filter(isRecord) : [];
    const now = Date.now();
    const generation = [...messages].reverse().find((message) => typeof message.content === "string" && message.content.includes(this.t("generating")));
    if (generation && typeof generation.content === "string") {
      generation.content = this.formatProgressStep(this.t("generating"), this.t("done"), this.t("toolRunExecuted"), now - timestampMs(generation.createdAt, now));
      generation.createdAt = now;
    }
    const suppressedActions = suppressToolActions && extractCancipActions(answer).length > 0;
    const visibleAnswer = suppressToolActions ? removeCancipActionBlocks(answer).trim() : answer.trim();
    const isEmptyApiReply = !visibleAnswer;
    const assistantContent = this.t("finalConclusionFallback", {
      summary: `${visibleAnswer || (suppressedActions ? this.t("emptyApiReplyWithSuppressedTools") : this.t("emptyApiReply"))}\n\n${this.t("totalElapsed", { elapsed: formatElapsed(Date.now() - startedAt) })}`
    });
    messages.push({
      id: crypto.randomUUID(),
      role: "assistant",
      content: assistantContent,
      createdAt: now
    });
    snapshot.messages = messages;
    snapshot.status = isEmptyApiReply ? "failed" : "completed";
    snapshot.completedNotice = true;
    snapshot.updatedAt = new Date().toISOString();
    await adapter.write(path, `${JSON.stringify(snapshot, null, 2)}\n`);
    await this.upsertSessionHistoryIndex({
      id: sessionId,
      title: typeof snapshot.title === "string" && snapshot.title ? snapshot.title : trimContext(rawPrompt, 40),
      createdAt: typeof snapshot.sessionCreatedAt === "string" ? snapshot.sessionCreatedAt : new Date(startedAt).toISOString(),
      updatedAt: String(snapshot.updatedAt),
      messageCount: messages.length,
      mode: isComposerMode(snapshot.mode) ? snapshot.mode : "ask",
      model: this.plugin.activeApiProfile().model,
      status: isEmptyApiReply ? "failed" : "completed",
      completedNotice: true,
      path
    });
    void this.recordSessionEvent({
      kind: "session.status",
      sessionId,
      status: isEmptyApiReply ? "failed" : "completed",
      detail: isEmptyApiReply ? "detached api response failed: empty reply" : "detached api response completed"
    });
  }

  private async upsertSessionHistoryIndex(entry: SessionHistoryEntry): Promise<void> {
    const index = (await this.readSessionHistoryIndex()).filter((item) => !item.eventOnly);
    const entries = [entry, ...index.filter((item) => item.id !== entry.id)]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, SESSION_HISTORY_LIMIT);
    const payload = {
      schemaVersion: SESSION_HISTORY_SCHEMA_VERSION,
      entries
    };
    await this.app.vault.adapter.write(SESSION_HISTORY_INDEX_PATH, `${JSON.stringify(payload, null, 2)}\n`);
  }

  private async updateCurrentSessionStatus(status: NonNullable<SessionHistoryEntry["status"]>, completedNotice: boolean): Promise<void> {
    try {
      this.currentSessionStatus = status;
      this.currentSessionCompletedNotice = completedNotice;
      const index = await this.readSessionHistoryIndex();
      const existing = index.find((entry) => entry.id === this.sessionId);
      const now = new Date().toISOString();
      await this.upsertSessionHistoryIndex({
        id: this.sessionId,
        title: this.sessionTitle(),
        createdAt: this.sessionCreatedAt,
        updatedAt: now,
        messageCount: this.messages.length,
        mode: this.mode,
        model: this.plugin.activeApiProfile().model,
        status,
        completedNotice,
        path: existing?.path ?? `${SESSION_HISTORY_DIR}/${this.sessionId}.json`
      });
      this.syncSessionChrome();
      if (this.activeHeaderMenu === "history" && this.headerMenuEl && !this.headerMenuEl.hasClass("is-hidden")) {
        void this.openHistoryMenu();
      }
      if (this.activeHeaderMenu === "events" && this.headerMenuEl && !this.headerMenuEl.hasClass("is-hidden")) {
        void this.openSessionEventsMenu();
      }
    } catch (error) {
      console.warn("Cancip session status update failed", error);
    }
  }

  private async readSessionHistoryIndex(): Promise<SessionHistoryEntry[]> {
    try {
      const adapter = this.app.vault.adapter;
      let entries: SessionHistoryEntry[] = [];
      if (await adapter.exists(SESSION_HISTORY_INDEX_PATH)) {
        const raw = await adapter.read(SESSION_HISTORY_INDEX_PATH);
        const parsed = JSON.parse(raw) as unknown;
        if (isRecord(parsed) && Array.isArray(parsed.entries)) {
          entries = parsed.entries
            .filter(isRecord)
            .map((item): SessionHistoryEntry | null => {
              const id = typeof item.id === "string" ? item.id : "";
              const path = typeof item.path === "string" ? item.path : "";
              if (!id || !path) return null;
              return {
                id,
                title: typeof item.title === "string" ? item.title : id,
                createdAt: typeof item.createdAt === "string" ? item.createdAt : "",
                updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : "",
                messageCount: typeof item.messageCount === "number" ? item.messageCount : 0,
                mode: isComposerMode(item.mode) ? item.mode : "ask",
                model: typeof item.model === "string" ? item.model : "",
                status: isSessionStatus(item.status) ? item.status : "idle",
                completedNotice: typeof item.completedNotice === "boolean" ? item.completedNotice : false,
                path
              };
            })
            .filter((item): item is SessionHistoryEntry => item !== null);
        }
      }
      return await this.mergeEventOnlySessionHistory(entries);
    } catch (error) {
      console.warn("Cancip session history index read failed", error);
      return [];
    }
  }

  private async mergeEventOnlySessionHistory(entries: SessionHistoryEntry[]): Promise<SessionHistoryEntry[]> {
    const seen = new Set(entries.map((entry) => entry.id));
    const events = await this.readSessionEvents(200);
    const bySession = new Map<string, SessionEventView[]>();
    for (const event of events) {
      if (!event.sessionId || seen.has(event.sessionId)) continue;
      const current = bySession.get(event.sessionId) ?? [];
      current.push(event);
      bySession.set(event.sessionId, current);
    }
    const recovered: SessionHistoryEntry[] = [];
    for (const [sessionId, sessionEvents] of bySession) {
      const first = sessionEvents[0];
      const last = sessionEvents.at(-1) ?? first;
      const path = `${SESSION_HISTORY_DIR}/${sessionId}.json`;
      recovered.push({
        id: sessionId,
        title: last.title || first.title || sessionId,
        createdAt: first.at,
        updatedAt: last.at,
        messageCount: Math.max(...sessionEvents.map((event) => event.messageCount ?? 0), 0),
        mode: isComposerMode(last.mode) ? last.mode : "ask",
        model: last.model ?? "",
        status: isSessionStatus(last.status) ? last.status : "idle",
        completedNotice: false,
        path,
        eventOnly: !(await this.app.vault.adapter.exists(path))
      });
    }
    return [...entries, ...recovered]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, SESSION_HISTORY_LIMIT);
  }

  private async readSessionEvents(limit = 50, sessionId?: string): Promise<SessionEventView[]> {
    try {
      const adapter = this.app.vault.adapter;
      if (!(await adapter.exists(SESSION_EVENTS_PATH))) return [];
      const raw = await adapter.read(SESSION_EVENTS_PATH);
      const events: SessionEventView[] = [];
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed) as SessionEvent;
          if (!parsed.kind) continue;
          if (sessionId && parsed.sessionId !== sessionId) continue;
          events.push({
            ...parsed,
            at: parsed.at ?? "",
            kind: parsed.kind
          });
        } catch {
          // Ignore malformed tail lines; full session JSON remains the transcript source.
        }
      }
      return events.slice(-Math.max(1, limit));
    } catch (error) {
      console.warn("Cancip session events read failed", error);
      return [];
    }
  }

  private formatSessionEvents(events: SessionEventView[], limit = 50): string {
    if (!events.length) return this.t("sessionEventsEmpty");
    return events
      .slice(-Math.max(1, limit))
      .map(formatSessionEventLine)
      .join("\n");
  }

  private sessionTitle(): string {
    const firstUser = this.messages.find((message) => message.role === "user");
    const fallback = this.t("untitledSession");
    const base = trimContext(firstUser?.content ?? fallback, 72).replace(/\s+/g, " ").trim();
    return base || fallback;
  }

  private syncSessionChrome(): void {
    if (this.headerSessionIdEl) {
      this.headerSessionIdEl.setText(`${this.t("sessionIdLabel")} ${this.shortSessionId()}`);
      this.headerSessionIdEl.setAttr("title", this.sessionId);
    }
    if (this.headerSessionTitleEl) {
      this.headerSessionTitleEl.setText(this.sessionTitle());
      this.headerSessionTitleEl.setAttr("title", this.sessionTitle());
    }
  }

  private shortSessionId(): string {
    return this.sessionId.replace(/^session-/, "").replace(/Z$/, "").slice(0, 19);
  }

  private async exportSession(): Promise<void> {
    if (!this.messages.length) {
      new Notice(this.t("exportNoMessages"));
      return;
    }

    try {
      const adapter = this.app.vault.adapter;
      await ensureFolder(adapter, SESSION_EXPORT_DIR);
      const exportedAt = new Date();
      const id = sessionExportId(exportedAt);
      const basePath = `${SESSION_EXPORT_DIR}/${id}`;
      const snapshot = this.sessionExportSnapshot(exportedAt);
      await adapter.write(`${basePath}.md`, this.sessionExportMarkdown(snapshot));
      await adapter.write(`${basePath}.json`, `${JSON.stringify(snapshot, null, 2)}\n`);
      new Notice(this.t("exportDone", { path: `${basePath}.md` }));
      this.setStatus(this.t("exportDone", { path: `${basePath}.md` }));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn("Cancip session export failed", error);
      new Notice(this.t("exportFailed", { reason }));
      this.setStatus(this.t("exportFailed", { reason }));
    }
  }

  private sessionExportSnapshot(exportedAt: Date): Record<string, unknown> {
    const activeProfile = this.plugin.activeApiProfile();
    return {
      schemaVersion: SESSION_EXPORT_SCHEMA_VERSION,
      plugin: PLUGIN_NAME,
      sessionId: this.sessionId,
      sessionCreatedAt: this.sessionCreatedAt,
      exportedAt: exportedAt.toISOString(),
      mode: this.exportModeId(this.mode),
      accessMode: this.plugin.settings.accessMode,
      apiProfile: {
        id: activeProfile.id,
        name: activeProfile.name,
        apiMode: activeProfile.apiMode,
        model: activeProfile.model,
        hasApiUrl: Boolean(activeProfile.apiUrl),
        hasApiKey: Boolean(activeProfile.apiKey)
      },
      settings: {
        language: this.plugin.settings.language,
        includeCurrentFile: this.plugin.settings.includeCurrentFile,
        includeCoreMemory: this.plugin.settings.includeCoreMemory,
        maxCoreMemoryFiles: this.plugin.settings.maxCoreMemoryFiles,
        codexMemoryAutoSearch: this.plugin.settings.codexMemoryAutoSearch,
        codexMemoryMaxFiles: this.plugin.settings.codexMemoryMaxFiles,
        codexMemoryMaxChars: this.plugin.settings.codexMemoryMaxChars,
        useVaultSearchByDefault: this.plugin.settings.useVaultSearchByDefault,
        maxContextFiles: this.plugin.settings.maxContextFiles,
        memoryFolder: this.plugin.settings.memoryFolder,
        commandBusEnabled: this.plugin.settings.commandBusEnabled,
        executeObsidianCommands: this.plugin.settings.executeObsidianCommands,
        githubCommandsEnabled: this.plugin.settings.githubCommandsEnabled,
    githubApiBaseUrl: this.plugin.settings.githubApiBaseUrl,
    githubDownloadBaseUrl: this.plugin.settings.githubDownloadBaseUrl,
    githubOwner: this.plugin.settings.githubOwner,
    githubRepo: this.plugin.settings.githubRepo,
    hasGithubToken: Boolean(this.plugin.settings.githubToken),
    autoContinueAfterTools: this.plugin.settings.autoContinueAfterTools,
    maxToolIterations: this.plugin.settings.maxToolIterations,
    maxRecentTranscriptMessages: this.plugin.settings.maxRecentTranscriptMessages,
        maxMentionResults: this.plugin.settings.maxMentionResults,
        maxMentionFolderFiles: this.plugin.settings.maxMentionFolderFiles,
        maxFileContextChars: this.plugin.settings.maxFileContextChars,
        maxFolderFileContextChars: this.plugin.settings.maxFolderFileContextChars,
        automationsEnabled: this.plugin.settings.automationsEnabled,
        automationCheckMinutes: this.plugin.settings.automationCheckMinutes
      },
      draftContext: this.draftContext.map((item) => ({
        id: item.id,
        label: item.label,
        content: item.content,
        path: item.path,
        source: item.source
      })),
      manualTodos: this.manualTodos.map((todo) => ({
        id: todo.id,
        text: todo.text,
        done: todo.done,
        createdAt: todo.createdAt
      })),
      messages: this.messages.map((message) => ({
        id: message.id,
        role: message.role,
        createdAt: new Date(message.createdAt).toISOString(),
        content: redactSensitiveText(message.content),
        sources: message.sources ?? [],
        mode: this.exportModeId(message.mode),
        accessMode: message.accessMode,
        apiProfile: message.apiProfile,
        systemPrompt: message.systemPrompt ? redactSensitiveText(message.systemPrompt) : undefined,
        contextText: message.contextText ? redactSensitiveText(message.contextText) : undefined,
        toolRuns: (message.toolRuns ?? []).map((run) => ({
          ...run,
          result: run.result ? redactSensitiveText(run.result) : undefined,
          error: run.error ? redactSensitiveText(run.error) : undefined
        }))
      }))
    };
  }

  private redactedApiProfile(profile: ApiProfile): ChatMessage["apiProfile"] {
    return {
      id: profile.id,
      name: profile.name,
      apiMode: profile.apiMode,
      model: profile.model,
      hasApiUrl: Boolean(profile.apiUrl),
      hasApiKey: Boolean(profile.apiKey)
    };
  }

  private sessionExportMarkdown(snapshot: Record<string, unknown>): string {
    const messages = Array.isArray(snapshot.messages) ? snapshot.messages : [];
    const draftContext = Array.isArray(snapshot.draftContext) ? snapshot.draftContext : [];
    const manualTodos = Array.isArray(snapshot.manualTodos) ? snapshot.manualTodos : [];
    const apiProfile = isRecord(snapshot.apiProfile) ? snapshot.apiProfile : {};
    const settings = isRecord(snapshot.settings) ? snapshot.settings : {};
    const lines: string[] = [
      "# Cancip Session Export",
      "",
      "## Metadata",
      "",
      `- Exported: ${String(snapshot.exportedAt ?? "")}`,
      `- Mode: ${this.exportModeLabel(snapshot.mode)}`,
      `- Access mode: ${String(snapshot.accessMode ?? "")}`,
      `- API profile: ${String(apiProfile.name ?? "")} (${String(apiProfile.id ?? "")})`,
      `- API mode: ${String(apiProfile.apiMode ?? "")}`,
      `- Model: ${String(apiProfile.model ?? "")}`,
      `- API URL configured: ${String(apiProfile.hasApiUrl ?? false)}`,
      `- API key configured: ${String(apiProfile.hasApiKey ?? false)}`,
      `- Memory folder: ${String(settings.memoryFolder ?? "")}`,
      `- Messages: ${messages.length}`,
      ""
    ];

    if (draftContext.length) {
      lines.push("## Draft Context", "");
      for (const item of draftContext) {
        if (!isRecord(item)) continue;
        lines.push(`### ${String(item.label ?? "")}`, "", "```text", String(item.content ?? ""), "```", "");
      }
    }

    if (this.plugin.settings.exportMarkdownManualTodos && manualTodos.length) {
      lines.push("## Manual Todos", "");
      for (const item of manualTodos) {
        if (!isRecord(item)) continue;
        const checked = item.done ? "x" : " ";
        lines.push(`- [${checked}] ${String(item.text ?? "")}`);
      }
      lines.push("");
    }

    lines.push("## Messages", "");
    for (const item of messages) {
      if (!isRecord(item)) continue;
      const role = String(item.role ?? "");
      const createdAt = String(item.createdAt ?? "");
      const content = String(item.content ?? "");
      const display = role === "assistant" ? prepareMessageDisplay(content) : emptyMessageDisplay(content);
      lines.push(`### ${role} · ${createdAt}`, "", redactSensitiveText(display.visibleContent), "");
      if (display.hiddenToolBlocks.length) {
        lines.push("<details>", `<summary>${this.t("toolJsonDetails")} (${display.hiddenToolBlocks.length})</summary>`, "");
        for (const block of display.hiddenToolBlocks) {
          lines.push(`#### ${block.title}`, "", "```text", redactSensitiveText(block.content), "```", "");
        }
        lines.push("</details>", "");
      }
      const systemPrompt = String(item.systemPrompt ?? "").trim();
      const contextText = String(item.contextText ?? "").trim();
      if (this.plugin.settings.exportMarkdownContextSnapshots && (systemPrompt || contextText)) {
        lines.push("<details>", "<summary>Model context snapshot</summary>", "");
        if (systemPrompt) {
          lines.push("#### System prompt", "", "```text", redactSensitiveText(systemPrompt), "```", "");
        }
        if (contextText) {
          lines.push("#### Context text", "", "```text", redactSensitiveText(contextText), "```", "");
        }
        lines.push("</details>", "");
      }
      if (Array.isArray(item.sources) && item.sources.length) {
        lines.push("#### Sources", "");
        for (const source of item.sources) {
          if (!isRecord(source)) continue;
          lines.push(`- ${String(source.path ?? "")} — ${String(source.title ?? "")}`);
          const excerpt = String(source.excerpt ?? "").trim();
          if (excerpt) lines.push(`  ${excerpt}`);
        }
        lines.push("");
      }
      if (Array.isArray(item.toolRuns) && item.toolRuns.length) {
        lines.push("#### Tool runs", "");
        for (const run of item.toolRuns) {
          if (!isRecord(run)) continue;
          lines.push(`- ${String(run.status ?? "")}: ${String(run.summary ?? "")}`);
          const result = redactSensitiveText(String(run.result ?? run.error ?? "").trim());
          if (result) lines.push("  ```text", result, "  ```");
        }
        lines.push("");
      }
    }

    return `${lines.join("\n").trimEnd()}\n`;
  }

  private exportModeLabel(mode: unknown): string {
    if (mode === "ask") return this.t("modeAsk");
    if (mode === "search") return this.t("modeSearch");
    if (mode === "plan") return this.t("modePlan");
    if (mode === "edit") return this.t("modeEdit");
    return String(mode ?? "");
  }

  private exportModeId(mode: unknown): string {
    if (mode === "ask") return "cancip";
    if (mode === "search" || mode === "plan" || mode === "edit") return mode;
    return String(mode ?? "");
  }

  private async buildContext(prompt: string): Promise<{
    system: string;
    contextText: string;
    searchHits: SearchHit[];
  }> {
    const parts: string[] = [];
    const searchHits: SearchHit[] = [];
    const settings = this.plugin.settings;
    const lightContext = shouldSuppressToolActionsForPrompt(prompt);
    const implementationContext = shouldExpectToolActionForPrompt(prompt);

    const workingState = this.sessionWorkingState();
    if (workingState) parts.push(`## Current session working state\n${workingState}`);

    if (settings.includeCoreMemory && !lightContext) {
      const memory = await this.safeContextStep(
        this.t("coreMemory"),
        () => this.readMemoryFolder(
          implementationContext ? 1200 : settings.maxFolderFileContextChars,
          implementationContext ? Math.min(1, settings.maxCoreMemoryFiles) : settings.maxCoreMemoryFiles
        ),
        "",
        CONTEXT_STEP_TIMEOUT_MS
      );
      if (memory) parts.push(`## ${this.t("coreMemory")}\n${memory}`);
    }

    if (!lightContext) {
      const experience = await this.safeContextStep(this.t("taskExperience"), () => this.readTaskExperience(prompt), "", CONTEXT_STEP_TIMEOUT_MS);
      if (experience) parts.push(`## ${this.t("taskExperience")}\n${experience}`);
    }

    if (settings.codexMemoryAutoSearch && shouldAutoSearchForPrompt(prompt)) {
      const codexMemory = await this.safeContextStep(
        this.t("codexMemory"),
        () => this.readRelevantCodexMemory(prompt),
        { text: "", hits: [] as SearchHit[] },
        CONTEXT_STEP_TIMEOUT_MS
      );
      if (codexMemory.text) {
        parts.push(`## ${this.t("codexMemory")}\n${codexMemory.text}`);
        searchHits.push(...codexMemory.hits);
      }
    }

    if (settings.includeCurrentFile && !lightContext) {
      const current = await this.safeContextStep(this.t("currentFile"), () => this.getCurrentFileContext(), null, CONTEXT_STEP_TIMEOUT_MS);
      if (current) parts.push(`## ${this.t("currentFile")}\n${current}`);
    }

    if (!lightContext || this.draftContext.length) {
      for (const item of this.draftContext) {
        parts.push(`## ${item.label}\n${item.content}`);
      }
    }

    const mentionTargets = await this.safeContextStep("@", () => this.findMentionTargets(prompt), [] as MentionTarget[], CONTEXT_STEP_TIMEOUT_MS);
    for (const target of mentionTargets) {
      const content = await this.safeContextStep(`@${target.path}`, () => this.readMentionTarget(target), "", CONTEXT_STEP_TIMEOUT_MS);
      if (!content) continue;
      parts.push(`## @${target.path}\n${content}`);
      searchHits.push({
        path: target.path,
        title: target.title,
        excerpt: `${this.t("mentionContextIncluded")} · ${target.detail}`,
        score: 0
      });
    }

    if ((settings.useVaultSearchByDefault && shouldAutoSearchForPrompt(prompt)) || this.mode === "search") {
      const hits = await this.safeContextStep(this.t("vaultSearch"), () => this.searchVault(prompt, settings.maxContextFiles), [] as SearchHit[], CONTEXT_STEP_TIMEOUT_MS);
      searchHits.push(...hits.map((hit) => ({ ...hit, excerpt: "" })));
    }

    return {
      system: this.modePrompt(),
      contextText: parts.join("\n\n---\n\n"),
      searchHits
    };
  }

  private async safeContextStep<T>(step: string, run: () => Promise<T>, fallback: T, timeoutMs: number): Promise<T> {
    try {
      return await withTimeout(run(), timeoutMs, `${step} timed out`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`Cancip context step skipped: ${step}`, error);
      this.setStatus(this.t("contextStepSkipped", { step, reason }));
      return fallback;
    }
  }

  private modePrompt(): string {
    const base = this.plugin.settings.systemPrompt || DEFAULT_SYSTEM_PROMPT;
    const languagePrompt = this.plugin.responseLanguageInstruction();
    const accessPrompt = this.plugin.settings.accessMode === "full-access" ? this.t("accessPromptFull") : this.t("accessPromptAsk");
    const toolPrompt = this.plugin.settings.commandBusEnabled
      ? this.t("toolProtocol")
      : `${this.t("toolProtocol")}\n\n${this.t("commandBusDisabledPrompt")}`;
    if (this.mode === "search") return `${base}\n\n${languagePrompt}\n\n${accessPrompt}\n\n${toolPrompt}\n\n${this.t("modePromptSearch")}`;
    if (this.mode === "plan") return `${base}\n\n${languagePrompt}\n\n${accessPrompt}\n\n${toolPrompt}\n\n${this.t("modePromptPlan")}`;
    if (this.mode === "edit") return `${base}\n\n${languagePrompt}\n\n${accessPrompt}\n\n${toolPrompt}\n\n${this.t("modePromptEdit")}`;
    return `${base}\n\n${languagePrompt}\n\n${accessPrompt}\n\n${toolPrompt}\n\n${this.t("modePromptAsk")}`;
  }

  private async callModel(prompt: string, context: { system: string; contextText: string }): Promise<string> {
    const settings = this.plugin.settings;
    const profile = this.plugin.activeApiProfile();
    const recent = this.recentTranscript();
    const inputText = `${recent ? `${this.t("recentConversation")}:\n${recent}\n\n` : ""}${this.t("userQuestion")}：${prompt}\n\n${this.t("obsidianContext")}：\n${context.contextText || this.t("none")}`;
    const endpoint = normalizeApiUrl(profile.apiUrl);
    const mode = resolveApiMode(profile.apiMode, endpoint);

    if (mode === "responses") {
      return await this.callResponsesApi(profile, endpoint.responsesUrl, context.system, inputText);
    }

    if (mode === "compatible") {
      return await this.callCompatibleApi(profile, endpoint.chatUrl, context.system, inputText);
    }

    try {
      return await this.callResponsesApi(profile, endpoint.responsesUrl, context.system, inputText);
    } catch (error) {
      const firstError = error instanceof Error ? error.message : String(error);
      try {
        return await this.callCompatibleApi(profile, endpoint.chatUrl, context.system, inputText);
      } catch (secondError) {
        const second = secondError instanceof Error ? secondError.message : String(secondError);
        throw new Error(`Responses failed: ${firstError}; compatible failed: ${second}`);
      }
    }
  }

  private async callCompatibleApi(profile: ApiProfile, url: string, system: string, inputText: string): Promise<string> {
    const settings = this.plugin.settings;
    const body = {
      model: profile.model,
      temperature: settings.temperature,
      max_tokens: settings.maxOutputTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: inputText }
      ]
    };
    const response = await this.postJson(url, body, profile.apiKey);
    const text = extractResponseText(response.json) || extractNonJsonText(response.text);
    if (text) return text;
    throw new Error(`Chat Completions returned no assistant text (${describeResponseShape(response.json)})`);
  }

  private async callResponsesApi(profile: ApiProfile, url: string, instructions: string, inputText: string): Promise<string> {
    const settings = this.plugin.settings;
    const body = {
      model: profile.model,
      instructions,
      input: inputText,
      temperature: settings.temperature,
      max_output_tokens: settings.maxOutputTokens
    };
    const response = await this.postJson(url, body, profile.apiKey);
    const text = extractResponseText(response.json) || extractNonJsonText(response.text);
    if (text) return text;
    throw new Error(`Responses returned no assistant text (${describeResponseShape(response.json)})`);
  }

  private async postJson(url: string, body: unknown, apiKey: string): Promise<{ status: number; text: string; json: unknown }> {
    const response = await requestUrl({
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body),
      throw: false
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`HTTP ${response.status}: ${response.text.slice(0, 220)}`);
    }
    return response;
  }

  private localFallback(prompt: string, hits: SearchHit[], reason: string): string {
    const fallbackHits = shouldShowLocalFallbackHits(prompt) ? hits : [];
    if (!fallbackHits.length) {
      return this.t("localNoHits", { reason });
    }
    const list = fallbackHits
      .slice(0, 5)
      .map((hit, index) => {
        const excerpt = hit.excerpt.trim();
        return excerpt ? `${index + 1}. ${hit.path}\n${excerpt}` : `${index + 1}. ${hit.path}`;
      })
      .join("\n\n");
    return this.t("localHits", { reason, prompt, list });
  }

  private async getCurrentFileContext(): Promise<string | null> {
    const file = this.app.workspace.getActiveFile();
    if (!file) return null;
    if (this.hiddenContextKeys.has(contextChipKey("current", file.path))) return null;
    const content = await this.app.vault.cachedRead(file);
    return `${file.path}\n${trimContext(content, this.plugin.settings.maxFileContextChars)}`;
  }

  private async addCurrentFileContext(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new Notice(this.t("noActiveFile"));
      return;
    }
    const content = await this.app.vault.cachedRead(file);
    this.addDraftContext(this.t("currentFileLabel", { path: file.path }), trimContext(content, this.plugin.settings.maxFileContextChars), file.path, "file");
  }

  private async addMemoryContext(): Promise<void> {
    const memory = await this.readMemoryFolder();
    if (!memory) {
      new Notice(this.t("noCoreMemory"));
      return;
    }
    const folder = this.plugin.settings.memoryFolder.trim();
    this.addDraftContext(this.t("coreMemory"), memory, folder || undefined, folder ? "folder" : "virtual");
  }

  private async readVaultTextFile(path: string): Promise<string> {
    return await this.app.vault.adapter.read(normalizeActionPath(path));
  }

  private async readMemoryFolder(perFileChars = this.plugin.settings.maxFolderFileContextChars, maxFilesOverride?: number): Promise<string> {
    const folder = this.plugin.settings.memoryFolder.trim();
    if (!folder) return "";
    const maxFiles = maxFilesOverride ?? this.plugin.settings.maxCoreMemoryFiles;
    if (maxFiles <= 0) return "";
    const normalizedFolder = normalizePath(folder);
    const files = (await this.listTextFilesInFolder(normalizedFolder))
      .filter((file) => !(this.plugin.settings.codexMemoryAutoSearch && isImportedCodexMemoryFile(file.path)))
      .filter((file) => !file.path.includes("/Codex/"))
      .sort((a, b) => memoryFilePriority(a.path) - memoryFilePriority(b.path) || a.path.localeCompare(b.path))
      .slice(0, maxFiles);
    const chunks: string[] = [];
    for (const file of files) {
      const content = await this.readVaultTextFile(file.path);
      chunks.push(`### ${file.path}\n${trimContext(content, perFileChars)}`);
    }
    return chunks.join("\n\n");
  }

  private async readRelevantCodexMemory(prompt: string): Promise<{ text: string; hits: SearchHit[] }> {
    const tokens = tokenize(prompt);
    if (!tokens.length) return { text: "", hits: [] };
    const folder = this.plugin.codexMemoryFolder();
    const prefix = folder.endsWith("/") ? folder : `${folder}/`;
    const files = (await this.listTextFilesInFolder(folder))
      .filter((file) => file.path.startsWith(prefix) && isImportedCodexMemoryFile(file.path))
      .sort((a, b) => memoryFilePriority(a.path) - memoryFilePriority(b.path) || a.path.localeCompare(b.path));
    if (!files.length) return { text: "", hits: [] };

    const scored: Array<{ file: VaultTextFile; content: string; score: number; excerpt: string }> = [];
    const startedAt = Date.now();
    for (const file of files) {
      if (Date.now() - startedAt > VAULT_SEARCH_TIME_BUDGET_MS) break;
      const content = await this.readVaultTextFile(file.path);
      const haystack = `${file.basename}\n${file.path}\n${content}`.toLowerCase();
      let score = 0;
      for (const token of tokens) {
        const escaped = escapeRegExp(token);
        const matches = haystack.match(new RegExp(escaped, "g"));
        if (matches) score += matches.length;
        if (file.basename.toLowerCase().includes(token)) score += 6;
        if (file.path.toLowerCase().includes(token)) score += 3;
      }
      if (score > 0) {
        scored.push({ file, content, score, excerpt: makeExcerpt(content, tokens) });
      }
    }

    const selected = scored
      .sort((a, b) => b.score - a.score || a.file.path.localeCompare(b.file.path))
      .slice(0, this.plugin.settings.codexMemoryMaxFiles);
    if (!selected.length) return { text: "", hits: [] };

    const perFileChars = Math.max(800, Math.floor(this.plugin.settings.codexMemoryMaxChars / selected.length));
    const text = selected
      .map((item) => `### ${item.file.path}\n${makeMemorySnippet(item.content, tokens, perFileChars)}`)
      .join("\n\n");
    return {
      text,
      hits: selected.map((item) => ({
        path: item.file.path,
        title: item.file.basename,
        excerpt: item.excerpt,
        score: item.score
      }))
    };
  }

  private async findMentionTargets(prompt: string): Promise<MentionTarget[]> {
    const tokens = extractMentionTokens(prompt);
    if (!tokens.length) return [];
    const allTargets = await this.buildMentionTargets();
    const used = new Set<string>();
    const resolved: MentionTarget[] = [];
    for (const token of tokens) {
      const target = this.resolveMentionToken(token, allTargets);
      if (!target) continue;
      const key = mentionTargetKey(target);
      if (used.has(key)) continue;
      used.add(key);
      resolved.push(target);
    }
    return resolved.slice(0, Math.max(1, Math.min(20, this.plugin.settings.maxMentionResults)));
  }

  private resolveMentionToken(mentionText: string, allTargets: MentionTarget[]): MentionTarget | null {
    const query = normalizeMentionQuery(mentionText);
    if (!query) return null;
    const lowerQuery = query.toLowerCase();
    const exact = allTargets.find((target) => {
      const path = target.path.toLowerCase();
      const title = target.title.toLowerCase();
      return (
        path === lowerQuery ||
        title === lowerQuery ||
        `${target.kind}:${path}` === lowerQuery ||
        ((target.source === "file" || target.kind === "skill") && path.replace(/\.[^.]+$/, "") === lowerQuery)
      );
    });
    if (exact) return exact;
    return this.rankMentionCandidates(query, allTargets)[0] ?? null;
  }

  private async findMentionCandidates(query: string, limit: number, targets?: MentionTarget[]): Promise<MentionTarget[]> {
    const allTargets = targets ?? await this.buildMentionTargets();
    return this.rankMentionCandidates(query, allTargets).slice(0, limit);
  }

  private rankMentionCandidates(query: string, targets: MentionTarget[]): MentionTarget[] {
    const normalizedQuery = normalizeMentionQuery(query);
    return targets
      .map((target) => ({ ...target, score: scoreMentionTarget(target, normalizedQuery) }))
      .filter((target) => target.score > 0)
      .sort((a, b) => b.score - a.score || mentionKindRank(a.kind) - mentionKindRank(b.kind) || a.path.length - b.path.length || a.path.localeCompare(b.path))
  }

  private async buildMentionTargets(): Promise<MentionTarget[]> {
    const query = this.activeMention?.query ?? "";
    const files = await this.mentionContextFiles(query);
    const currentFile = this.app.workspace.getActiveFile();
    const recentPaths = this.recentFilePaths();
    const folderCounts = new Map<string, number>();
    for (const file of files) {
      const parts = file.path.split("/").slice(0, -1);
      let current = "";
      for (const part of parts) {
        current = current ? `${current}/${part}` : part;
        folderCounts.set(current, (folderCounts.get(current) ?? 0) + 1);
      }
    }
    const targets: MentionTarget[] = [...this.buildActionMentionTargets(), ...this.buildCommandMentionTargets()];

    for (const file of files) {
      const skillLike = isSkillLikeMention(file.path, file.basename);
      const recentIndex = recentPaths.indexOf(file.path);
      const isCurrent = currentFile?.path === file.path;
      const baseScore = isCurrent ? 98 : recentIndex >= 0 ? 68 - Math.min(recentIndex, 12) * 2 : skillLike ? 58 : 0;
      targets.push({
        kind: skillLike ? "skill" : "file",
        source: "file",
        path: file.path,
        title: file.basename,
        detail: isCurrent ? `${this.t("mentionFile")} · ${this.t("currentFile")}` : skillLike ? this.t("mentionSkill") : this.t("mentionFile"),
        keywords: this.fileMentionKeywords(file),
        score: baseScore
      });
    }

    for (const [folderPath, count] of folderCounts.entries()) {
      if (!folderPath || folderPath === "/") continue;
      if (!count) continue;
      const folderName = folderPath.split("/").pop() || folderPath;
      const skillLike = isSkillLikeMention(folderPath, folderName);
      const isMemoryFolder = normalizePath(folderPath) === normalizePath(this.plugin.settings.memoryFolder || "");
      targets.push({
        kind: skillLike ? "skill" : "folder",
        source: "folder",
        path: folderPath,
        title: folderName,
        detail: skillLike ? `${this.t("mentionSkill")} · ${this.t("mentionFolderDetail", { count })}` : this.t("mentionFolderDetail", { count }),
        keywords: mentionPathKeywords(folderPath, folderName),
        score: isMemoryFolder ? 72 : skillLike ? 62 : 0
      });
    }
    return targets;
  }

  private recentFilePaths(): string[] {
    const workspace = this.app.workspace as { getLastOpenFiles?: () => string[] };
    try {
      return workspace.getLastOpenFiles?.() ?? [];
    } catch {
      return [];
    }
  }

  private fileMentionKeywords(file: VaultTextFile): string[] {
    const keywords = mentionPathKeywords(file.path, file.basename);
    const loaded = this.app.vault.getAbstractFileByPath(file.path);
    if (loaded instanceof TFile) {
      const cache = this.app.metadataCache.getFileCache(loaded);
      keywords.push(...frontmatterKeywords(cache?.frontmatter));
      keywords.push(...(cache?.tags?.map((tag) => tag.tag) ?? []));
    }
    return uniqueStrings(keywords);
  }

  private buildActionMentionTargets(): MentionTarget[] {
    const action = (path: string, title: string, detail: string, keywords: string[], score: number): MentionTarget => ({
      kind: "action",
      source: "virtual",
      path,
      title,
      detail,
      keywords,
      score
    });

    const targets = [
      action("action:cancip", this.t("modeAsk"), this.t("mentionMode"), ["cancip", "chat", "answer", "问", "提问", "回答", "聊天"], 94),
      action("action:search", this.t("modeSearch"), this.t("mentionMode"), ["search", "find", "rag", "index", "vault", "搜", "搜索", "检索", "查找", "索引"], 94),
      action("action:plan", this.t("modePlan"), this.t("mentionMode"), ["plan", "todo", "steps", "roadmap", "计划", "规划", "步骤", "方案"], 92),
      action("action:review-gate", this.t("reviewGate"), this.t("mentionAction"), ["review", "gate", "audit", "approve", "ob", "审核", "审查", "批准", "整理门", "审核门"], 91),
      action("action:plan-todos", "Plan todos", this.t("mentionAction"), ["plan", "todo", "task", "status", "计划", "待办", "任务", "状态"], 90),
      action("action:edit", this.t("modeEdit"), this.t("mentionMode"), ["edit", "patch", "rewrite", "change", "修改", "改写", "补丁", "编辑"], 92),
      action("action:add-current-file", this.t("addCurrentFile"), this.t("mentionAction"), ["current", "file", "note", "active", "当前", "当前文件", "当前笔记", "上下文"], 88),
      action("action:preview-vault-search", this.t("previewVaultSearch"), this.t("mentionAction"), ["preview", "vault", "search", "rag", "预览", "搜索", "检索", "命中"], 84),
      action("action:add-core-memory", this.t("addCoreMemory"), this.t("mentionAction"), ["memory", "core", "remember", "记忆", "核心记忆", "长期记忆"], 82),
      action("action:import-codex-memory", this.t("importCodexMemory"), this.t("mentionAction"), ["codex", "memory", "import", "core", "记忆", "导入", "核心记忆"], 83),
      action("action:automation", this.t("automationTask"), this.t("mentionAction"), ["automation", "schedule", "task", "cron", "自动化", "定时", "任务"], 82),
      action("action:rebuild-index", this.t("commandRebuildIndex"), this.t("mentionAction"), ["index", "rebuild", "refresh", "索引", "重建", "刷新"], 76),
      action("action:command-bus", this.t("commandBus"), this.t("mentionAction"), ["command", "cmd", "cli", "terminal", "execute", "命令", "终端", "执行", "接口"], 86),
      action("action:obsidian-commands", "Obsidian commands", this.t("mentionAction"), ["obsidian", "command", "plugin", "execute", "ob命令", "插件命令", "命令库"], 84),
      action("action:local-version-commit", this.t("localVersionCommit"), this.t("mentionAction"), ["commit", "version", "snapshot", "local", "git", "提交", "版本", "快照", "本地"], 80),
      action("action:daily-version-status", this.t("dailyVersionStatus"), this.t("mentionAction"), ["daily", "version", "auto", "commit", "每日", "每天", "自动", "版本"], 78),
      action("action:github", "GitHub", this.t("mentionAction"), ["github", "gh", "repo", "issue", "pr", "release", "workflow", "加速", "仓库"], 74),
      action("action:clear-context", this.t("clearContext"), this.t("mentionAction"), ["clear", "context", "reset", "清空", "上下文", "重置"], 72),
      action("action:new-chat", this.t("newChatTitle"), this.t("mentionAction"), ["new", "chat", "session", "新建", "新对话", "聊天"], 70)
    ];
    return targets.filter((target) => {
      if (!this.plugin.settings.commandBusEnabled && target.path === "action:command-bus") return false;
      if (!this.plugin.settings.executeObsidianCommands && target.path === "action:obsidian-commands") return false;
      if (!this.plugin.settings.githubCommandsEnabled && target.path === "action:github") return false;
      return true;
    });
  }

  private buildCommandMentionTargets(): MentionTarget[] {
    if (!this.plugin.settings.commandBusEnabled) return [];
    const commandTarget = (path: string, title: string, keywords: string[], score: number): MentionTarget => ({
      kind: "command",
      source: "virtual",
      path,
      title,
      detail: this.t("mentionCommand"),
      keywords,
      score
    });

    const targets: MentionTarget[] = [
      commandTarget("command:obsidian.listCommands", "obsidian.listCommands", ["command", "commands", "obsidian", "list", "cmd", "cli", "命令", "命令库", "列表"], 84),
      commandTarget("command:cancip.reviewGate", "cancip.reviewGate", ["review", "gate", "audit", "approve", "ob", "审核", "审查", "批准", "审核门"], 84),
      commandTarget("command:cancip.reviewGate.list", "cancip.reviewGate.list", ["review", "gate", "list", "audit", "审核", "审查", "审核包", "列表"], 80),
      commandTarget("command:cancip.sessionEvents", "cancip.sessionEvents", ["session", "events", "audit", "trace", "history", "log", "会话", "事件", "审计", "日志", "复盘"], 83),
      commandTarget("command:cancip.installedPlugins", "cancip.installedPlugins", ["plugin", "plugins", "installed", "enabled", "obsidian", "插件", "已安装", "启用", "清单", "列表"], 84),
      commandTarget("command:cancip.searchVault", "cancip.searchVault", ["search", "vault", "rag", "find", "搜索", "检索", "查找", "搜库"], 82),
      commandTarget("command:cancip.rebuildIndex", "cancip.rebuildIndex", ["index", "rebuild", "search", "rag", "索引", "重建", "检索"], 78),
      commandTarget("command:cancip.previewVaultSearch", "cancip.previewVaultSearch", ["search", "preview", "vault", "rag", "搜索", "预览", "检索"], 76),
      commandTarget("command:cancip.localVersionCommit", "cancip.localVersionCommit", ["commit", "version", "snapshot", "local", "git", "提交", "版本", "快照"], 76),
      commandTarget("command:cancip.importCodexMemory", "cancip.importCodexMemory", ["codex", "memory", "import", "记忆", "导入"], 78),
      commandTarget("command:cancip.automation.templates", "cancip.automation.templates", ["automation", "template", "preset", "codex", "自动化", "模板", "预设"], 79),
      commandTarget("command:cancip.automation.addTemplate", "cancip.automation.addTemplate", ["automation", "template", "preset", "add", "自动化", "模板", "添加"], 77),
      commandTarget("command:cancip.automation.list", "cancip.automation.list", ["automation", "schedule", "task", "list", "自动化", "任务", "列表"], 78),
      commandTarget("command:cancip.automation.add", "cancip.automation.add", ["automation", "schedule", "task", "add", "自动化", "任务", "新增"], 76),
      commandTarget("command:cancip.automation.run", "cancip.automation.run", ["automation", "schedule", "task", "run", "自动化", "任务", "运行"], 76),
      commandTarget("command:cancip.automation.remove", "cancip.automation.remove", ["automation", "schedule", "task", "remove", "自动化", "任务", "删除"], 72)
    ];

    if (this.plugin.settings.executeObsidianCommands) {
      targets.push(commandTarget("command:obsidian.execute", "obsidian.execute", ["command", "commands", "obsidian", "execute", "run", "cmd", "cli", "执行", "运行", "命令库"], 82));
      for (const item of this.obsidianCommandEntries()) {
        targets.push(
          commandTarget(
            `obsidian-command:${item.id}`,
            item.name || item.id,
            ["obsidian", "command", "commands", "plugin", "cmd", "cli", "ob", "命令", "命令库", "插件命令", item.id, item.name],
            44
          )
        );
      }
    }

    if (this.plugin.settings.githubCommandsEnabled) {
      targets.push(
        commandTarget("command:github.help", "github.help", ["github", "gh", "repo", "issue", "pr", "release", "workflow", "api", "仓库", "加速"], 74),
        commandTarget("command:github.status", "github.status", ["github", "gh", "status", "rate", "api", "加速", "状态"], 74),
        commandTarget("command:github.repo", "github.repo", ["github", "repo", "status", "仓库", "状态"], 73),
        commandTarget("command:github.issues", "github.issues", ["github", "issues", "bug", "任务", "问题"], 72),
        commandTarget("command:github.pulls", "github.pulls", ["github", "pull", "pr", "merge", "合并"], 72),
        commandTarget("command:github.releases", "github.releases", ["github", "release", "tag", "发布", "版本"], 71),
        commandTarget("command:github.workflowRuns", "github.workflowRuns", ["github", "workflow", "actions", "ci", "构建"], 71),
        commandTarget("command:github.branches", "github.branches", ["github", "branch", "branches", "分支"], 70),
        commandTarget("command:github.file", "github.file", ["github", "file", "contents", "源码", "文件"], 70),
        commandTarget("command:github.createIssue", "github.createIssue", ["github", "create", "issue", "新增", "问题"], 68),
        commandTarget("command:github.installObsidianPlugin", "github.installObsidianPlugin", ["github", "plugin", "install", "release", "obsidian", "插件", "安装", "更新"], 69)
      );
    }

    return targets;
  }

  private async contextFiles(): Promise<VaultTextFile[]> {
    const paths = await listVaultTextPaths(this.app.vault.adapter, "");
    return paths
      .filter((path) => isContextTextPath(path))
      .map(vaultTextFileFromPath)
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  private loadedContextFiles(): VaultTextFile[] {
    return this.app.vault
      .getFiles()
      .filter((file) => isContextTextFile(file))
      .map((file) => ({ ...vaultTextFileFromPath(file.path), loaded: true }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  private async mentionContextFiles(query: string): Promise<VaultTextFile[]> {
    const loaded = this.loadedContextFiles();
    if (!shouldScanHiddenForQuery(query)) return loaded;
    const startedAt = Date.now();
    const hidden: string[] = [];
    for (const folder of hiddenMentionFoldersForQuery(query)) {
      if (Date.now() - startedAt > MENTION_TARGET_TIME_BUDGET_MS) break;
      hidden.push(...await listVaultTextPaths(this.app.vault.adapter, folder, MENTION_TARGET_TIME_BUDGET_MS, startedAt, MENTION_MAX_FILES));
      if (hidden.length >= MENTION_MAX_FILES) break;
    }
    const seen = new Set<string>();
    return [...loaded, ...hidden.map(vaultTextFileFromPath)]
      .filter((file) => {
        if (seen.has(file.path)) return false;
        seen.add(file.path);
        return isContextTextPath(file.path);
      })
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  private async listTextFilesInFolder(folder: string): Promise<VaultTextFile[]> {
    const normalized = normalizePath(folder);
    const paths = await listVaultTextPaths(this.app.vault.adapter, normalized);
    return paths
      .filter((path) => isContextTextPath(path))
      .map(vaultTextFileFromPath)
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  private async readMentionTarget(target: MentionTarget): Promise<string> {
    if (target.source === "virtual") {
      if (target.path.startsWith("command:")) return this.describeCommandMention(target.path.slice("command:".length));
      if (target.path.startsWith("obsidian-command:")) return this.describeObsidianCommandMention(target.path.slice("obsidian-command:".length), target.title);
      return this.describeActionMention(target.path);
    }

    if (target.source === "file") {
      if (!isContextTextPath(target.path)) return "";
      const content = await this.readVaultTextFile(target.path);
      return trimContext(content, this.plugin.settings.maxFileContextChars);
    }

    const files = (await this.mentionContextFiles(target.path))
      .filter((file) => isPathInFolder(file.path, target.path))
      .slice(0, Math.max(1, this.plugin.settings.maxMentionFolderFiles));
    const chunks: string[] = [];
    for (const file of files) {
      const content = await this.readVaultTextFile(file.path);
      chunks.push(`### ${file.path}\n${trimContext(content, this.plugin.settings.maxFolderFileContextChars)}`);
    }
    return chunks.join("\n\n");
  }

  private describeActionMention(path: string): string {
    const chinese = isChineseLanguage(this.plugin.language());
    const descriptions: Record<string, string> = chinese
      ? {
          "action:cancip": "用户提及 Cancip 主聊天功能。直接回答，并在有用时引用 Vault 来源路径。",
          "action:search": "用户提及 Cancip 功能：Search 模式。优先检索 Vault，先列出相关路径，再回答。",
          "action:plan": "用户提及 Cancip 功能：Plan 模式。输出可执行计划、风险和需要确认的动作，不要声称已执行。",
          "action:review-gate": "用户提及 OB Review Gate 审核门。必须用 command cancip.reviewGate 程序化生成手机 HTML 审核包；不要只输出提示词。可传 paths/items/maxFiles/output。",
          "action:plan-todos": "用户提及功能：结构化计划待办。可以用 cancip-action 的 todo 动作维护 Plan 面板，例如 {\"type\":\"todo\",\"op\":\"set\",\"items\":[{\"text\":\"检查文件\"},{\"text\":\"应用修改\"}]}，也支持 add/update/remove/list/clear。",
          "action:edit": "用户提及 Cancip 功能：Edit 模式。给出可复制修改建议；写入 Vault 前必须遵守访问模式。",
          "action:add-current-file": "用户提及功能：把当前活动笔记作为上下文。",
          "action:preview-vault-search": "用户提及功能：预览 Vault Search 命中结果。",
          "action:add-core-memory": "用户提及功能：加入核心记忆文件夹上下文。",
          "action:import-codex-memory": "用户提及功能：导入 Codex 核心记忆。可用 command cancip.importCodexMemory 把本机 Codex curated memory 复制到 AI/Cancip/Memory，作为 Cancip 长期记忆，便于手机同步。",
      "action:automation": "用户提及功能：自动化任务。可用 automation action 新增/更新/列出/删除/运行任务，也可用 cancip.automation.templates 和 cancip.automation.addTemplate 添加内置本地任务；任务保存在 .cancip/automations.json，日志写入 .cancip/automations。",
          "action:rebuild-index": "用户提及功能：重建轻量索引。",
          "action:command-bus": "用户提及功能：命令总线。Cancip 支持 cancip-action 的 command 类型，用结构化命令连接 OB 内部命令、Cancip 内置命令和 GitHub CLI 等价 REST 接口。",
          "action:obsidian-commands": "用户提及功能：Obsidian 内部命令库。可用 obsidian.listCommands 查询命令，用 obsidian.execute 执行命令 id；确认权限会排队，Full access 直接执行。",
          "action:local-version-commit": "用户提及功能：创建本地版本提交。Cancip 支持手动提交到 .cancip/versions，不依赖本地 git。",
          "action:daily-version-status": "用户提及功能：每日本地版本。Cancip 支持每天自动创建轻量版本快照。",
          "action:github": "用户提及功能：GitHub 管理。Cancip 的移动端 GitHub 能力通过设置里的 GitHub REST API URL/token 执行；不要使用公共 token 代理。",
          "action:clear-context": "用户提及功能：清空草稿上下文。",
          "action:new-chat": "用户提及功能：新建对话。"
        }
      : {
          "action:cancip": "Mentioned Cancip main chat function. Answer directly and cite Vault paths when useful.",
          "action:search": "Mentioned Cancip function: Search mode. Search the Vault first, list related paths, then answer.",
          "action:plan": "Mentioned Cancip function: Plan mode. Produce an executable plan, risks, and actions needing confirmation.",
          "action:review-gate": "Mentioned OB Review Gate. Use command cancip.reviewGate to programmatically build a mobile HTML review package; do not output prompt-only review. Args can include paths/items/maxFiles/output.",
          "action:plan-todos": "Mentioned function: structured plan todos. Use cancip-action todo actions to maintain the Plan panel, for example {\"type\":\"todo\",\"op\":\"set\",\"items\":[{\"text\":\"inspect files\"},{\"text\":\"apply changes\"}]}. Supported ops: add/update/remove/list/clear.",
          "action:edit": "Mentioned Cancip function: Edit mode. Provide copyable edits; obey the access mode before Vault writes.",
          "action:add-current-file": "Mentioned function: include the current active note as context.",
          "action:preview-vault-search": "Mentioned function: preview Vault Search hits.",
          "action:add-core-memory": "Mentioned function: include core memory folder context.",
          "action:import-codex-memory": "Mentioned function: import Codex core memory into AI/Cancip/Memory as Cancip long-term memory for mobile sync.",
          "action:automation": "Mentioned function: automations. Use automation actions or cancip.automation.templates/addTemplate for built-in local tasks. State lives in .cancip/automations.json and logs go to .cancip/automations.",
          "action:rebuild-index": "Mentioned function: rebuild the lightweight index.",
          "action:command-bus": "Mentioned function: command bus. Cancip supports cancip-action command actions for structured Obsidian commands, Cancip commands, and GitHub CLI-equivalent REST interfaces.",
          "action:obsidian-commands": "Mentioned function: Obsidian internal command library. Use obsidian.listCommands to inspect commands and obsidian.execute to run a command id; approval mode queues, Full access executes.",
          "action:local-version-commit": "Mentioned function: create a local version commit under .cancip/versions without native git.",
          "action:daily-version-status": "Mentioned function: daily local versions. Cancip supports one lightweight snapshot per day.",
          "action:github": "Mentioned function: GitHub management. Mobile GitHub support uses the configured GitHub REST API URL/token; do not use public token proxies.",
          "action:clear-context": "Mentioned function: clear draft context.",
          "action:new-chat": "Mentioned function: start a new chat."
        };
    return descriptions[path] ?? path;
  }

  private describeCommandMention(command: string): string {
    const chinese = isChineseLanguage(this.plugin.language());
    const examples: Record<string, string> = {
      "obsidian.listCommands": "{\"actions\":[{\"type\":\"command\",\"command\":\"obsidian.listCommands\",\"args\":{\"query\":\"file\",\"limit\":20}}]}",
      "obsidian.execute": "{\"actions\":[{\"type\":\"command\",\"command\":\"obsidian.execute\",\"args\":{\"id\":\"command-id\"}}]}",
      "cancip.reviewGate": "{\"actions\":[{\"type\":\"command\",\"command\":\"cancip.reviewGate\",\"args\":{\"paths\":[\"Folder/Note.md\"],\"maxFiles\":20}}]}",
      "cancip.reviewGate.list": "{\"actions\":[{\"type\":\"command\",\"command\":\"cancip.reviewGate.list\",\"args\":{\"limit\":10}}]}",
      "cancip.sessionEvents": "{\"actions\":[{\"type\":\"command\",\"command\":\"cancip.sessionEvents\",\"args\":{\"limit\":50}}]}",
      "cancip.installedPlugins": "{\"actions\":[{\"type\":\"command\",\"command\":\"cancip.installedPlugins\"}]}",
      "cancip.searchVault": "{\"actions\":[{\"type\":\"command\",\"command\":\"cancip.searchVault\",\"args\":{\"query\":\"keyword\",\"limit\":8}}]}",
      "cancip.rebuildIndex": "{\"actions\":[{\"type\":\"command\",\"command\":\"cancip.rebuildIndex\"}]}",
      "cancip.previewVaultSearch": "{\"actions\":[{\"type\":\"command\",\"command\":\"cancip.previewVaultSearch\"}]}",
      "cancip.localVersionCommit": "{\"actions\":[{\"type\":\"command\",\"command\":\"cancip.localVersionCommit\"}]}",
      "cancip.importCodexMemory": "{\"actions\":[{\"type\":\"command\",\"command\":\"cancip.importCodexMemory\"}]}",
      "cancip.automation.templates": "{\"actions\":[{\"type\":\"command\",\"command\":\"cancip.automation.templates\"}]}",
      "cancip.automation.addTemplate": "{\"actions\":[{\"type\":\"command\",\"command\":\"cancip.automation.addTemplate\",\"args\":{\"id\":\"auto-review-gate-current-vault\"}}]}",
      "cancip.automation.list": "{\"actions\":[{\"type\":\"command\",\"command\":\"cancip.automation.list\"}]}",
      "cancip.automation.add": "{\"actions\":[{\"type\":\"command\",\"command\":\"cancip.automation.add\",\"args\":{\"title\":\"Daily review\",\"prompt\":\"Review open todos\",\"schedule\":\"daily\",\"hour\":9}}]}",
      "cancip.automation.run": "{\"actions\":[{\"type\":\"command\",\"command\":\"cancip.automation.run\",\"args\":{\"id\":\"auto-id\"}}]}",
      "cancip.automation.remove": "{\"actions\":[{\"type\":\"command\",\"command\":\"cancip.automation.remove\",\"args\":{\"id\":\"auto-id\"}}]}",
      "github.help": "{\"actions\":[{\"type\":\"command\",\"command\":\"github.help\"}]}",
      "github.status": "{\"actions\":[{\"type\":\"command\",\"command\":\"github.status\"}]}",
      "github.repo": "{\"actions\":[{\"type\":\"command\",\"command\":\"github.repo\"}]}",
      "github.issues": "{\"actions\":[{\"type\":\"command\",\"command\":\"github.issues\",\"args\":{\"state\":\"open\",\"limit\":10}}]}",
      "github.pulls": "{\"actions\":[{\"type\":\"command\",\"command\":\"github.pulls\",\"args\":{\"state\":\"open\",\"limit\":10}}]}",
      "github.releases": "{\"actions\":[{\"type\":\"command\",\"command\":\"github.releases\",\"args\":{\"limit\":10}}]}",
      "github.workflowRuns": "{\"actions\":[{\"type\":\"command\",\"command\":\"github.workflowRuns\",\"args\":{\"limit\":10}}]}",
      "github.branches": "{\"actions\":[{\"type\":\"command\",\"command\":\"github.branches\",\"args\":{\"limit\":20}}]}",
      "github.file": "{\"actions\":[{\"type\":\"command\",\"command\":\"github.file\",\"args\":{\"path\":\"README.md\"}}]}",
      "github.createIssue": "{\"actions\":[{\"type\":\"command\",\"command\":\"github.createIssue\",\"args\":{\"title\":\"Issue title\",\"body\":\"Issue body\"}}]}",
      "github.installObsidianPlugin": "{\"actions\":[{\"type\":\"command\",\"command\":\"github.installObsidianPlugin\",\"args\":{\"repo\":\"arias007/cancip\",\"pluginId\":\"cancip\",\"tag\":\"latest\"}}]}"
    };
    const example = examples[command] ?? `{"actions":[{"type":"command","command":"${command}"}]}`;
    return chinese
      ? `命令总线项：${command}\n\n如果需要执行，只输出 cancip-action fenced block：\n\n\`\`\`cancip-action\n${example}\n\`\`\`\n\nAsk for approval 模式会排队等用户点 Run；Full access 模式直接执行。原始 JavaScript eval 不启用。`
      : `Command bus item: ${command}\n\nIf execution is needed, output only a cancip-action fenced block:\n\n\`\`\`cancip-action\n${example}\n\`\`\`\n\nAsk for approval queues a Run button; Full access executes directly. Raw JavaScript eval is not enabled.`;
  }

  private describeObsidianCommandMention(id: string, name: string): string {
    const chinese = isChineseLanguage(this.plugin.language());
    const example = JSON.stringify({ actions: [{ type: "command", command: "obsidian.execute", args: { id } }] });
    return chinese
      ? `Obsidian 内部命令：${name}\nID：${id}\n\n如果用户明确要执行，输出：\n\n\`\`\`cancip-action\n${example}\n\`\`\`\n\nAsk for approval 模式会排队等用户点 Run；Full access 模式直接执行。`
      : `Obsidian internal command: ${name}\nID: ${id}\n\nIf the user explicitly wants execution, output:\n\n\`\`\`cancip-action\n${example}\n\`\`\`\n\nAsk for approval queues a Run button; Full access executes directly.`;
  }

  private async previewVaultSearch(): Promise<void> {
    const query = this.inputEl.value.trim();
    if (!query) {
      new Notice(this.t("searchFirst"));
      return;
    }
    const hits = await this.searchVault(query, this.plugin.settings.maxContextFiles);
    this.renderSources(hits);
    this.setStatus(this.t("hitCount", { count: hits.length }));
  }

  private async searchVault(query: string, limit: number): Promise<SearchHit[]> {
    const tokens = tokenize(query);
    if (!tokens.length) return [];
    const files = (await this.searchableContextFiles(query, tokens)).slice(0, this.mode === "search" ? VAULT_SEARCH_MAX_SCAN_FILES * 2 : VAULT_SEARCH_MAX_SCAN_FILES);
    const results: SearchHit[] = [];
    const startedAt = Date.now();
    for (const file of files) {
      if (Date.now() - startedAt > VAULT_SEARCH_TIME_BUDGET_MS) break;
      const content = trimContext(await this.readVaultTextFile(file.path), 20000);
      const haystack = `${file.basename}\n${file.path}\n${content}`.toLowerCase();
      let score = 0;
      for (const token of tokens) {
        const escaped = escapeRegExp(token);
        const matches = haystack.match(new RegExp(escaped, "g"));
        if (matches) score += matches.length;
        if (file.basename.toLowerCase().includes(token)) score += 4;
        if (file.path.toLowerCase().includes(token)) score += 2;
      }
      if (score > 0) {
        results.push({
          path: file.path,
          title: file.basename,
          excerpt: makeExcerpt(content, tokens),
          score
        });
      }
    }
    return results.sort((a, b) => b.score - a.score).slice(0, Math.max(1, limit));
  }

  private async searchableContextFiles(query: string, tokens: string[]): Promise<VaultTextFile[]> {
    const regularFiles = this.loadedContextFiles()
      .filter((file) => shouldUsePathInAutomaticVaultSearch(file.path, query, tokens))
      .sort((a, b) => scoreSearchCandidate(b, tokens) - scoreSearchCandidate(a, tokens) || a.path.length - b.path.length || a.path.localeCompare(b.path));

    const hiddenFiles: VaultTextFile[] = [];
    const lower = query.toLowerCase();
    const wantsObsidian = lower.includes(".obsidian") || lower.includes("obsidian") || lower.includes("插件") || lower.includes("配置") || lower.includes("config");
    const wantsCancip = lower.includes(".cancip") || lower.includes("cancip");
    if (wantsObsidian) hiddenFiles.push(...await this.listTextFilesInFolder(".obsidian"));
    if (wantsCancip) hiddenFiles.push(...await this.listTextFilesInFolder(".cancip"));

    const seen = new Set<string>();
    return [...regularFiles, ...hiddenFiles]
      .filter((file) => {
        if (seen.has(file.path)) return false;
        seen.add(file.path);
        return shouldUsePathInAutomaticVaultSearch(file.path, query, tokens);
      })
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  private async handleActionBlocks(answer: string, message?: ChatMessage): Promise<ActionHandlingResult | null> {
    const actions = extractCancipActions(answer);
    if (!actions.length) {
      if (!hasCancipActionMarker(answer)) return null;
      const run = this.createToolRun({ type: "command", command: "cancip.invalidAction" });
      run.status = "failed";
      run.executedAt = new Date().toISOString();
      run.error = this.t("invalidActionBlock");
      if (message) message.toolRuns = [run];
      this.upsertToolFeedbackMessage(run);
      void this.recordSessionEvent({ kind: "tool.finish", runId: run.id, toolStatus: run.status, summary: run.summary, detail: run.error });
      void this.saveCurrentSession();
      return {
        report: this.formatActionReport([{
          title: this.t("actionsExecuted", { summary: "" }).trim(),
          summary: this.toolRunCompactSummary([run]),
          detail: run.error
        }]),
        runs: [run],
        executed: false
      };
    }

    const runs = actions.map((action) => this.createToolRun(action));
    if (message) message.toolRuns = runs;
    const summary = runs.map((run) => run.summary).join("\n");
    if (this.plugin.settings.accessMode !== "full-access") {
      const executable = runs.filter((run) => isReadOnlyAction(run.action));
      const pending = runs.filter((run) => !isReadOnlyAction(run.action));
      const results: string[] = [];
      for (const run of executable) {
        results.push(await this.executeToolRun(run));
      }
      if (!pending.length) {
        void this.saveCurrentSession();
        return { report: this.formatActionReport([{ title: this.t("actionsExecuted", { summary: "" }).trim(), summary: this.toolRunCompactSummary(executable), detail: results.join("\n\n") }]), runs, executed: executable.length > 0 };
      }
      const queuedSummary = pending.map((run) => run.summary).join("\n");
      const sections: ActionReportSection[] = [];
      if (results.length) {
        sections.push({ title: this.t("actionsExecuted", { summary: "" }).trim(), summary: this.toolRunCompactSummary(executable), detail: results.join("\n\n") });
      }
      sections.push({
        title: this.t("actionsNeedApproval", { summary: "" }).trim(),
        summary: `${queuedSummary}\n${this.t("toolRunsQueued", { count: pending.length })}`.trim()
      });
      void this.saveCurrentSession();
      return {
        report: this.formatActionReport(sections),
        runs,
        executed: executable.length > 0
      };
    }

    const results: string[] = [];
    for (const run of runs) {
      results.push(await this.executeToolRun(run));
    }
    void this.saveCurrentSession();
    return { report: this.formatActionReport([{ title: this.t("actionsExecuted", { summary: "" }).trim(), summary: this.toolRunCompactSummary(runs), detail: results.join("\n\n") }]), runs, executed: true };
  }

  private formatActionReport(sections: ActionReportSection[]): string {
    const body = sections
      .map((section) => {
        const visible = [section.title, section.summary ? trimContext(redactSensitiveText(section.summary), 360) : ""].filter(Boolean).join("\n\n");
        const detail = section.detail?.trim();
        if (!detail) return visible;
        return [
          visible,
          `<details>\n<summary>${this.t("toolRunResult")}</summary>\n\n\`\`\`text\n${trimContext(redactSensitiveText(detail), 5000)}\n\`\`\`\n</details>`
        ].join("\n\n");
      })
      .filter(Boolean)
      .join("\n\n---\n\n");
    return [PROCESS_MESSAGE_MARKER, body].filter(Boolean).join("\n\n");
  }

  private toolRunCompactSummary(runs: ToolRun[]): string {
    return runs
      .map((run) => `${this.toolRunStatusLabel(run.status)} · ${run.summary}`)
      .join("\n");
  }

  private createToolRun(action: CancipAction): ToolRun {
    return {
      id: crypto.randomUUID(),
      action,
      summary: this.describeAction(action),
      status: "pending",
      createdAt: new Date().toISOString()
    };
  }

  private async executeToolRun(run: ToolRun): Promise<string> {
    const startedAt = Date.now();
    run.status = "executing";
    run.startedAt = new Date(startedAt).toISOString();
    run.error = undefined;
    run.result = undefined;
    void this.recordSessionEvent({ kind: "tool.start", runId: run.id, toolStatus: run.status, summary: run.summary, detail: JSON.stringify(run.action) });
    this.upsertToolFeedbackMessage(run, startedAt);
    this.startToolRunTimer(run, startedAt);
    this.renderMessages();
    void this.saveCurrentSession();
    try {
      const result = await this.executeAction(run.action);
      run.status = "executed";
      run.executedAt = new Date().toISOString();
      run.result = result;
      this.stopToolRunTimer(run.id);
      this.upsertToolFeedbackMessage(run);
      this.renderMessages();
      await this.recordToolFeedback({ status: "executed", summary: run.summary, detail: result, at: run.executedAt });
      void this.recordSessionEvent({ kind: "tool.finish", runId: run.id, toolStatus: run.status, summary: run.summary, detail: result });
      void this.saveCurrentSession();
      return result;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      run.status = "failed";
      run.executedAt = new Date().toISOString();
      run.error = reason;
      this.stopToolRunTimer(run.id);
      this.upsertToolFeedbackMessage(run);
      this.renderMessages();
      await this.recordToolFeedback({ status: "failed", summary: run.summary, detail: reason, at: run.executedAt });
      void this.recordSessionEvent({ kind: "tool.finish", runId: run.id, toolStatus: run.status, summary: run.summary, detail: reason });
      void this.saveCurrentSession();
      return this.t("actionFailed", { reason });
    }
  }

  private upsertToolFeedbackMessage(run: ToolRun, startedAtMs?: number, persist = true): void {
    const marker = `${TOOL_FEEDBACK_MARKER_PREFIX}${run.id} -->`;
    const status = this.toolRunStatusLabel(run.status);
    const detail = run.error || run.result || "";
    const startedAt = startedAtMs ?? (run.startedAt ? Date.parse(run.startedAt) : Date.parse(run.createdAt));
    const endedAt = run.executedAt ? Date.parse(run.executedAt) : Date.now();
    const elapsed = run.status !== "pending" && Number.isFinite(startedAt)
      ? this.t("elapsedSuffix", { elapsed: formatElapsed(Math.max(0, endedAt - startedAt)) })
      : "";
    const body = [
      marker,
      PROCESS_MESSAGE_MARKER,
      [this.t("toolFeedbackStep", { status, summary: run.summary }), elapsed].filter(Boolean).join(" · "),
      detail ? `\n<details>\n<summary>${this.t("toolRunResult")}</summary>\n\n\`\`\`text\n${trimContext(redactSensitiveText(detail), 4000)}\n\`\`\`\n</details>` : ""
    ].filter(Boolean).join("\n\n");
    const existing = this.messages.find((message) => message.role === "assistant" && message.content.includes(marker));
    if (existing) {
      existing.content = body;
      this.syncSessionChrome();
      if (persist) void this.saveCurrentSession();
      return;
    }
    this.addMessage("assistant", body);
  }

  private startToolRunTimer(run: ToolRun, startedAt: number): void {
    this.stopToolRunTimer(run.id);
    const tick = () => {
      if (run.status !== "executing") {
        this.stopToolRunTimer(run.id);
        return;
      }
      this.upsertToolFeedbackMessage(run, startedAt, false);
      this.renderMessages();
    };
    tick();
    this.toolRunTimers.set(run.id, window.setInterval(tick, 1000));
  }

  private stopToolRunTimer(runId: string): void {
    const timer = this.toolRunTimers.get(runId);
    if (timer !== undefined) window.clearInterval(timer);
    this.toolRunTimers.delete(runId);
  }

  private async recordToolFeedback(event: ToolFeedbackEvent): Promise<void> {
    try {
      const adapter = this.app.vault.adapter;
      await ensureFolder(adapter, CANCIP_CONFIG_DIR);
      const existing = await adapter.exists(EXPERIENCE_LOG_PATH) ? await adapter.read(EXPERIENCE_LOG_PATH) : "# Cancip Experience\n\n";
      const entry = [
        `## ${event.at} · ${event.status}`,
        `- Session: ${this.sessionId}`,
        `- Step: ${redactSensitiveText(event.summary)}`,
        `- Result: ${trimContext(redactSensitiveText(event.detail), 900).replace(/\r?\n/g, " ")}`,
        ""
      ].join("\n");
      const next = `${existing.trimEnd()}\n\n${entry}`;
      const trimmed = next.length > EXPERIENCE_LOG_MAX_CHARS
        ? `# Cancip Experience\n\n${next.slice(-EXPERIENCE_LOG_MAX_CHARS)}`
        : next;
      await adapter.write(EXPERIENCE_LOG_PATH, `${trimmed.trimEnd()}\n`);
    } catch (error) {
      console.warn("Cancip tool feedback save failed", error);
    }
  }

  private async forceToolActionForImplementationTask(
    rawPrompt: string,
    context: { system: string; contextText: string },
    request: AbortController,
    reason: "missing" | "low-commitment" = "missing"
  ): Promise<ActionHandlingResult | null> {
    if (this.plugin.settings.accessMode !== "full-access") return null;
    if (!shouldExpectToolActionForPrompt(rawPrompt)) return null;
    if (request.signal.aborted || !this.isCurrentRequest(request)) return null;

    this.setStatus(this.t("toolContinueStatus"));
    const continueStep = this.addProgressStep(this.t("toolContinueStatus"));
    const prompt = this.t(reason === "low-commitment" ? "toolActionLowCommitmentPrompt" : "toolActionRequiredPrompt", { task: rawPrompt });
    const answer = await withTimeout(this.callModel(prompt, context), MODEL_CALL_TIMEOUT_MS, "model request timed out");
    if (request.signal.aborted || !this.isCurrentRequest(request)) return null;
    this.updateProgressStep(continueStep, this.t("toolContinueStatus"), this.t("done"));
    const visibleAnswer = removeCancipActionBlocks(answer).trim();
    const assistantMessage = this.addMessage("assistant", visibleAnswer || this.t("toolActionForcedVisible"));
    this.renderMessages();
    const handled = await this.handleActionBlocks(answer, assistantMessage);
    if (handled || request.signal.aborted || !this.isCurrentRequest(request)) return handled;

    const hardPrompt = this.t("toolActionHardRequiredPrompt", { task: rawPrompt });
    const hardAnswer = await withTimeout(this.callModel(hardPrompt, context), MODEL_CALL_TIMEOUT_MS, "model request timed out");
    if (request.signal.aborted || !this.isCurrentRequest(request)) return null;
    const hardVisibleAnswer = removeCancipActionBlocks(hardAnswer).trim();
    const hardAssistantMessage = this.addMessage("assistant", hardVisibleAnswer || this.t("toolActionForcedVisible"));
    this.renderMessages();
    return await this.handleActionBlocks(hardAnswer, hardAssistantMessage);
  }

  private async readTaskExperience(prompt = ""): Promise<string> {
    try {
      const adapter = this.app.vault.adapter;
      if (!(await adapter.exists(EXPERIENCE_LOG_PATH))) return "";
      const raw = await adapter.read(EXPERIENCE_LOG_PATH);
      const maxChars = shouldExpectToolActionForPrompt(prompt) ? 1200 : EXPERIENCE_CONTEXT_MAX_CHARS;
      return trimContext(selectRelevantExperience(raw, prompt), maxChars);
    } catch (error) {
      console.warn("Cancip task experience read failed", error);
      return "";
    }
  }

  private async continueAfterToolRuns(
    context: { system: string; contextText: string },
    previous: ActionHandlingResult,
    request: AbortController,
    originalPrompt = ""
  ): Promise<ActionHandlingResult | null> {
    const implementationTask = originalPrompt ? shouldExpectToolActionForPrompt(originalPrompt) : false;
    const initialNeedsMoreAction = implementationTask && shouldNeedMoreActionForPrompt(originalPrompt, previous.runs);
    if (!this.plugin.settings.autoContinueAfterTools || (!initialNeedsMoreAction && !this.shouldContinueFromToolRuns(previous))) return previous;
    const configuredIterations = Math.max(0, Math.min(10, this.plugin.settings.maxToolIterations));
    const maxIterations = originalPrompt && shouldExpectToolActionForPrompt(originalPrompt)
      ? Math.max(5, configuredIterations)
      : configuredIterations;
    let current: ActionHandlingResult | null = previous;
    let lastHandled: ActionHandlingResult = previous;

    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      if (!current || request.signal.aborted || !this.isCurrentRequest(request)) return lastHandled;
      const currentNeedsMoreAction = implementationTask && shouldNeedMoreActionForPrompt(originalPrompt, current.runs);
      if (!currentNeedsMoreAction && !this.shouldContinueFromToolRuns(current)) return lastHandled;
      this.setStatus(this.t("toolContinueStatus"));
      const continueStep = this.addProgressStep(this.t("toolContinueStatus"));
      const experience = await this.safeContextStep(this.t("taskExperience"), () => this.readTaskExperience(originalPrompt), "", CONTEXT_STEP_TIMEOUT_MS);
      const continuationContext = {
        system: this.modePrompt(),
        contextText: [
          trimContext(context.contextText, implementationTask ? 9000 : Math.max(9000, context.contextText.length)),
          experience ? `## ${this.t("taskExperience")}\n${experience}` : ""
        ].filter(Boolean).join("\n\n---\n\n")
      };
      const prompt = this.t("toolContinuationPrompt", {
        summary: `${this.conversationForToolContinuation(implementationTask ? 8 : undefined, implementationTask ? 500 : undefined)}\n\n${this.toolRunsForPrompt(current.runs, implementationTask ? 1200 : 4000, implementationTask ? 6 : undefined)}`.trim()
      });
      const answer = await withTimeout(this.callModel(prompt, continuationContext), MODEL_CALL_TIMEOUT_MS, "model request timed out");
      if (request.signal.aborted || !this.isCurrentRequest(request)) return null;
      this.updateProgressStep(continueStep, this.t("toolContinueStatus"), this.t("done"));
      const assistantMessage = this.addMessage("assistant", answer);
      this.renderMessages();
      current = await this.handleActionBlocks(answer, assistantMessage);
      if (!current) {
        const recovery = await this.recoverFromPatchFindFailure(lastHandled, request);
        if (recovery) {
          this.addMessage("assistant", recovery.report);
          this.renderMessages();
          current = recovery;
          lastHandled = recovery;
          continue;
        }
        if (originalPrompt && shouldExpectToolActionForPrompt(originalPrompt) && shouldNeedMoreActionForPrompt(originalPrompt, lastHandled.runs)) {
          current = await this.forceToolActionForImplementationTask(originalPrompt, continuationContext, request);
          if (!current) return lastHandled;
        } else {
          return lastHandled;
        }
      }
      this.addMessage("assistant", current.report);
      this.renderMessages();
      lastHandled = current;
    }
    if (originalPrompt && shouldExpectToolActionForPrompt(originalPrompt) && shouldNeedMoreActionForPrompt(originalPrompt, lastHandled.runs)) {
      const forced = await this.forceToolActionForImplementationTask(originalPrompt, {
        system: this.modePrompt(),
        contextText: context.contextText
      }, request, "low-commitment");
      if (forced) {
        this.addMessage("assistant", forced.report);
        this.renderMessages();
        return forced;
      }
    }
    return lastHandled;
  }

  private async recoverFromPatchFindFailure(
    previous: ActionHandlingResult,
    request: AbortController
  ): Promise<ActionHandlingResult | null> {
    const failed = [...previous.runs].reverse().find((run) =>
      run.status === "failed"
      && run.action.type === "patch"
      && /was not found|find text/i.test(run.error ?? "")
    );
    if (!failed || failed.action.type !== "patch") return null;
    if (request.signal.aborted || !this.isCurrentRequest(request)) return null;

    const readAction: CancipAction = {
      type: "read",
      path: failed.action.path,
      query: patchRecoveryQuery(failed.action.find),
      maxChars: 8000
    };
    const run = this.createToolRun(readAction);
    const result = await this.executeToolRun(run);
    return {
      report: this.formatActionReport([{
        title: this.t("actionsExecuted", { summary: "" }).trim(),
        summary: this.toolRunCompactSummary([run]),
        detail: result
      }]),
      runs: [run],
      executed: run.status === "executed"
    };
  }

  private ensurePlainFinalConclusion(startedAt: number): void {
    const lastAssistant = [...this.messages].reverse().find((message) => message.role === "assistant");
    if (!lastAssistant) return;
    if (lastAssistant.content.includes(this.plugin.language().startsWith("zh") ? "## 最终结论" : "## Final answer")) return;
    if (prepareMessageDisplay(redactSensitiveText(lastAssistant.content)).processOnly) return;
    lastAssistant.content = [
      this.t("finalConclusionFallback", { summary: lastAssistant.content.trim() }),
      "",
      this.t("totalElapsed", { elapsed: formatElapsed(Date.now() - startedAt) })
    ].join("\n");
    void this.saveCurrentSession();
    this.renderMessages();
  }

  private ensureFinalConclusion(result: ActionHandlingResult, startedAt?: number, needsMoreAction = false, originalPrompt = ""): void {
    if (!result.runs.length) return;
    const inventorySummary = this.humanInventoryConclusion(result.runs, originalPrompt);
    const lastAssistant = [...this.messages].reverse().find((message) => message.role === "assistant");
    if (inventorySummary) {
      const alreadyAnswered = lastAssistant
        && !prepareMessageDisplay(redactSensitiveText(lastAssistant.content)).processOnly
        && /已启用|已啟用|enabled|installed/i.test(lastAssistant.content)
        && /插件|plugin/i.test(lastAssistant.content);
      if (!alreadyAnswered) {
        const summary = [
          inventorySummary,
          typeof startedAt === "number" ? this.t("totalElapsed", { elapsed: formatElapsed(Date.now() - startedAt) }) : ""
        ].filter(Boolean).join("\n\n");
        this.addMessage("assistant", this.t("finalConclusionFallback", { summary }));
        this.renderMessages();
      }
      return;
    }
    if (lastAssistant && !prepareMessageDisplay(redactSensitiveText(lastAssistant.content)).processOnly && !isWeakFinalConclusion(lastAssistant.content)) return;
    const summary = [
      this.humanFinalConclusion(result.runs, needsMoreAction, originalPrompt),
      typeof startedAt === "number" ? this.t("totalElapsed", { elapsed: formatElapsed(Date.now() - startedAt) }) : ""
    ].filter(Boolean).join("\n\n");
    this.addMessage("assistant", this.t("finalConclusionFallback", { summary }));
    this.renderMessages();
  }

  private humanFinalConclusion(runs: ToolRun[], needsMoreAction = false, originalPrompt = ""): string {
    const failed = runs.filter((run) => run.status === "failed");
    const rejected = runs.filter((run) => run.status === "rejected");
    const pending = runs.filter((run) => run.status === "pending" || run.status === "blocked");
    const executed = runs.filter((run) => run.status === "executed");
    const inventoryConclusion = this.humanInventoryConclusion(runs, originalPrompt);
    if (inventoryConclusion) return inventoryConclusion;
    const writes = executed.filter((run) => this.isWriteLikeAction(run.action));
    const reads = executed.filter((run) => !this.isWriteLikeAction(run.action));
    const paths = uniqueStrings(writes.map((run) => this.actionPrimaryPath(run.action)).filter(Boolean)).slice(0, 5);
    const goal = originalPrompt.trim() ? `针对“${trimContext(originalPrompt.replace(/\s+/g, " "), 80)}”：` : "";

    if (pending.length) {
      const firstPending = pending[0];
      return [
        `${goal}还没完成，正在等你确认。`,
        `待确认：${pending.length} 个操作，当前第一个是 ${firstPending.summary}。`,
        "确认后会继续执行；拒绝则会按失败/阻塞反馈。"
      ].join("\n\n");
    }

    if (failed.length || rejected.length) {
      const firstRun = failed[0] ?? rejected[0];
      const firstIssue = firstRun?.error || this.t("toolRunFailed");
      const target = firstRun ? this.actionPrimaryPath(firstRun.action) : "";
      const patchFindFailed = failed.some((run) => run.action.type === "patch" && /was not found|find text/i.test(run.error ?? ""));
      return [
        writes.length ? `${goal}部分完成，但还有步骤失败。` : `${goal}没完成。`,
        firstRun ? `失败步骤：${firstRun.summary}${target ? `（${target}）` : ""}` : "",
        writes.length && paths.length ? `已完成改动：${paths.join("、")}` : reads.length ? "这轮主要完成了读取/检索，还没有完成目标改动。" : "",
        `失败原因：${trimContext(redactSensitiveText(firstIssue), 220)}`,
        patchFindFailed
          ? "下一步：必须读取目标文件的当前片段，换更小锚点或 regex patch；不能重复同一个失败补丁。"
          : "下一步：基于这个失败结果改用更小、可验证的动作继续；如果确实受限，就明确具体缺少什么能力。"
      ].filter(Boolean).join("\n\n");
    }

    if (needsMoreAction) {
      return [
        writes.length ? `${goal}部分完成，但还没达到目标。` : `${goal}没完成。`,
        paths.length ? `已完成改动：${paths.join("、")}` : reads.length ? "这轮只完成读取/检索，还没有形成目标要求的改动。" : "",
        "原因：当前动作不足以证明任务完成。设置页、UI、插件自身或管理功能类任务，不能只读文件或只改配置就算完成。",
        "下一步：继续做实际 patch/write/验证；如果受限，必须说清楚缺少的能力。"
      ].filter(Boolean).join("\n\n");
    }

    if (writes.length) {
      return [
        `${goal}已完成。`,
        paths.length ? `已改动：${paths.join("、")}` : "相关写入/修改动作已执行并返回成功。",
        "过程细节已折叠保留，方便回查。"
      ].join("\n\n");
    }

    if (reads.length) {
      return [
        `${goal}没完成。`,
        shouldExpectToolActionForPrompt(originalPrompt)
          ? "这轮只完成了读取/检索，还没有按你的要求做实际修改。"
          : "这轮只完成了读取/检索，没有产生实际改动或可验证结果。",
        "下一步：直接基于最后一次工具结果继续执行具体 patch/write/验证；不要重新泛搜，也不要套话总结。"
      ].join("\n\n");
    }

    return `${goal}没完成。Cancip 没有生成可直接使用的结果；应给出明确阻塞原因，或继续执行具体工具动作。`;
  }

  private humanInventoryConclusion(runs: ToolRun[], originalPrompt: string): string {
    if (!isReadOnlyPluginInventoryPrompt(originalPrompt)) return "";
    const pluginList = extractInstalledPluginAnswerFromToolRuns(runs);
    if (pluginList) return pluginList;
    const failed = runs.find((run) => run.status === "failed");
    if (failed) {
      const reason = trimContext(redactSensitiveText(failed.error || this.t("toolRunFailed")), 220);
      return [
        `针对“${trimContext(originalPrompt.replace(/\s+/g, " "), 80)}”：没完成。`,
        `没有拿到插件清单。失败步骤：${failed.summary}`,
        `失败原因：${reason}`,
        "下一步：直接读取 .obsidian/community-plugins.json，或执行 cancip.installedPlugins；不要写空报告、不要泛搜备份目录。"
      ].join("\n\n");
    }
    return "";
  }

  private isWriteLikeAction(action: CancipAction): boolean {
    if (action.type === "write" || action.type === "append" || action.type === "patch" || action.type === "mkdir" || action.type === "rename" || action.type === "move" || action.type === "copy" || action.type === "delete") return true;
    if (action.type === "config") return true;
    if (action.type === "todo") return action.op !== "list";
    if (action.type === "automation") return action.op !== "list";
    if (action.type !== "command") return false;
    const command = action.command.trim();
    return command === "obsidian.execute"
      || command === "cancip.rebuildIndex"
      || command === "cancip.localVersionCommit"
      || command === "cancip.importCodexMemory"
      || command === "cancip.automation.add"
      || command === "cancip.automation.addTemplate"
      || command === "cancip.automation.run"
      || command === "cancip.automation.remove"
      || command === "github.createIssue"
      || command === "github.installObsidianPlugin";
  }

  private actionPrimaryPath(action: CancipAction): string {
    if (action.type === "rename" || action.type === "move" || action.type === "copy") return action.newPath;
    if (action.type === "config") return action.path?.trim() || CANCIP_CONFIG_PATH;
    if ("path" in action && typeof action.path === "string") return action.path;
    if (action.type === "automation" && action.id) return action.id;
    if (action.type === "command") return action.command;
    return "";
  }

  private shouldContinueFromToolRuns(result: ActionHandlingResult): boolean {
    return shouldContinueToolLoopFromRuns(result.runs);
  }

  private async continueAfterManualToolRuns(message: ChatMessage): Promise<void> {
    if (!this.plugin.settings.autoContinueAfterTools || this.activeRequest) return;
    const runs = message.toolRuns ?? [];
    if (!runs.length) return;
    if (runs.some((run) => run.status === "pending" || run.status === "executing")) return;
    if (!runs.some((run) => run.status === "executed" || run.status === "failed" || run.status === "rejected")) return;

    const request = new AbortController();
    this.activeRequest = request;
    const context = this.contextForToolContinuation(message);
    try {
      await this.continueAfterToolRuns(context, { report: "", runs, executed: runs.some((run) => run.status === "executed") }, request);
      this.setStatus(this.t("done"));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.addMessage("assistant", this.localFallback(this.t("toolContinueStatus"), [], reason));
      this.setStatus(this.t("callFailed"));
    } finally {
      if (this.isCurrentRequest(request)) this.clearRequest(request);
      this.renderMessages();
    }
  }

  private contextForToolContinuation(message: ChatMessage): { system: string; contextText: string } {
    const index = this.messages.findIndex((item) => item.id === message.id);
    const previous = (index >= 0 ? this.messages.slice(0, index) : this.messages)
      .slice()
      .reverse()
      .find((item) => item.role === "user" && (item.systemPrompt || item.contextText));
    return {
      system: previous?.systemPrompt ?? this.modePrompt(),
      contextText: previous?.contextText ?? ""
    };
  }

  private conversationForToolContinuation(limitOverride?: number, maxChars = 1600): string {
    const limit = limitOverride ?? Math.max(4, Math.min(16, this.plugin.settings.maxRecentTranscriptMessages + 4));
    return this.messages
      .slice(-limit)
      .filter((message) => !prepareMessageDisplay(redactSensitiveText(message.content)).processOnly || message.toolRuns?.length)
      .map((message) => `${message.role}: ${trimContext(redactSensitiveText(messageOutlineText(message.content) || message.content), maxChars)}`)
      .join("\n\n");
  }

  private toolRunsForPrompt(runs: ToolRun[], maxDetail = 4000, maxRuns?: number): string {
    return runs
      .slice(-(maxRuns ?? runs.length))
      .map((run, index) => {
        const detail = run.result || run.error || "";
        return `${index + 1}. ${run.status}: ${run.summary}${detail ? `\n${trimContext(detail, maxDetail)}` : ""}`;
      })
      .join("\n\n");
  }

  private async runPendingToolRun(messageId: string, runId: string): Promise<void> {
    const message = this.messages.find((item) => item.id === messageId);
    const run = message?.toolRuns?.find((item) => item.id === runId);
    if (!message || !run || run.status !== "pending") {
      new Notice(this.t("toolRunNoPending"));
      return;
    }
    this.setStatus(this.t("toolRunStarted"));
    this.renderMessages();
    await this.executeToolRun(run);
    await this.saveCurrentSession();
    this.renderMessages();
    this.setStatus(this.t("toolRunFinished"));
    await this.continueAfterManualToolRuns(message);
  }

  private async rejectPendingToolRun(messageId: string, runId: string): Promise<void> {
    const message = this.messages.find((item) => item.id === messageId);
    const run = message?.toolRuns?.find((item) => item.id === runId);
    if (!message || !run || run.status !== "pending") {
      new Notice(this.t("toolRunNoPending"));
      return;
    }
    run.status = "rejected";
    run.executedAt = new Date().toISOString();
    run.error = this.t("toolRunRejectedNotice");
    this.upsertToolFeedbackMessage(run);
    this.renderMessages();
    await this.recordToolFeedback({ status: "rejected", summary: run.summary, detail: run.error, at: run.executedAt });
    void this.recordSessionEvent({ kind: "tool.reject", runId: run.id, toolStatus: run.status, summary: run.summary, detail: run.error });
    await this.saveCurrentSession();
    this.setStatus(this.t("toolRunRejectedNotice"));
    await this.continueAfterManualToolRuns(message);
  }

  private async executeAction(action: CancipAction): Promise<string> {
    if (action.type === "command") {
      return await this.executeCommandAction(action.command, action.args ?? {});
    }

    if (action.type === "todo") {
      return this.executeTodoAction(action);
    }

    if (action.type === "automation") {
      return await this.executeAutomationAction(action);
    }

    if (action.type === "config") {
      return await this.executeConfigAction(action);
    }

    const adapter = this.app.vault.adapter;
    const path = normalizeActionPath(action.path);

    if (action.type === "read") {
      const content = await adapter.read(path);
      return this.t("actionRead", { path, content: this.formatReadResult(path, content, action) });
    }

    if (action.type === "write") {
      return await this.executeChunkedTextWrite(adapter, path, action);
    }

    if (action.type === "append") {
      return await this.executeChunkedTextWrite(adapter, path, action);
    }

    if (action.type === "patch") {
      const current = await adapter.read(path);
      if (!action.find) throw new Error("patch action requires a non-empty find field");
      const updated = action.regex
        ? this.applyRegexPatch(path, current, action)
        : this.applyExactPatch(path, current, action);
      await adapter.write(path, updated);
      return this.withSelfPatchNotice(path, this.t("actionPatch", { path }));
    }

    if (action.type === "mkdir") {
      await ensureFolder(adapter, path);
      return this.t("actionMkdir", { path });
    }

    if (action.type === "rename" || action.type === "move") {
      const currentPath = await this.resolveActionExistingPath(path);
      const newPath = await this.resolveMoveTargetPath(currentPath, normalizeActionPath(action.newPath));
      await this.ensureMoveDestination(adapter, currentPath, newPath);
      await ensureParentFolder(adapter, newPath);
      await adapter.rename(currentPath, newPath);
      const sourceExists = await adapter.exists(currentPath);
      const targetExists = await adapter.exists(newPath);
      if (sourceExists || !targetExists) {
        throw new Error(`move verification failed: sourceExists=${sourceExists}, targetExists=${targetExists}`);
      }
      const key = action.type === "move" ? "actionMove" : "actionRename";
      return this.t(key, { path: currentPath, newPath });
    }

    if (action.type === "delete") {
      const currentPath = await this.resolveActionExistingPath(path);
      return await this.executeDeleteAction(adapter, currentPath, action.permanent === true);
    }

    const newPath = normalizeActionPath(action.newPath);
    await ensureParentFolder(adapter, newPath);
    await adapter.copy(path, newPath);
    return this.withSelfPatchNotice(newPath, this.t("actionCopy", { path, newPath }));
  }

  private async executeChunkedTextWrite(
    adapter: DataAdapter,
    path: string,
    action: Extract<CancipAction, { type: "write" | "append" }>
  ): Promise<string> {
    const content = textWriteActionContent(action);
    const chunks = splitTextChunks(content, FILE_WRITE_CHUNK_SIZE);
    await ensureParentFolder(adapter, path);

    if (action.type === "write") {
      await adapter.write(path, chunks[0] ?? "");
      for (const chunk of chunks.slice(1)) {
        await adapter.append(path, chunk);
      }
      const verified = await adapter.read(path);
      if (verified.length !== content.length || await sha256Text(verified) !== await sha256Text(content)) {
        throw new Error(`write verification failed: ${path}`);
      }
      return this.withSelfPatchNotice(path, this.t("actionWriteDetailed", { path, chars: content.length, chunks: chunks.length }));
    }

    const existed = await adapter.exists(path);
    const before = existed ? await adapter.read(path) : "";
    if (!existed) {
      await adapter.write(path, "");
    }
    for (const chunk of chunks) {
      await adapter.append(path, chunk);
    }
    const after = await adapter.read(path);
    if (after.length !== before.length + content.length || !after.endsWith(content)) {
      throw new Error(`append verification failed: ${path}`);
    }
    return this.withSelfPatchNotice(path, this.t("actionAppendDetailed", { path, chars: content.length, chunks: chunks.length }));
  }

  private async executeDeleteAction(adapter: DataAdapter, path: string, permanent: boolean): Promise<string> {
    if (!await adapter.exists(path)) {
      throw new Error(`delete target not found: ${path}`);
    }

    let mode = permanent ? "remove" : "trash";
    if (permanent) {
      await this.removeVaultPath(adapter, path);
    } else {
      const abstractFile = this.app.vault.getAbstractFileByPath(path);
      if (abstractFile) {
        try {
          await this.app.vault.trash(abstractFile, true);
          mode = "vault-trash-system";
        } catch {
          try {
            await this.app.vault.trash(abstractFile, false);
            mode = "vault-trash-local";
          } catch {
            await this.moveToCancipTrash(adapter, path);
            mode = "cancip-trash";
          }
        }
      } else {
        try {
          const trashed = await adapter.trashSystem(path);
          if (trashed === false) {
            await adapter.trashLocal(path);
            mode = "trash-local";
          } else {
            mode = "trash-system";
          }
        } catch {
          try {
            await adapter.trashLocal(path);
            mode = "trash-local";
          } catch {
            await this.moveToCancipTrash(adapter, path);
            mode = "cancip-trash";
          }
        }
      }
    }

    if (await adapter.exists(path)) {
      throw new Error(`delete verification failed: ${path}`);
    }
    return this.t("actionDelete", { path, mode });
  }

  private async moveToCancipTrash(adapter: DataAdapter, path: string): Promise<string> {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const target = `${CANCIP_TRASH_DIR}/${stamp}/${path}`;
    await ensureParentFolder(adapter, target);
    await adapter.rename(path, target);
    return target;
  }

  private async removeVaultPath(adapter: DataAdapter, path: string): Promise<void> {
    const stat = await adapter.stat(path);
    if (stat?.type === "folder") {
      await adapter.rmdir(path, true);
      return;
    }
    await adapter.remove(path);
  }

  private async resolveActionExistingPath(path: string): Promise<string> {
    const adapter = this.app.vault.adapter;
    const normalized = normalizeActionPath(path);
    if (await adapter.exists(normalized)) return normalized;

    const withMd = normalized.includes(".") ? normalized : `${normalized}.md`;
    if (withMd !== normalized && await adapter.exists(withMd)) return withMd;

    const lower = normalized.toLowerCase();
    const lowerWithMd = withMd.toLowerCase();
    const loaded = this.app.vault.getAllLoadedFiles()
      .map((file) => normalizePath(file.path))
      .find((candidate) => candidate.toLowerCase() === lower || candidate.toLowerCase() === lowerWithMd);
    if (loaded && await adapter.exists(loaded)) return loaded;

    throw new Error(`target not found: ${path}`);
  }

  private async resolveMoveTargetPath(sourcePath: string, rawNewPath: string): Promise<string> {
    const adapter = this.app.vault.adapter;
    const newPath = normalizeActionPath(rawNewPath);
    const sourceName = sourcePath.split("/").pop() || sourcePath;
    const sourceStat = await adapter.stat(sourcePath);
    const targetStat = await adapter.stat(newPath);
    if (targetStat?.type === "folder") return `${newPath}/${sourceName}`;
    if (sourceStat?.type === "file" && !newPath.split("/").pop()?.includes(".")) {
      return `${newPath}/${sourceName}`;
    }
    return newPath;
  }

  private async ensureMoveDestination(adapter: DataAdapter, sourcePath: string, newPath: string): Promise<void> {
    const sourceStat = await adapter.stat(sourcePath);
    if (sourceStat?.type !== "file") return;
    const sourceName = sourcePath.split("/").pop() || sourcePath;
    if (!newPath.endsWith(`/${sourceName}`)) return;
    const folder = newPath.slice(0, -sourceName.length - 1);
    if (folder) await ensureFolder(adapter, folder);
  }

  private async executeConfigAction(action: Extract<CancipAction, { type: "config" }>): Promise<string> {
    const adapter = this.app.vault.adapter;
    const path = normalizeActionPath(action.path?.trim() || CANCIP_CONFIG_PATH);
    if (!path.toLowerCase().endsWith(".json")) throw new Error(`config action only supports JSON files: ${path}`);
    const raw = await adapter.exists(path) ? await adapter.read(path) : "{}";
    let parsed: unknown;
    try {
      parsed = raw.trim() ? JSON.parse(raw) : {};
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`config JSON parse failed in ${path}: ${reason}`);
    }
    const next: Record<string, unknown> = action.replace ? {} : cloneJsonObject(parsed);
    const changed = new Set<string>();
    if (action.set) {
      deepMergeJsonObject(next, action.set, changed);
    }
    for (const keyPath of action.unset ?? []) {
      if (deleteJsonPath(next, keyPath)) changed.add(keyPath.trim());
    }
    if (!changed.size) throw new Error("config action requires set or unset changes");
    await ensureParentFolder(adapter, path);
    await writeTextInChunks(adapter, path, `${JSON.stringify(next, null, 2)}\n`);
    try {
      const verified = JSON.parse(await adapter.read(path)) as unknown;
      if (JSON.stringify(verified) !== JSON.stringify(next)) throw new Error("readback mismatch");
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`config write verification failed in ${path}: ${reason}`);
    }
    const keys = [...changed].filter(Boolean).slice(0, 20).join(", ");
    return this.withSelfPatchNotice(path, this.t("configActionResult", { path, keys }));
  }

  private formatReadResult(path: string, content: string, action: Extract<CancipAction, { type: "read" }>): string {
    const maxChars = clampInt(action.maxChars, 2000, 500, 12000);
    const query = action.query?.trim();
    if (!query) {
      return trimContext(redactSensitiveText(content), maxChars);
    }

    const occurrences = stringOccurrences(content, query);
    if (!occurrences.length) {
      return trimContext(redactSensitiveText([
        `query not found: ${query}`,
        `file length: ${content.length}`,
        "",
        "Head:",
        content.slice(0, Math.min(1200, maxChars)),
        "",
        "Tail:",
        content.slice(Math.max(0, content.length - Math.min(1200, maxChars)))
      ].join("\n")), maxChars);
    }

    const occurrenceIndex = Math.max(0, Math.min(occurrences.length - 1, clampInt(action.occurrence, 1, 1, occurrences.length) - 1));
    const at = occurrences[occurrenceIndex];
    return trimContext(redactSensitiveText([
      `query: ${query}`,
      `match: ${occurrenceIndex + 1}/${occurrences.length} at char ${at}`,
      `file length: ${content.length}`,
      "",
      snippetAroundIndex(content, at, maxChars)
    ].join("\n")), maxChars);
  }

  private applyExactPatch(path: string, current: string, action: Extract<CancipAction, { type: "patch" }>): string {
    if (!current.includes(action.find)) {
      throw new Error(formatPatchFindFailure(path, current, action.find, false));
    }
    return action.all ? current.split(action.find).join(action.replace) : current.replace(action.find, action.replace);
  }

  private applyRegexPatch(path: string, current: string, action: Extract<CancipAction, { type: "patch" }>): string {
    let pattern: RegExp;
    try {
      pattern = new RegExp(action.find, normalizePatchRegexFlags(action.flags, Boolean(action.all)));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`invalid patch regex for ${path}: ${reason}`);
    }

    pattern.lastIndex = 0;
    if (!pattern.test(current)) {
      throw new Error(formatPatchFindFailure(path, current, action.find, true));
    }
    pattern.lastIndex = 0;
    return current.replace(pattern, action.replace);
  }

  private withSelfPatchNotice(path: string, result: string): string {
    const normalized = normalizePath(path);
    if (!normalized.startsWith(".obsidian/plugins/cancip/")) return result;
    if (!/\.(js|css|json)$/i.test(normalized)) return result;
    return `${result}\n${this.t("selfPatchNeedsReload")}`;
  }

  private executeTodoAction(action: TodoAction): string {
    if (action.op === "list") {
      return this.t("todoActionResult", { summary: this.manualTodosSummary() });
    }

    if (action.op === "clear") {
      this.manualTodos = [];
      this.refreshPlanPanelIfOpen();
      return this.t("todoActionResult", { summary: this.manualTodosSummary() });
    }

    if (action.op === "set") {
      const items = action.items ?? [];
      this.manualTodos = items
        .map((item) => ({
          id: item.id?.trim() || crypto.randomUUID(),
          text: item.text.trim(),
          done: Boolean(item.done),
          createdAt: new Date().toISOString()
        }))
        .filter((item) => item.text);
      this.refreshPlanPanelIfOpen();
      return this.t("todoActionResult", { summary: this.manualTodosSummary() });
    }

    if (action.op === "add") {
      const text = action.text?.trim() || action.items?.map((item) => item.text.trim()).filter(Boolean).join("\n");
      if (!text) throw new Error("todo add requires text");
      for (const line of text.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
        this.manualTodos.push({ id: crypto.randomUUID(), text: line, done: Boolean(action.done), createdAt: new Date().toISOString() });
      }
      this.refreshPlanPanelIfOpen();
      return this.t("todoActionResult", { summary: this.manualTodosSummary() });
    }

    if (action.op === "update") {
      const todo = this.findManualTodo(action);
      if (todo) {
        if (typeof action.text === "string" && action.text.trim()) todo.text = action.text.trim();
        if (typeof action.done === "boolean") todo.done = action.done;
      } else {
        const fallbackText = action.text?.trim() || action.items?.map((item) => item.text.trim()).find(Boolean) || action.id?.trim();
        if (fallbackText) {
          this.manualTodos.push({ id: crypto.randomUUID(), text: fallbackText, done: Boolean(action.done), createdAt: new Date().toISOString() });
        }
      }
      this.refreshPlanPanelIfOpen();
      return this.t("todoActionResult", { summary: this.manualTodosSummary() });
    }

    this.manualTodos = this.manualTodos.filter((todo) => !this.todoMatchesAction(todo, action));
    this.refreshPlanPanelIfOpen();
    return this.t("todoActionResult", { summary: this.manualTodosSummary() });
  }

  private findManualTodo(action: TodoAction): ManualTodo | null {
    return this.manualTodos.find((todo) => this.todoMatchesAction(todo, action)) ?? null;
  }

  private todoMatchesAction(todo: ManualTodo, action: TodoAction): boolean {
    const id = action.id?.trim();
    if (id && todo.id === id) return true;
    const text = action.text?.trim();
    return Boolean(text && todo.text.trim() === text);
  }

  private manualTodosSummary(): string {
    if (!this.manualTodos.length) return this.t("noManualTodos");
    return this.manualTodos.map((todo) => `- [${todo.done ? "x" : " "}] ${todo.text} (${todo.id})`).join("\n");
  }

  private async executeAutomationAction(action: AutomationAction): Promise<string> {
    if (action.op === "list") {
      return this.t("automationActionResult", { summary: this.plugin.formatAutomations(await this.plugin.loadAutomations()) });
    }

    if (action.op === "remove") {
      const id = action.id?.trim();
      if (!id) throw new Error("automation remove requires id");
      const removed = await this.plugin.removeAutomation(id);
      if (!removed) throw new Error(this.t("automationNotFound", { id }));
      return this.t("automationActionResult", { summary: this.plugin.formatAutomations(await this.plugin.loadAutomations()) });
    }

    if (action.op === "run") {
      const id = action.id?.trim();
      if (!id) throw new Error("automation run requires id");
      const result = await this.plugin.runAutomationById(id);
      return this.t("automationActionResult", { summary: result.path ? this.t("automationLogSaved", { path: result.path }) : trimContext(result.text, 1200) });
    }

    const task = await this.plugin.upsertAutomationFromAction(action);
    return this.t("automationActionResult", { summary: this.plugin.formatAutomations([task]) });
  }

  private refreshPlanPanelIfOpen(): void {
    if (this.activeHeaderMenu === "plan" && this.headerMenuEl && !this.headerMenuEl.hasClass("is-hidden")) {
      this.openPlanMenu();
    }
  }

  private async executeCommandAction(command: string, args: Record<string, unknown>): Promise<string> {
    const normalized = command.trim();
    if (!normalized) throw new Error(this.t("commandUnknown", { command }));
    if (!this.plugin.settings.commandBusEnabled) {
      throw new Error(this.t("commandBlocked", { reason: this.t("settingsCommandBusEnabled") }));
    }

    if (normalized === "obsidian.listCommands") {
      return this.t("commandExecuted", { command: normalized, result: this.listObsidianCommands(args) });
    }

    if (normalized === "obsidian.execute") {
      if (!this.plugin.settings.executeObsidianCommands) {
        throw new Error(this.t("commandBlocked", { reason: this.t("settingsExecuteObsidianCommands") }));
      }
      const id = typeof args.id === "string" ? args.id.trim() : "";
      if (!id) throw new Error("obsidian.execute requires args.id");
      return this.t("commandExecuted", { command: normalized, result: this.executeObsidianCommand(id) });
    }

    if (normalized === "cancip.rebuildIndex") {
      await this.refreshVaultIndex(true);
      return this.t("commandExecuted", { command: normalized, result: this.t("done") });
    }

    if (normalized === "cancip.reviewGate") {
      const result = await this.plugin.buildReviewGate(args);
      return this.t("commandExecuted", { command: normalized, result: formatReviewGateResult(result) });
    }

    if (normalized === "cancip.reviewGate.list") {
      const limit = clampInt(args.limit, 12, 1, 50);
      const packages = await this.plugin.listReviewGates(limit);
      return this.t("commandExecuted", { command: normalized, result: packages.length ? packages.join("\n") : this.t("none") });
    }

    if (normalized === "cancip.sessionEvents") {
      const limit = clampInt(args.limit, 50, 1, 200);
      const sessionId = typeof args.sessionId === "string" ? args.sessionId.trim() : "";
      const events = await this.readSessionEvents(limit, sessionId || undefined);
      return this.t("commandExecuted", { command: normalized, result: this.formatSessionEvents(events, limit) });
    }

    if (normalized === "cancip.installedPlugins") {
      return this.t("commandExecuted", { command: normalized, result: await this.installedPluginsSummary(args) });
    }

    if (normalized === "cancip.searchVault") {
      const query = typeof args.query === "string" ? args.query.trim() : "";
      if (!query) throw new Error("cancip.searchVault requires args.query");
      const limit = clampInt(args.limit, this.plugin.settings.maxContextFiles, 1, 20);
      const hits = await this.searchVault(query, limit);
      const result = formatSearchHitsForCommand(hits);
      return this.t("commandExecuted", { command: normalized, result });
    }

    if (normalized === "cancip.localVersionCommit") {
      const result = await this.plugin.createLocalVersionCommit("manual", "manual snapshot from command bus");
      return this.t("commandExecuted", { command: normalized, result: this.plugin.describeLocalVersionResult(result) });
    }

    if (normalized === "cancip.importCodexMemory") {
      const result = await this.plugin.importCodexCoreMemory(true);
      return this.t("commandExecuted", { command: normalized, result: this.t("codexMemoryImported", { count: result.count, path: result.folder }) });
    }

    if (normalized === "cancip.automation.list") {
      return this.t("commandExecuted", { command: normalized, result: this.plugin.formatAutomations(await this.plugin.loadAutomations()) });
    }

    if (normalized === "cancip.automation.templates") {
      return this.t("commandExecuted", { command: normalized, result: this.t("automationTemplates", { summary: formatAutomationTemplates(cancipAutomationTemplates()) }) });
    }

    if (normalized === "cancip.automation.addTemplate") {
      const id = typeof args.id === "string" ? args.id.trim() : "";
      const template = cancipAutomationTemplates().find((item) => item.id === id);
      if (!template) throw new Error(`unknown automation template: ${id}`);
      const task = await this.plugin.upsertAutomationFromAction({
        type: "automation",
        op: "add",
        id: template.id,
        title: template.title,
        prompt: template.prompt,
        command: template.command,
        args: template.args,
        schedule: template.schedule,
        enabled: template.enabled,
        intervalMinutes: template.intervalMinutes,
        hour: template.hour
      });
      return this.t("commandExecuted", { command: normalized, result: this.t("automationTemplateAdded", { title: task.title }) });
    }

    if (normalized === "cancip.automation.add") {
      const task = await this.plugin.upsertAutomationFromAction({
        type: "automation",
        op: "add",
        title: typeof args.title === "string" ? args.title : undefined,
        prompt: typeof args.prompt === "string" ? args.prompt : undefined,
        command: typeof args.command === "string" ? args.command : undefined,
        args: isRecord(args.args) ? args.args : undefined,
        schedule: isAutomationSchedule(args.schedule) ? args.schedule : undefined,
        enabled: typeof args.enabled === "boolean" ? args.enabled : undefined,
        intervalMinutes: clampInt(args.intervalMinutes, 60, 1, 1440),
        hour: clampInt(args.hour, 9, 0, 23)
      });
      return this.t("commandExecuted", { command: normalized, result: this.plugin.formatAutomations([task]) });
    }

    if (normalized === "cancip.automation.run") {
      const id = typeof args.id === "string" ? args.id.trim() : "";
      if (!id) throw new Error("cancip.automation.run requires args.id");
      const result = await this.plugin.runAutomationById(id);
      return this.t("commandExecuted", { command: normalized, result: result.path ? this.t("automationLogSaved", { path: result.path }) : trimContext(result.text, 1200) });
    }

    if (normalized === "cancip.automation.remove") {
      const id = typeof args.id === "string" ? args.id.trim() : "";
      if (!id) throw new Error("cancip.automation.remove requires args.id");
      const removed = await this.plugin.removeAutomation(id);
      if (!removed) throw new Error(this.t("automationNotFound", { id }));
      return this.t("commandExecuted", { command: normalized, result: this.plugin.formatAutomations(await this.plugin.loadAutomations()) });
    }

    if (normalized === "cancip.previewVaultSearch") {
      await this.previewVaultSearch();
      return this.t("commandExecuted", { command: normalized, result: this.t("done") });
    }

    if (normalized === "github.help") {
      if (!this.plugin.settings.githubCommandsEnabled) {
        throw new Error(this.t("commandBlocked", { reason: this.t("settingsGithubCommandsEnabled") }));
      }
      return this.t("commandExecuted", {
        command: normalized,
        result: [
          "GitHub command bus targets:",
          "github.status, github.repo, github.issues, github.pulls, github.releases, github.workflowRuns, github.branches, github.file, github.createIssue, github.installObsidianPlugin.",
          "Commands use GitHub REST API from settings, so native gh/git binaries are not required on mobile.",
          "Use args.owner/args.repo or settings GitHub owner/repo. Use args.path for github.file, args.title/body for github.createIssue, and args.pluginId/tag for github.installObsidianPlugin."
        ].join("\n")
      });
    }

    if (normalized.startsWith("github.")) {
      if (!this.plugin.settings.githubCommandsEnabled) {
        throw new Error(this.t("commandBlocked", { reason: this.t("settingsGithubCommandsEnabled") }));
      }
      return this.t("commandExecuted", { command: normalized, result: await this.executeGithubCommand(normalized, args) });
    }

    if (normalized === "javascript.eval" || normalized === "js.eval" || normalized === "browser.eval") {
      throw new Error(this.t("commandBlocked", { reason: "raw JavaScript eval is not enabled; use structured commands" }));
    }

    throw new Error(this.t("commandUnknown", { command: normalized }));
  }

  private async installedPluginsSummary(args: Record<string, unknown>): Promise<string> {
    const adapter = this.app.vault.adapter;
    const includeDisabled = Boolean(args.includeDisabled);
    const enabledIds = await this.readEnabledCommunityPluginIds();
    const ids = new Set<string>(enabledIds);

    if (includeDisabled) {
      try {
        const listing = await adapter.list(".obsidian/plugins");
        for (const folder of listing.folders) {
          const id = normalizePath(folder).split("/").pop()?.trim();
          if (!id || id === "_backups" || id.startsWith(".")) continue;
          ids.add(id);
        }
      } catch {
        // community-plugins.json is the authoritative enabled list; folder listing is optional.
      }
    }

    const plugins: InstalledPluginInfo[] = [];
    for (const id of [...ids].sort((a, b) => a.localeCompare(b))) {
      const path = `.obsidian/plugins/${id}`;
      const manifestPath = `${path}/manifest.json`;
      let manifest: unknown = null;
      let error = "";
      if (await adapter.exists(manifestPath)) {
        try {
          manifest = JSON.parse(await adapter.read(manifestPath)) as unknown;
        } catch (readError) {
          error = readError instanceof Error ? readError.message : String(readError);
        }
      }
      const record = isRecord(manifest) ? manifest : {};
      plugins.push({
        id,
        name: typeof record.name === "string" && record.name.trim() ? record.name.trim() : id,
        version: typeof record.version === "string" ? record.version.trim() : "",
        path,
        enabled: enabledIds.includes(id),
        manifestFound: Boolean(manifest),
        error
      });
    }

    return formatInstalledPluginsSummary(plugins, enabledIds.length, includeDisabled);
  }

  private async readEnabledCommunityPluginIds(): Promise<string[]> {
    const adapter = this.app.vault.adapter;
    const path = ".obsidian/community-plugins.json";
    if (!(await adapter.exists(path))) return [];
    const raw = await adapter.read(path);
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) throw new Error(`${path} is not a JSON array`);
    return parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  }

  private listObsidianCommands(args: Record<string, unknown>): string {
    const query = typeof args.query === "string" ? args.query.toLowerCase().trim() : "";
    const requestedLimit = typeof args.limit === "number" ? args.limit : Number.parseInt(String(args.limit ?? ""), 10);
    const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(80, requestedLimit)) : 40;
    const commands = this.obsidianCommandEntries()
      .filter((item) => !query || item.id.toLowerCase().includes(query) || item.name.toLowerCase().includes(query))
      .slice(0, limit);
    if (!commands.length) return this.t("none");
    return commands.map((item) => `${item.id} — ${item.name}`).join("\n");
  }

  private async executeGithubCommand(command: string, args: Record<string, unknown>): Promise<string> {
    const limit = clampInt(args.limit, 10, 1, 50);

    if (command === "github.status") {
      const json = await this.githubRequest("GET", "/rate_limit");
      return `${this.t("githubAcceleratorStatus", { url: this.plugin.settings.githubApiBaseUrl || DEFAULT_SETTINGS.githubApiBaseUrl })}\n${formatGithubRateLimit(json)}`;
    }

    const repo = this.githubRepoArgs(args);

    if (command === "github.repo") {
      const json = await this.githubRequest("GET", `/repos/${repo.owner}/${repo.repo}`);
      return formatGithubRepo(json);
    }

    if (command === "github.issues") {
      const state = parseGithubState(args.state);
      const json = await this.githubRequest("GET", `/repos/${repo.owner}/${repo.repo}/issues`, { state, per_page: String(limit) });
      return formatGithubItems(json, "issue");
    }

    if (command === "github.pulls") {
      const state = parseGithubState(args.state);
      const json = await this.githubRequest("GET", `/repos/${repo.owner}/${repo.repo}/pulls`, { state, per_page: String(limit) });
      return formatGithubItems(json, "pull");
    }

    if (command === "github.releases") {
      const json = await this.githubRequest("GET", `/repos/${repo.owner}/${repo.repo}/releases`, { per_page: String(limit) });
      return formatGithubItems(json, "release");
    }

    if (command === "github.workflowRuns") {
      const json = await this.githubRequest("GET", `/repos/${repo.owner}/${repo.repo}/actions/runs`, { per_page: String(limit) });
      return formatGithubWorkflowRuns(json);
    }

    if (command === "github.branches") {
      const json = await this.githubRequest("GET", `/repos/${repo.owner}/${repo.repo}/branches`, { per_page: String(limit) });
      return formatGithubItems(json, "branch");
    }

    if (command === "github.file") {
      const path = typeof args.path === "string" ? args.path.trim().replace(/^\/+/, "") : "";
      if (!path) throw new Error("github.file requires args.path");
      const ref = typeof args.ref === "string" && args.ref.trim() ? args.ref.trim() : undefined;
      const json = await this.githubRequest("GET", `/repos/${repo.owner}/${repo.repo}/contents/${encodePathParts(path)}`, ref ? { ref } : undefined);
      return formatGithubFile(json);
    }

    if (command === "github.createIssue") {
      if (!this.plugin.settings.githubToken.trim()) throw new Error(this.t("githubTokenMissing"));
      const title = typeof args.title === "string" ? args.title.trim() : "";
      const body = typeof args.body === "string" ? args.body : "";
      if (!title) throw new Error("github.createIssue requires args.title");
      const json = await this.githubRequest("POST", `/repos/${repo.owner}/${repo.repo}/issues`, undefined, { title, body });
      return formatGithubCreatedIssue(json);
    }

    if (command === "github.installObsidianPlugin") {
      return await this.installObsidianPluginFromGithub(repo, args);
    }

    throw new Error(this.t("commandUnknown", { command }));
  }

  private githubRepoArgs(args: Record<string, unknown>): { owner: string; repo: string } {
    const repoArg = typeof args.repo === "string" ? args.repo.trim() : "";
    const split = repoArg.includes("/") ? repoArg.split("/", 2) : null;
    const owner = (typeof args.owner === "string" && args.owner.trim()) || split?.[0] || this.plugin.settings.githubOwner.trim();
    const repo = (split?.[1] || repoArg || this.plugin.settings.githubRepo.trim()).replace(/^\/+|\/+$/g, "");
    if (!owner || !repo) throw new Error(this.t("githubNotConfigured"));
    return { owner: encodeURIComponent(owner), repo: encodeURIComponent(repo) };
  }

  private async githubRequest(method: "GET" | "POST", path: string, query?: Record<string, string | undefined>, body?: unknown): Promise<unknown> {
    const base = (this.plugin.settings.githubApiBaseUrl || DEFAULT_SETTINGS.githubApiBaseUrl).trim().replace(/\/+$/, "");
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== "") params.set(key, value);
    }
    const url = `${base}${path}${params.size ? `?${params.toString()}` : ""}`;
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const token = this.plugin.settings.githubToken.trim();
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await requestUrl({
      url,
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      throw: false
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`GitHub HTTP ${response.status}: ${response.text.slice(0, 220)}`);
    }
    return response.json ?? parseJsonFallback(response.text);
  }

  private async installObsidianPluginFromGithub(repo: { owner: string; repo: string }, args: Record<string, unknown>): Promise<string> {
    const forcedPluginId = typeof args.pluginId === "string" && args.pluginId.trim() ? args.pluginId.trim() : "";
    const pluginId = forcedPluginId || decodeURIComponent(repo.repo);
    const tag = typeof args.tag === "string" && args.tag.trim() ? args.tag.trim() : "latest";
    const releasePath = tag === "latest" ? `/repos/${repo.owner}/${repo.repo}/releases/latest` : `/repos/${repo.owner}/${repo.repo}/releases/tags/${encodeURIComponent(tag)}`;
    const release = await this.githubRequest("GET", releasePath);
    if (!isRecord(release)) throw new Error("Invalid GitHub release response");
    const tagName = typeof release.tag_name === "string" ? release.tag_name : tag;
    const assets = Array.isArray(release.assets) ? release.assets.filter(isRecord) : [];
    const assetUrl = (name: string): string => {
      const asset = assets.find((item) => String(item.name ?? "") === name);
      const browserUrl = typeof asset?.browser_download_url === "string" ? asset.browser_download_url : "";
      if (browserUrl) return this.accelerateGithubDownloadUrl(browserUrl);
      return this.accelerateGithubDownloadUrl(`https://github.com/${decodeURIComponent(repo.owner)}/${decodeURIComponent(repo.repo)}/releases/download/${encodeURIComponent(tagName)}/${name}`);
    };

    const manifestText = await this.githubDownloadText(assetUrl("manifest.json"));
    const manifest = JSON.parse(manifestText) as unknown;
    if (!isRecord(manifest)) throw new Error("Downloaded manifest.json is invalid");
    const manifestId = typeof manifest.id === "string" && manifest.id.trim() ? manifest.id.trim() : pluginId;
    const targetPluginId = forcedPluginId || manifestId;
    const mainJs = await this.githubDownloadText(assetUrl("main.js"));
    const stylesCss = await this.githubDownloadText(assetUrl("styles.css")).catch(() => "");

    const targetDir = `.obsidian/plugins/${targetPluginId}`;
    await ensureFolder(this.app.vault.adapter, targetDir);
    await this.app.vault.adapter.write(`${targetDir}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
    await this.app.vault.adapter.write(`${targetDir}/main.js`, mainJs);
    if (stylesCss) await this.app.vault.adapter.write(`${targetDir}/styles.css`, stylesCss);
    return `Installed ${targetPluginId} from ${decodeURIComponent(repo.owner)}/${decodeURIComponent(repo.repo)} ${tagName}\n${targetDir}`;
  }

  private accelerateGithubDownloadUrl(url: string): string {
    const prefix = this.plugin.settings.githubDownloadBaseUrl.trim().replace(/\/+$/, "");
    if (!prefix) return url;
    return `${prefix}/${url}`;
  }

  private async githubDownloadText(url: string): Promise<string> {
    const response = await requestUrl({
      url,
      method: "GET",
      throw: false
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`GitHub download HTTP ${response.status}: ${response.text.slice(0, 160)}`);
    }
    return response.text;
  }

  private executeObsidianCommand(id: string): string {
    const api = this.obsidianCommandApi();
    const known = api.commands?.[id];
    if (!known) throw new Error(this.t("commandUnknown", { command: id }));
    const executed = api.executeCommandById?.(id);
    if (executed === false) throw new Error(`Obsidian command returned false: ${id}`);
    return `${id} — ${known.name ?? id}`;
  }

  private obsidianCommandEntries(): Array<{ id: string; name: string }> {
    const api = this.obsidianCommandApi();
    return Object.entries(api.commands ?? {})
      .map(([id, item]) => ({ id, name: typeof item.name === "string" ? item.name : id }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  private obsidianCommandApi(): ObsidianCommandApi {
    return ((this.app as App & { commands?: ObsidianCommandApi }).commands ?? {});
  }

  private describeAction(action: CancipAction): string {
    if (action.type === "command") return this.t("actionCommand", { command: action.command, args: JSON.stringify(action.args ?? {}) });
    if (action.type === "todo") return this.t("actionTodo", { op: action.op });
    if (action.type === "automation") return this.t("actionAutomation", { op: action.op });
    if (action.type === "config") return this.t("actionConfig", { path: action.path?.trim() || CANCIP_CONFIG_PATH });
    const path = action.path;
    if (action.type === "read") {
      const suffix = action.query?.trim() ? ` query "${trimContext(action.query.trim(), 60)}"` : "";
      return `${this.t("actionRead", { path, content: "" }).trim()}${suffix}`;
    }
    if (action.type === "write") return this.t("actionWrite", { path });
    if (action.type === "append") return this.t("actionAppend", { path });
    if (action.type === "patch") return `${this.t("actionPatch", { path })}${action.regex ? " regex" : ""}`;
    if (action.type === "mkdir") return this.t("actionMkdir", { path });
    if (action.type === "rename") return this.t("actionRename", { path, newPath: action.newPath });
    if (action.type === "move") return this.t("actionMove", { path, newPath: action.newPath });
    if (action.type === "delete") return this.t("actionDelete", { path, mode: action.permanent ? "remove" : "trash" });
    return this.t("actionCopy", { path, newPath: action.newPath });
  }

  private stopRequest(options: { drainQueue?: boolean; clearQueue?: boolean; notice?: boolean } = {}): void {
    const { drainQueue = true, clearQueue = false, notice = true } = options;
    if (clearQueue) {
      this.queuedPrompts = [];
      this.renderQueueStatus();
    }
    const request = this.activeRequest;
    this.drainQueueAfterRequest = drainQueue;
    request?.abort();
    if (request && this.isCurrentRequest(request)) this.clearRequest(request);
    this.setStatus(clearQueue ? this.t("queueCleared") : this.t("stopped"));
    if (!drainQueue || !this.queuedPrompts.length) void this.updateCurrentSessionStatus("idle", false);
    if (notice) new Notice(clearQueue ? this.t("queueCleared") : this.t("stopped"));
    if (drainQueue) {
      window.setTimeout(() => {
        this.drainQueueAfterRequest = true;
        void this.drainQueuedPrompts();
      }, 0);
    } else {
      this.drainQueueAfterRequest = true;
    }
  }

  private recentTranscript(): string {
    const limit = this.plugin.settings.maxRecentTranscriptMessages;
    if (limit <= 0) return "";
    return this.messages
      .slice(-(limit + 1), -1)
      .filter((message) => !prepareMessageDisplay(redactSensitiveText(message.content)).processOnly)
      .map((message) => `${message.role}: ${trimContext(messageOutlineText(message.content) || redactSensitiveText(message.content), 700)}`)
      .join("\n\n");
  }

  private sessionWorkingState(): string {
    const recentMessages = this.messages.slice(-12);
    const lines: string[] = [];
    const recentUsers = recentMessages.filter((message) => message.role === "user").slice(-3);
    const recentAssistants = recentMessages.filter((message) => message.role === "assistant").slice(-3);
    const recentRuns = recentMessages.flatMap((message) => message.toolRuns ?? []).slice(-10);
    if (recentUsers.length) {
      lines.push(`Recent user goals:\n${recentUsers.map((message) => `- ${trimContext(redactSensitiveText(messageOutlineText(message.content) || message.content), 220)}`).join("\n")}`);
    }
    if (recentAssistants.length) {
      lines.push(`Recent Cancip replies:\n${recentAssistants.map((message) => `- ${trimContext(redactSensitiveText(messageOutlineText(message.content) || message.content), 220)}`).join("\n")}`);
    }
    if (recentRuns.length) {
      lines.push(`Recent tool results:\n${recentRuns.map((run) => {
        const detail = run.error || run.result || "";
        return `- ${run.status}: ${trimContext(redactSensitiveText(run.summary), 160)}${detail ? ` => ${trimContext(redactSensitiveText(detail).replace(/\r?\n/g, " "), 260)}` : ""}`;
      }).join("\n")}`);
    }
    if (!lines.length) return "";
    lines.push("Rule: continue from this state. Do not repeat a failed path unless you explicitly explain why it should now work. If you planned to change A, inspect/modify A before switching to B.");
    return trimContext(lines.join("\n\n"), 5000);
  }

  private renderMessages(): void {
    if (this.shouldDeferMessageRender()) {
      this.pendingMessageRender = true;
      return;
    }
    this.pendingMessageRender = false;
    const scrollSnapshot = this.captureMessageScrollSnapshot();
    this.messagesEl.empty();
    if (!this.messages.length) {
      const empty = this.messagesEl.createDiv({ cls: "obcc-empty" });
      empty.createEl("strong", { text: this.t("ready") });
      this.afterMessagesRendered({ stickToBottom: true, topMessageId: "", topOffset: 0, rawScrollTop: 0 });
      return;
    }
    const rendered = this.messages.map((message, index) => ({
      message,
      display: message.role === "assistant" ? prepareMessageDisplay(redactSensitiveText(message.content)) : emptyMessageDisplay(redactSensitiveText(message.content)),
      index
    }));
    const finalAssistantIndex = this.lastFinalAssistantMessageIndex(rendered);
    let processGroup: RenderedMessage[] = [];
    const flushProcessGroup = (): void => {
      if (!processGroup.length) return;
      this.renderProcessRecord(processGroup);
      processGroup = [];
    };

    for (const item of rendered) {
      const shouldGroupProcess = item.message.role === "assistant" && item.index < finalAssistantIndex && (item.display.processOnly || item.display.hasProcessFold);
      if (shouldGroupProcess) {
        processGroup.push(item);
        continue;
      }
      flushProcessGroup();
      this.renderSingleMessage(item, finalAssistantIndex);
    }
    flushProcessGroup();
    this.afterMessagesRendered(scrollSnapshot);
  }

  private afterMessagesRendered(scrollSnapshot: MessageScrollSnapshot): void {
    this.messagesEl.style.minHeight = "0";
    this.messagesEl.style.overflowY = "auto";
    if ((this.autoFollowMessages || scrollSnapshot.stickToBottom) && !this.userPinnedScroll) {
      this.scrollMessagesToBottom(false);
    } else {
      this.restoreMessageScrollSnapshot(scrollSnapshot);
    }
  }

  private captureMessageScrollSnapshot(): MessageScrollSnapshot {
    if (!this.messagesEl || !this.messagesEl.isConnected) {
      return { stickToBottom: true, topMessageId: "", topOffset: 0, rawScrollTop: 0 };
    }
    const stickToBottom = this.shouldStickToMessageBottom();
    if (stickToBottom && !this.userPinnedScroll) {
      return { stickToBottom: true, topMessageId: "", topOffset: 0, rawScrollTop: this.messagesEl.scrollTop };
    }
    const containerTop = this.messagesEl.getBoundingClientRect().top;
    const messages = Array.from(this.messagesEl.querySelectorAll<HTMLElement>("[data-message-id]"));
    const top = messages.find((message) => message.getBoundingClientRect().bottom >= containerTop + 1) ?? messages[0];
    if (!top?.dataset.messageId) {
      return { stickToBottom: false, topMessageId: "", topOffset: this.messagesEl.scrollTop, rawScrollTop: this.messagesEl.scrollTop };
    }
    return {
      stickToBottom: false,
      topMessageId: top.dataset.messageId,
      topOffset: top.getBoundingClientRect().top - containerTop,
      rawScrollTop: this.messagesEl.scrollTop
    };
  }

  private restoreMessageScrollSnapshot(snapshot: MessageScrollSnapshot): void {
    window.requestAnimationFrame(() => {
      if (!this.messagesEl) return;
      this.programmaticScrollRestore = true;
      if (snapshot.topMessageId) {
        const target = this.messagesEl.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(snapshot.topMessageId)}"]`);
        if (target) {
          const containerTop = this.messagesEl.getBoundingClientRect().top;
          const nextOffset = target.getBoundingClientRect().top - containerTop;
          this.messagesEl.scrollTop += nextOffset - snapshot.topOffset;
        } else {
          this.messagesEl.scrollTop = Math.min(snapshot.rawScrollTop, Math.max(0, this.messagesEl.scrollHeight - this.messagesEl.clientHeight));
        }
      } else {
        this.messagesEl.scrollTop = Math.min(snapshot.rawScrollTop, Math.max(0, this.messagesEl.scrollHeight - this.messagesEl.clientHeight));
      }
      window.setTimeout(() => {
        this.programmaticScrollRestore = false;
        if (!this.autoFollowMessages) this.userPinnedScroll = !this.shouldStickToMessageBottom();
        this.syncScrollBottomButton();
      }, 0);
      this.syncScrollBottomButton();
    });
  }

  private shouldDeferMessageRender(): boolean {
    return this.userInteractingWithMessages;
  }

  private markMessageScrollInteraction(): void {
    if (this.programmaticScrollRestore) {
      this.syncScrollBottomButton();
      return;
    }
    this.autoFollowMessages = false;
    this.userInteractingWithMessages = true;
    if (this.messageInteractionIdleTimer !== null) {
      window.clearTimeout(this.messageInteractionIdleTimer);
    }
    this.messageInteractionIdleTimer = window.setTimeout(() => {
      this.userInteractingWithMessages = false;
      this.messageInteractionIdleTimer = null;
      if (this.pendingMessageRender) {
        this.pendingMessageRender = false;
        this.renderMessages();
      }
    }, 900);
  }

  private shouldStickToMessageBottom(): boolean {
    if (!this.messagesEl || this.messagesEl.scrollHeight <= this.messagesEl.clientHeight + 1) return true;
    const distanceFromBottom = this.messagesEl.scrollHeight - this.messagesEl.scrollTop - this.messagesEl.clientHeight;
    return distanceFromBottom < 96;
  }

  private scrollMessagesToBottom(smooth: boolean): void {
    if (!this.messagesEl) return;
    this.autoFollowMessages = true;
    this.userPinnedScroll = false;
    this.userInteractingWithMessages = false;
    if (this.messageInteractionIdleTimer !== null) {
      window.clearTimeout(this.messageInteractionIdleTimer);
      this.messageInteractionIdleTimer = null;
    }
    if (this.pendingMessageRender) {
      this.pendingMessageRender = false;
      this.renderMessages();
    }
    window.requestAnimationFrame(() => {
      this.programmaticScrollRestore = true;
      this.messagesEl.scrollTo({
        top: this.messagesEl.scrollHeight,
        behavior: smooth ? "smooth" : "auto"
      });
      if (this.programmaticScrollReleaseTimer !== null) window.clearTimeout(this.programmaticScrollReleaseTimer);
      this.programmaticScrollReleaseTimer = window.setTimeout(() => {
        this.programmaticScrollRestore = false;
        this.programmaticScrollReleaseTimer = null;
        this.syncScrollBottomButton();
      }, smooth ? 260 : 40);
      this.syncScrollBottomButton();
    });
  }

  private syncScrollBottomButton(): void {
    if (!this.scrollBottomButtonEl || !this.messagesEl) return;
    const show = !this.shouldStickToMessageBottom();
    this.scrollBottomButtonEl.toggleClass("is-hidden", !show);
  }

  private renderSingleMessage(itemData: RenderedMessage, finalAssistantIndex: number): void {
    const { message, display, index } = itemData;
    const item = this.messagesEl.createDiv({ cls: `obcc-message obcc-${message.role}` });
    item.dataset.messageId = message.id;
    if (message.role === "user") {
      item.addClass("is-user-message");
      const copyButton = item.createEl("button", {
        cls: "obcc-message-copy obcc-user-copy",
        attr: { type: "button", title: this.t("copyMessage"), "aria-label": this.t("copyMessage") }
      });
      setIcon(copyButton, "copy");
      copyButton.addEventListener("click", () => {
        void this.copyMessage(message);
      });
      const contentEl = item.createDiv({ cls: "obcc-content obcc-plain-content" });
      this.renderPlainMessage(contentEl, display.visibleContent);
      return;
    }
    const head = item.createDiv({ cls: "obcc-message-head" });
    head.createDiv({ cls: "obcc-role", text: message.role });
    const copyButton = head.createEl("button", {
      cls: "obcc-message-copy",
      attr: { type: "button", title: this.t("copyMessage"), "aria-label": this.t("copyMessage") }
    });
    setIcon(copyButton, "copy");
    copyButton.addEventListener("click", () => {
      void this.copyMessage(message);
    });
    const contentEl = item.createDiv({ cls: "obcc-content markdown-rendered" });
    const shouldCollapseProcessMessage = display.processOnly || (message.role === "assistant" && display.hasProcessFold && finalAssistantIndex > index);
    if (shouldCollapseProcessMessage) {
      item.addClass("is-process-collapsed");
      this.renderCollapsedProcessMessage(contentEl, display);
    } else {
      void MarkdownRenderer.render(this.app, display.visibleContent, contentEl, this.markdownSourcePath(), this);
    }
    this.renderHiddenToolJson(item, display.hiddenToolBlocks, display.hasProcessFold);
    this.renderChoiceCards(item, message, display.visibleContent);
    this.renderToolRuns(item, message);
  }

  private renderPlainMessage(parent: HTMLElement, content: string): void {
    const text = content.trim();
    parent.createDiv({ cls: "obcc-plain-text", text: text || " " });
  }

  private renderProcessRecord(items: RenderedMessage[]): void {
    const item = this.messagesEl.createDiv({ cls: "obcc-message obcc-assistant is-process-record" });
    item.dataset.messageId = `process-${items.map((rendered) => rendered.message.id).join("-")}`;
    const head = item.createDiv({ cls: "obcc-message-head" });
    head.createDiv({ cls: "obcc-role", text: this.t("processRecord") });
    const contentEl = item.createDiv({ cls: "obcc-content markdown-rendered obcc-process-record-content" });
    const details = contentEl.createEl("details", { cls: "obcc-process-summary obcc-process-record-details" });
    this.wireDetails(details, `process-record:${items.map((rendered) => rendered.message.id).join(",")}`);
    this.createProcessSummary(details, `${this.t("processRecord")} (${items.length})`);
    const body = details.createDiv({ cls: "obcc-process-body" });
    for (const [index, rendered] of items.entries()) {
      const step = body.createEl("details", { cls: "obcc-process-summary obcc-process-step" });
      this.wireDetails(step, `process-step:${rendered.message.id}:${index}`);
      this.createProcessSummary(step, messageOutlineText(rendered.message.content) || this.t("processDetails"));
      const stepBody = step.createDiv({ cls: "obcc-process-body" });
      if (rendered.display.visibleContent.trim()) {
        void MarkdownRenderer.render(this.app, rendered.display.visibleContent, stepBody, this.markdownSourcePath(), this);
      }
      this.renderHiddenToolJson(stepBody, rendered.display.hiddenToolBlocks, rendered.display.hasProcessFold);
      this.renderToolRuns(stepBody, rendered.message);
    }
  }

  private createProcessSummary(details: HTMLDetailsElement, text: string): HTMLElement {
    const summary = details.createEl("summary", { text });
    summary.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      details.open = !details.open;
      this.rememberDetailsState(details);
    });
    summary.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      event.stopPropagation();
      details.open = !details.open;
      this.rememberDetailsState(details);
    });
    return summary;
  }

  private wireDetails(details: HTMLDetailsElement, key: string, defaultOpen = false): void {
    details.dataset.foldKey = key;
    details.open = this.detailsOpenState.get(key) ?? defaultOpen;
    details.addEventListener("toggle", () => this.rememberDetailsState(details));
  }

  private rememberDetailsState(details: HTMLDetailsElement): void {
    const key = details.dataset.foldKey;
    if (!key) return;
    this.detailsOpenState.set(key, details.open);
  }

  private lastFinalAssistantMessageIndex(renderedMessages?: RenderedMessage[]): number {
    const rendered = renderedMessages ?? this.messages.map((message, index) => ({
      message,
      display: message.role === "assistant" ? prepareMessageDisplay(redactSensitiveText(message.content)) : emptyMessageDisplay(redactSensitiveText(message.content)),
      index
    }));
    for (let index = rendered.length - 1; index >= 0; index -= 1) {
      const { message, display } = rendered[index];
      if (message.role !== "assistant") continue;
      if (isProgressMessage(message.content)) continue;
      if (!display.processOnly && display.visibleContent.trim()) return rendered[index].index;
    }
    return -1;
  }

  private renderCollapsedProcessMessage(parent: HTMLElement, display: MessageDisplay): void {
    const details = parent.createEl("details", { cls: "obcc-process-summary" });
    const messageId = parent.closest<HTMLElement>("[data-message-id]")?.dataset.messageId ?? crypto.randomUUID();
    this.wireDetails(details, `collapsed-process:${messageId}`);
    this.createProcessSummary(details, messageOutlineText(display.visibleContent) || this.t("processDetails"));
    const body = details.createDiv({ cls: "obcc-process-body" });
    if (display.visibleContent.trim()) {
      void MarkdownRenderer.render(this.app, display.visibleContent, body, this.markdownSourcePath(), this);
    }
  }

  private async copyMessage(message: ChatMessage): Promise<void> {
    const safeContent = redactSensitiveText(message.content);
    const text = messageOutlineText(safeContent) || safeContent;
    try {
      await navigator.clipboard.writeText(text);
      this.setStatus(this.t("copyDone"));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      new Notice(this.t("copyFailed", { reason }));
    }
  }

  private async copySessionId(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.sessionId);
      this.setStatus(this.t("copyDone"));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      new Notice(this.t("copyFailed", { reason }));
    }
  }

  private renderHiddenToolJson(parent: HTMLElement, blocks: FoldedMessageBlock[], hasProcessFold = false): void {
    if (!blocks.length) return;
    const details = parent.createEl("details", { cls: "obcc-tool-json" });
    const messageId = parent.closest<HTMLElement>("[data-message-id]")?.dataset.messageId ?? "unknown";
    this.wireDetails(details, `tool-json:${messageId}:${blocks.map((block) => block.title).join("|")}`);
    details.createEl("summary", { text: `${hasProcessFold ? this.t("processDetails") : this.t("toolJsonDetails")} (${blocks.length})` });
    for (const block of blocks) {
      const title = details.createDiv({ cls: "obcc-folded-block-title", text: block.title });
      title.setAttr("aria-hidden", "true");
      details.createEl("pre", { text: redactSensitiveText(block.content) });
    }
  }

  private renderChoiceCards(parent: HTMLElement, message: ChatMessage, content: string): void {
    if (message.role !== "assistant") return;
    const choices = extractChoiceOptions(content);
    if (!choices.length) return;
    const wrap = parent.createDiv({ cls: "obcc-choice-cards" });
    for (const choice of choices) {
      const button = wrap.createEl("button", {
        cls: "obcc-choice-card",
        attr: { type: "button", title: this.t("chooseOption"), "aria-label": this.t("chooseOption") }
      });
      button.createSpan({ cls: "obcc-choice-text", text: choice.text });
      button.addEventListener("click", () => {
        this.inputEl.value = choice.text;
        this.resizeInput();
        this.focusInput();
      });
    }
  }

  private renderToolRuns(parent: HTMLElement, message: ChatMessage): void {
    if (!message.toolRuns?.length) return;
    const wrap = parent.createDiv({ cls: "obcc-tool-runs" });
    for (const run of message.toolRuns) {
      const row = wrap.createDiv({ cls: `obcc-tool-run is-${run.status}` });
      const head = row.createDiv({ cls: "obcc-tool-run-head" });
      head.createSpan({ cls: "obcc-tool-run-status", text: this.toolRunStatusLabel(run.status) });
      head.createSpan({ cls: "obcc-tool-run-summary", text: run.summary });
      if (run.status === "pending") {
        const controls = head.createDiv({ cls: "obcc-tool-run-actions" });
        const runButton = controls.createEl("button", { cls: "obcc-tool-run-button", text: this.t("runTool"), attr: { type: "button" } });
        runButton.addEventListener("click", () => {
          void this.runPendingToolRun(message.id, run.id);
        });
        const rejectButton = controls.createEl("button", { cls: "obcc-tool-run-button is-secondary", text: this.t("rejectTool"), attr: { type: "button" } });
        rejectButton.addEventListener("click", () => {
          void this.rejectPendingToolRun(message.id, run.id);
        });
      }
      const detail = run.result || run.error;
      if (detail) {
        const details = row.createEl("details", { cls: "obcc-tool-run-details" });
        this.wireDetails(details, `tool-run:${message.id}:${run.id}`, run.status === "executing");
        details.createEl("summary", { cls: "obcc-tool-run-result-label", text: this.t("toolRunResult") });
        details.createEl("pre", { cls: "obcc-tool-run-result", text: trimContext(redactSensitiveText(detail), 4000) });
      }
    }
  }

  private toolRunStatusLabel(status: ToolRunStatus): string {
    if (status === "pending") return this.t("toolRunPending");
    if (status === "executing") return this.t("toolRunExecuting");
    if (status === "executed") return this.t("toolRunExecuted");
    if (status === "blocked") return this.t("toolRunBlocked");
    if (status === "rejected") return this.t("toolRunRejected");
    return this.t("toolRunFailed");
  }

  private markdownSourcePath(): string {
    return this.app.workspace.getActiveFile()?.path ?? "";
  }

  private renderSources(hits: SearchHit[]): void {
    this.sourceHits = hits;
    this.renderContextChips();
  }

  private renderContextChips(): void {
    if (!this.contextEl) return;
    this.contextEl.empty();
    const chips = this.contextChips();
    this.contextEl.toggleClass("is-hidden", !chips.length);
    if (!chips.length) return;
    for (const chip of chips) {
      const item = this.contextEl.createDiv({
        cls: `obcc-context-chip is-${chip.kind}`,
        attr: { title: chip.path }
      });
      const openButton = item.createEl("button", {
        cls: "obcc-context-open",
        attr: { type: "button", title: chip.path, "aria-label": chip.path }
      });
      setIcon(openButton.createSpan({ cls: "obcc-context-chip-icon" }), chip.icon);
      openButton.createSpan({ cls: "obcc-context-chip-name", text: chip.name });
      openButton.addEventListener("click", () => {
        void this.openContextChip(chip);
      });

      const removeButton = item.createEl("button", {
        cls: "obcc-context-remove",
        attr: { type: "button", title: this.t("clearContext"), "aria-label": this.t("clearContext") }
      });
      setIcon(removeButton, "x");
      removeButton.addEventListener("click", (event) => {
        event.stopPropagation();
        this.removeContextChip(chip);
      });
    }
  }

  private contextChips(): ContextChip[] {
    const chips: ContextChip[] = [];
    const used = new Set<string>();
    const push = (kind: string, icon: string, path: string, fallback: string, source: ContextSource, key = contextChipKey(kind, path)): void => {
      const cleanPath = path.trim();
      if (!cleanPath || used.has(key) || this.hiddenContextKeys.has(key)) return;
      used.add(key);
      chips.push({ key, kind, icon, path: cleanPath, source, name: contextChipName(cleanPath, fallback) });
    };

    const currentFile = this.plugin.settings.includeCurrentFile ? this.app.workspace.getActiveFile() : null;
    if (currentFile) push("current", "file-text", currentFile.path, currentFile.name, "file");

    for (const item of this.draftContext) {
      const path = item.path?.trim() || item.label;
      push("draft", "paperclip", path, item.label, item.source ?? this.contextSourceForPath(path), contextChipKey("draft", item.id));
    }

    return chips.slice(0, 8);
  }

  private removeContextChip(chip: ContextChip): void {
    if (chip.kind === "draft") {
      const id = chip.key.slice("draft:".length);
      this.draftContext = this.draftContext.filter((item) => item.id !== id);
    } else {
      this.hiddenContextKeys.add(chip.key);
    }
    this.renderContextChips();
    void this.saveCurrentSession();
    this.focusInput();
  }

  private async openContextChip(chip: ContextChip): Promise<void> {
    const target = this.app.vault.getAbstractFileByPath(chip.path);
    try {
      if (target instanceof TFile) {
        const leaf = this.app.workspace.getLeaf("tab");
        await leaf.openFile(target, { active: true });
        return;
      }
      if (target instanceof TFolder) {
        await this.revealFolderInNavigator(target);
        return;
      }
      if (chip.source === "folder") {
        const folder = this.app.vault.getAbstractFileByPath(normalizePath(chip.path));
        if (folder instanceof TFolder) {
          await this.revealFolderInNavigator(folder);
          return;
        }
      }
      new Notice(chip.path);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      new Notice(reason);
    }
  }

  private async revealFolderInNavigator(folder: TFolder): Promise<void> {
    let leaf: WorkspaceLeaf | null = this.app.workspace.getLeavesOfType("file-explorer")[0] ?? null;
    if (!leaf) {
      leaf = this.app.workspace.getLeftLeaf(false);
      if (leaf) await leaf.setViewState({ type: "file-explorer", active: true });
    }
    if (!leaf) return;
    await this.app.workspace.revealLeaf(leaf);
    const view = leaf.view as FileExplorerViewLike;
    await view.revealInFolder?.(folder);
  }

  private contextSourceForPath(path: string): ContextSource {
    const target = this.app.vault.getAbstractFileByPath(path);
    if (target instanceof TFile) return "file";
    if (target instanceof TFolder) return "folder";
    return "virtual";
  }

  private setStatus(text: string): void {
    if (this.statusEl) this.statusEl.setText(text);
  }

  debugLayout(): void {
    const selectors = [
      ".workspace-leaf-content[data-type=\"cancip-view\"] .view-content",
      ".obcc-root",
      ".obcc-shell",
      ".obcc-header",
      ".obcc-messages-frame",
      ".obcc-messages",
      ".obcc-footer",
      ".obcc-composer"
    ];
    const lines = selectors.map((selector) => {
      const el = this.containerEl.ownerDocument.querySelector(selector) as HTMLElement | null;
      if (!el) return `${selector}: missing`;
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return [
        selector,
        `h=${Math.round(rect.height)}`,
        `ch=${el.clientHeight}`,
        `sh=${el.scrollHeight}`,
        `st=${el.scrollTop}`,
        `oy=${style.overflowY}`,
        `pos=${style.position}`,
        `disp=${style.display}`
      ].join(" ");
    });
    const text = lines.join(" | ");
    console.info("Cancip layout", lines);
    this.setStatus(text);
    new Notice(text, 12000);
  }
}

class CancipSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private plugin: CancipPlugin
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("obcc-settings");
    containerEl.setAttr("lang", this.plugin.language());
    containerEl.setAttr("dir", this.plugin.textDirection());
    containerEl.createEl("h2", { text: PLUGIN_NAME });
    containerEl.createEl("p", { cls: "obcc-settings-note", text: this.plugin.t("configAuthority") });

    const coreEl = containerEl.createDiv({ cls: "obcc-settings-core" });

    new Setting(coreEl)
      .setName(this.plugin.t("settingsLanguage"))
      .setDesc(this.plugin.t("settingsLanguageDesc"))
      .addDropdown((dropdown) => {
        dropdown
          .addOptions(languageSelectOptions(this.plugin.t("languageAuto")))
          .setValue(this.plugin.settings.language)
          .onChange(async (value) => {
            this.plugin.settings.language = value as LanguageMode;
            await this.plugin.saveSettings();
            this.plugin.refreshOpenViews();
            this.display();
          });
      });

    new Setting(coreEl)
      .setName(this.plugin.t("settingsAccessMode"))
      .setDesc(this.plugin.t("settingsAccessModeDesc"))
      .addDropdown((dropdown) => {
        dropdown
          .addOptions({
            "ask-for-approval": this.plugin.t("accessAskApproval"),
            "full-access": this.plugin.t("accessFullAccess")
          })
          .setValue(this.plugin.settings.accessMode)
          .onChange(async (value) => {
            this.plugin.settings.accessMode = value as AccessMode;
            await this.plugin.saveSettings();
          });
      });

    this.displayApiProfileSettings(coreEl);

    new Setting(coreEl)
      .setName(this.plugin.t("settingsSystemPrompt"))
      .setDesc(this.plugin.t("settingsSystemPromptDesc"))
      .addTextArea((text) => {
        text.inputEl.rows = 8;
        text
          .setValue(this.plugin.settings.systemPrompt)
          .onChange(async (value) => {
            this.plugin.settings.systemPrompt = value;
            await this.plugin.saveSettings();
          });
      });

    const advanced = containerEl.createEl("details", { cls: "obcc-advanced-settings" });
    advanced.createEl("summary", { text: this.plugin.t("advancedSettings") });
    const advancedBody = advanced.createDiv({ cls: "obcc-advanced-body" });

    this.displayInterfaceSettings(this.createSettingsGroup(advancedBody, "settingsGroupInterface"));
    this.displayContextSettings(this.createSettingsGroup(advancedBody, "settingsGroupContext"));
    this.displayPlanSettings(this.createSettingsGroup(advancedBody, "settingsGroupPlan"));
    this.displayCommandBusSettings(this.createSettingsGroup(advancedBody, "settingsGroupCommandBus"));
    this.displayVersioningSettings(this.createSettingsGroup(advancedBody, "settingsGroupVersioning"));
    this.displayAutomationSettings(this.createSettingsGroup(advancedBody, "settingsGroupAutomation"));
    this.displayExportSettings(this.createSettingsGroup(advancedBody, "settingsGroupExport"));
    this.displaySupportSettings(this.createSettingsGroup(advancedBody, "settingsGroupSupport"));
    this.displayModelAdvancedSettings(this.createSettingsGroup(advancedBody, "settingsGroupModelAdvanced"));

    if (this.plugin.settings.showSupportCodes) this.renderSupportCodes(containerEl);
  }

  private createSettingsGroup(parent: HTMLElement, titleKey: I18nKey): HTMLElement {
    const group = parent.createEl("details", { cls: "obcc-settings-group" });
    group.createEl("summary", { text: this.plugin.t(titleKey) });
    return group.createDiv({ cls: "obcc-settings-group-body" });
  }

  private addToggleSetting(
    parent: HTMLElement,
    nameKey: I18nKey,
    value: boolean,
    onChange: (value: boolean) => void | Promise<void>,
    descKey?: I18nKey
  ): void {
    const setting = new Setting(parent).setName(this.plugin.t(nameKey));
    if (descKey) setting.setDesc(this.plugin.t(descKey));
    setting.addToggle((toggle) => {
      toggle.setValue(value).onChange(async (next) => {
        await onChange(next);
      });
    });
  }

  private addTextSetting(
    parent: HTMLElement,
    nameKey: I18nKey,
    value: string,
    placeholder: string,
    onChange: (value: string) => void | Promise<void>,
    descKey?: I18nKey
  ): void {
    const setting = new Setting(parent).setName(this.plugin.t(nameKey));
    if (descKey) setting.setDesc(this.plugin.t(descKey));
    setting.addText((text) => {
      text
        .setPlaceholder(placeholder)
        .setValue(value)
        .onChange(async (next) => {
          await onChange(next);
        });
    });
  }

  private addNumberSetting(
    parent: HTMLElement,
    nameKey: I18nKey,
    value: number,
    placeholder: string,
    min: number,
    max: number,
    onChange: (value: number) => void | Promise<void>,
    descKey?: I18nKey
  ): void {
    const setting = new Setting(parent).setName(this.plugin.t(nameKey));
    if (descKey) setting.setDesc(this.plugin.t(descKey));
    setting.addText((text) => {
      text
        .setPlaceholder(placeholder)
        .setValue(String(value))
        .onChange(async (next) => {
          const parsed = Number.parseInt(next, 10);
          if (Number.isFinite(parsed)) {
            await onChange(Math.max(min, Math.min(max, parsed)));
          }
        });
    });
  }

  private displayInterfaceSettings(parent: HTMLElement): void {
    this.addToggleSetting(parent, "settingsShowAttachmentButton", this.plugin.settings.showAttachmentButton, async (value) => {
      this.plugin.settings.showAttachmentButton = value;
      await this.plugin.saveSettings();
      this.plugin.refreshOpenViews();
    });
    this.addToggleSetting(parent, "settingsCompactHeader", this.plugin.settings.compactHeader, async (value) => {
      this.plugin.settings.compactHeader = value;
      await this.plugin.saveSettings();
      this.plugin.refreshOpenViews();
    });
  }

  private displayContextSettings(parent: HTMLElement): void {
    this.addTextSetting(parent, "settingsCoreMemoryFolder", this.plugin.settings.memoryFolder, DEFAULT_MEMORY_FOLDER, async (value) => {
      this.plugin.settings.memoryFolder = value.trim();
      await this.plugin.saveSettings();
    }, "settingsCoreMemoryFolderDesc");
    this.addNumberSetting(parent, "settingsMaxContextFiles", this.plugin.settings.maxContextFiles, "6", 1, 20, async (value) => {
      this.plugin.settings.maxContextFiles = value;
      await this.plugin.saveSettings();
    });
    this.addToggleSetting(parent, "settingsIncludeCurrentFile", this.plugin.settings.includeCurrentFile, async (value) => {
      this.plugin.settings.includeCurrentFile = value;
      await this.plugin.saveSettings();
      this.plugin.refreshOpenViews();
    });
    this.addToggleSetting(parent, "settingsIncludeCoreMemory", this.plugin.settings.includeCoreMemory, async (value) => {
      this.plugin.settings.includeCoreMemory = value;
      await this.plugin.saveSettings();
    });
    this.addNumberSetting(parent, "settingsMaxCoreMemoryFiles", this.plugin.settings.maxCoreMemoryFiles, String(DEFAULT_CORE_MEMORY_MAX_FILES), 0, 12, async (value) => {
      this.plugin.settings.maxCoreMemoryFiles = value;
      await this.plugin.saveSettings();
    });
    this.addTextSetting(parent, "settingsCodexMemoryImportPath", this.plugin.settings.codexMemoryImportPath, DEFAULT_CODEX_MEMORY_IMPORT_PATH, async (value) => {
      this.plugin.settings.codexMemoryImportPath = value.trim() || DEFAULT_CODEX_MEMORY_IMPORT_PATH;
      await this.plugin.saveSettings();
    });
    this.addToggleSetting(parent, "settingsCodexMemoryAutoImport", this.plugin.settings.codexMemoryAutoImport, async (value) => {
      this.plugin.settings.codexMemoryAutoImport = value;
      await this.plugin.saveSettings();
    });
    this.addToggleSetting(parent, "settingsCodexMemoryAutoSearch", this.plugin.settings.codexMemoryAutoSearch, async (value) => {
      this.plugin.settings.codexMemoryAutoSearch = value;
      await this.plugin.saveSettings();
    });
    this.addNumberSetting(parent, "settingsCodexMemoryMaxFiles", this.plugin.settings.codexMemoryMaxFiles, "6", 1, 12, async (value) => {
      this.plugin.settings.codexMemoryMaxFiles = value;
      await this.plugin.saveSettings();
    });
    this.addNumberSetting(parent, "settingsCodexMemoryMaxChars", this.plugin.settings.codexMemoryMaxChars, "12000", 1000, 60000, async (value) => {
      this.plugin.settings.codexMemoryMaxChars = value;
      await this.plugin.saveSettings();
    });
    new Setting(parent)
      .setName(this.plugin.t("importCodexMemory"))
      .addButton((button) => {
        button
          .setButtonText(this.plugin.t("importCodexMemory"))
          .onClick(async () => {
            try {
              const result = await this.plugin.importCodexCoreMemory(true);
              new Notice(this.plugin.t("codexMemoryImported", { count: result.count, path: result.folder }));
            } catch (error) {
              const reason = error instanceof Error ? error.message : String(error);
              new Notice(this.plugin.t("codexMemoryImportFailed", { reason }));
            }
          });
      });
    this.addToggleSetting(parent, "settingsUseVaultSearch", this.plugin.settings.useVaultSearchByDefault, async (value) => {
      this.plugin.settings.useVaultSearchByDefault = value;
      await this.plugin.saveSettings();
    });
    this.addNumberSetting(parent, "settingsMaxRecentTranscriptMessages", this.plugin.settings.maxRecentTranscriptMessages, "8", 0, 40, async (value) => {
      this.plugin.settings.maxRecentTranscriptMessages = value;
      await this.plugin.saveSettings();
    });
    this.addNumberSetting(parent, "settingsMaxMentionResults", this.plugin.settings.maxMentionResults, "12", 4, 40, async (value) => {
      this.plugin.settings.maxMentionResults = value;
      await this.plugin.saveSettings();
    });
    this.addNumberSetting(parent, "settingsMaxMentionFolderFiles", this.plugin.settings.maxMentionFolderFiles, "6", 1, 30, async (value) => {
      this.plugin.settings.maxMentionFolderFiles = value;
      await this.plugin.saveSettings();
    });
    this.addNumberSetting(parent, "settingsMaxFileContextChars", this.plugin.settings.maxFileContextChars, "8000", 500, 50000, async (value) => {
      this.plugin.settings.maxFileContextChars = value;
      await this.plugin.saveSettings();
    });
    this.addNumberSetting(parent, "settingsMaxFolderFileContextChars", this.plugin.settings.maxFolderFileContextChars, "2600", 300, 20000, async (value) => {
      this.plugin.settings.maxFolderFileContextChars = value;
      await this.plugin.saveSettings();
    });
  }

  private displayPlanSettings(parent: HTMLElement): void {
    this.addToggleSetting(parent, "settingsAutoOpenPlanPanel", this.plugin.settings.autoOpenPlanPanel, async (value) => {
      this.plugin.settings.autoOpenPlanPanel = value;
      await this.plugin.saveSettings();
    });
    this.addToggleSetting(parent, "settingsShowLiveTodos", this.plugin.settings.showLiveTodos, async (value) => {
      this.plugin.settings.showLiveTodos = value;
      await this.plugin.saveSettings();
      this.plugin.refreshOpenViews();
    });
    this.addToggleSetting(parent, "settingsShowManualTodos", this.plugin.settings.showManualTodos, async (value) => {
      this.plugin.settings.showManualTodos = value;
      await this.plugin.saveSettings();
      this.plugin.refreshOpenViews();
    });
  }

  private displayCommandBusSettings(parent: HTMLElement): void {
    this.addToggleSetting(parent, "settingsCommandBusEnabled", this.plugin.settings.commandBusEnabled, async (value) => {
      this.plugin.settings.commandBusEnabled = value;
      await this.plugin.saveSettings();
      this.plugin.refreshOpenViews();
    }, "settingsCommandBusEnabledDesc");
    this.addToggleSetting(parent, "settingsExecuteObsidianCommands", this.plugin.settings.executeObsidianCommands, async (value) => {
      this.plugin.settings.executeObsidianCommands = value;
      await this.plugin.saveSettings();
      this.plugin.refreshOpenViews();
    }, "settingsExecuteObsidianCommandsDesc");
    this.addToggleSetting(parent, "settingsGithubCommandsEnabled", this.plugin.settings.githubCommandsEnabled, async (value) => {
      this.plugin.settings.githubCommandsEnabled = value;
      await this.plugin.saveSettings();
      this.plugin.refreshOpenViews();
    }, "settingsGithubCommandsEnabledDesc");
    this.addToggleSetting(parent, "settingsAutoContinueAfterTools", this.plugin.settings.autoContinueAfterTools, async (value) => {
      this.plugin.settings.autoContinueAfterTools = value;
      await this.plugin.saveSettings();
    }, "settingsAutoContinueAfterToolsDesc");
    this.addNumberSetting(parent, "settingsMaxToolIterations", this.plugin.settings.maxToolIterations, "3", 0, 10, async (value) => {
      this.plugin.settings.maxToolIterations = value;
      await this.plugin.saveSettings();
    });
    new Setting(parent)
      .setName(this.plugin.t("settingsGithubAcceleration"))
      .setDesc(this.plugin.t("settingsGithubAccelerationDesc"))
      .addButton((button) => {
        button
          .setButtonText(this.plugin.t("githubAccelerationOfficial"))
          .onClick(async () => {
            this.plugin.settings.githubApiBaseUrl = DEFAULT_SETTINGS.githubApiBaseUrl;
            await this.plugin.saveSettings();
            this.display();
          });
      })
      .addButton((button) => {
        button
          .setButtonText(this.plugin.t("githubAccelerationCustom"))
          .onClick(async () => {
            if (!this.plugin.settings.githubApiBaseUrl.trim()) {
              this.plugin.settings.githubApiBaseUrl = DEFAULT_SETTINGS.githubApiBaseUrl;
              await this.plugin.saveSettings();
            }
          });
      });
    this.addTextSetting(parent, "settingsGithubApiBaseUrl", this.plugin.settings.githubApiBaseUrl, DEFAULT_SETTINGS.githubApiBaseUrl, async (value) => {
      this.plugin.settings.githubApiBaseUrl = value.trim() || DEFAULT_SETTINGS.githubApiBaseUrl;
      await this.plugin.saveSettings();
    }, "settingsGithubApiBaseUrlDesc");
    this.addTextSetting(parent, "settingsGithubDownloadBaseUrl", this.plugin.settings.githubDownloadBaseUrl, DEFAULT_SETTINGS.githubDownloadBaseUrl, async (value) => {
      this.plugin.settings.githubDownloadBaseUrl = value.trim();
      await this.plugin.saveSettings();
    }, "settingsGithubDownloadBaseUrlDesc");
    this.addTextSetting(parent, "settingsGithubOwner", this.plugin.settings.githubOwner, DEFAULT_SETTINGS.githubOwner, async (value) => {
      this.plugin.settings.githubOwner = value.trim();
      await this.plugin.saveSettings();
    });
    this.addTextSetting(parent, "settingsGithubRepo", this.plugin.settings.githubRepo, DEFAULT_SETTINGS.githubRepo, async (value) => {
      this.plugin.settings.githubRepo = value.trim();
      await this.plugin.saveSettings();
    });
    const tokenSetting = new Setting(parent)
      .setName(this.plugin.t("settingsGithubToken"))
      .setDesc(this.plugin.t("settingsGithubTokenDesc"));
    tokenSetting.addText((text) => {
      text.inputEl.type = "password";
      text
        .setPlaceholder("github_pat_...")
        .setValue(this.plugin.settings.githubToken)
        .onChange(async (value) => {
          this.plugin.settings.githubToken = value.trim();
          await this.plugin.saveSettings();
        });
    });
  }

  private displayVersioningSettings(parent: HTMLElement): void {
    this.addToggleSetting(parent, "settingsDailyLocalVersioning", this.plugin.settings.dailyLocalVersioning, async (value) => {
      this.plugin.settings.dailyLocalVersioning = value;
      await this.plugin.saveSettings();
    }, "settingsDailyLocalVersioningDesc");
    this.addNumberSetting(parent, "settingsLocalVersionHour", this.plugin.settings.localVersionHour, "4", 0, 23, async (value) => {
      this.plugin.settings.localVersionHour = value;
      await this.plugin.saveSettings();
    });
    this.addNumberSetting(parent, "settingsLocalVersionMaxFileBytes", this.plugin.settings.localVersionMaxFileBytes, "524288", 1024, 5242880, async (value) => {
      this.plugin.settings.localVersionMaxFileBytes = value;
      await this.plugin.saveSettings();
    });
  }

  private displayAutomationSettings(parent: HTMLElement): void {
    this.addToggleSetting(parent, "settingsAutomationsEnabled", this.plugin.settings.automationsEnabled, async (value) => {
      this.plugin.settings.automationsEnabled = value;
      await this.plugin.saveSettings();
    });
    this.addNumberSetting(parent, "settingsAutomationCheckMinutes", this.plugin.settings.automationCheckMinutes, "15", 1, 1440, async (value) => {
      this.plugin.settings.automationCheckMinutes = value;
      await this.plugin.saveSettings();
    });
    new Setting(parent)
      .setName(this.plugin.t("automationTask"))
      .setDesc(this.plugin.t("automationActionResult", { summary: this.plugin.t("automationListEmpty") }))
      .addButton((button) => {
        button
          .setButtonText(this.plugin.t("automationTask"))
          .onClick(async () => {
            const view = await this.plugin.activateView();
            view?.startMentionQuery("automation");
          });
      });
  }

  private displayExportSettings(parent: HTMLElement): void {
    this.addToggleSetting(parent, "settingsExportMarkdownContextSnapshots", this.plugin.settings.exportMarkdownContextSnapshots, async (value) => {
      this.plugin.settings.exportMarkdownContextSnapshots = value;
      await this.plugin.saveSettings();
    }, "settingsExportMarkdownContextSnapshotsDesc");
    this.addToggleSetting(parent, "settingsExportMarkdownManualTodos", this.plugin.settings.exportMarkdownManualTodos, async (value) => {
      this.plugin.settings.exportMarkdownManualTodos = value;
      await this.plugin.saveSettings();
    });
  }

  private displaySupportSettings(parent: HTMLElement): void {
    this.addToggleSetting(parent, "settingsShowSupportCodes", this.plugin.settings.showSupportCodes, async (value) => {
      this.plugin.settings.showSupportCodes = value;
      await this.plugin.saveSettings();
      this.display();
    }, "settingsSupportCodesDesc");
    this.addTextSetting(parent, "settingsSupportCodeOneLabel", this.plugin.settings.supportCodeOneLabel, this.plugin.t("settingsSupportCodeOneLabel"), async (value) => {
      this.plugin.settings.supportCodeOneLabel = value.trim() || DEFAULT_SETTINGS.supportCodeOneLabel;
      await this.plugin.saveSettings();
      this.display();
    });
    this.addTextSetting(parent, "settingsSupportCodeOnePath", this.plugin.settings.supportCodeOnePath, DEFAULT_SUPPORT_CODE_ONE_PATH, async (value) => {
      this.plugin.settings.supportCodeOnePath = value.trim();
      await this.plugin.saveSettings();
      this.display();
    });
    this.addTextSetting(parent, "settingsSupportCodeTwoLabel", this.plugin.settings.supportCodeTwoLabel, this.plugin.t("settingsSupportCodeTwoLabel"), async (value) => {
      this.plugin.settings.supportCodeTwoLabel = value.trim() || DEFAULT_SETTINGS.supportCodeTwoLabel;
      await this.plugin.saveSettings();
      this.display();
    });
    this.addTextSetting(parent, "settingsSupportCodeTwoPath", this.plugin.settings.supportCodeTwoPath, DEFAULT_SUPPORT_CODE_TWO_PATH, async (value) => {
      this.plugin.settings.supportCodeTwoPath = value.trim();
      await this.plugin.saveSettings();
      this.display();
    });
  }

  private displayModelAdvancedSettings(parent: HTMLElement): void {
    new Setting(parent)
      .setName(this.plugin.t("settingsTemperature"))
      .addText((text) => {
        text
          .setPlaceholder("0.2")
          .setValue(String(this.plugin.settings.temperature))
          .onChange(async (value) => {
            const parsed = Number(value);
            if (!Number.isNaN(parsed)) {
              this.plugin.settings.temperature = Math.max(0, Math.min(2, parsed));
              await this.plugin.saveSettings();
            }
          });
      });
    this.addNumberSetting(parent, "settingsMaxOutputTokens", this.plugin.settings.maxOutputTokens, "2048", 16, 32000, async (value) => {
      this.plugin.settings.maxOutputTokens = value;
      await this.plugin.saveSettings();
    });
    new Setting(parent)
      .setName(this.plugin.t("settingsModelOptions"))
      .setDesc(this.plugin.t("settingsModelOptionsDesc"))
      .addTextArea((text) => {
        text.inputEl.rows = 8;
        text
          .setPlaceholder(MODEL_PRESETS.join("\n"))
          .setValue(this.plugin.settings.modelOptions.join("\n"))
          .onChange(async (value) => {
            this.plugin.settings.modelOptions = normalizeModelOptions(value, this.plugin.activeApiProfile().model);
            await this.plugin.saveSettings();
            this.plugin.refreshOpenViews();
          });
      })
      .addButton((button) => {
        button
          .setButtonText(this.plugin.t("resetModelOptions"))
          .onClick(async () => {
            this.plugin.settings.modelOptions = normalizeModelOptions(MODEL_PRESETS, this.plugin.activeApiProfile().model);
            await this.plugin.saveSettings();
            this.plugin.refreshOpenViews();
            this.display();
          });
      });
  }

  private renderSupportCodes(parent: HTMLElement): void {
    const wrap = parent.createDiv({ cls: "obcc-support-codes" });
    wrap.createEl("h3", { text: this.plugin.t("supportCodesTitle") });
    wrap.createEl("p", { text: this.plugin.t("supportCodesNote") });
    const grid = wrap.createDiv({ cls: "obcc-support-code-grid" });
    this.renderSupportCodeCard(grid, this.plugin.settings.supportCodeOneLabel, this.plugin.settings.supportCodeOnePath);
    this.renderSupportCodeCard(grid, this.plugin.settings.supportCodeTwoLabel, this.plugin.settings.supportCodeTwoPath);
  }

  private renderSupportCodeCard(parent: HTMLElement, label: string, path: string): void {
    const card = parent.createDiv({ cls: "obcc-support-code-card" });
    card.createDiv({ cls: "obcc-support-code-label", text: label || this.plugin.t("supportCodesTitle") });
    const cleanPath = path.trim();
    if (!cleanPath) {
      card.createDiv({ cls: "obcc-support-code-missing", text: this.plugin.t("supportCodeMissing") });
      return;
    }
    card.createEl("img", {
      attr: {
        src: this.supportCodeResourcePath(cleanPath),
        alt: label || cleanPath
      }
    });
    card.createDiv({ cls: "obcc-support-code-path", text: cleanPath });
  }

  private supportCodeResourcePath(path: string): string {
    if (/^(https?:|app:|file:)/i.test(path)) return path;
    return this.app.vault.adapter.getResourcePath(normalizePath(path));
  }

  private displayApiProfileSettings(parent: HTMLElement): void {
    const active = this.plugin.activeApiProfile();
    const profileOptions = Object.fromEntries(this.plugin.settings.apiProfiles.map((profile) => [profile.id, profile.name || profile.id]));

    new Setting(parent)
      .setName(this.plugin.t("settingsApiProfile"))
      .setDesc(this.plugin.t("settingsApiProfileDesc"))
      .addDropdown((dropdown) => {
        dropdown
          .addOptions(profileOptions)
          .setValue(active.id)
          .onChange(async (value) => {
            await this.plugin.selectApiProfile(value);
            this.plugin.refreshOpenViews();
            this.display();
          });
      })
      .addButton((button) => {
        button
          .setButtonText(this.plugin.t("addApiProfile"))
          .onClick(async () => {
            const profile = await this.plugin.addApiProfile();
            new Notice(this.plugin.t("apiProfileChanged", { profile: profile.name }));
            this.plugin.refreshOpenViews();
            this.display();
          });
      })
      .addButton((button) => {
        button
          .setButtonText(this.plugin.t("removeApiProfile"))
          .setDisabled(this.plugin.settings.apiProfiles.length <= 1)
          .onClick(async () => {
            await this.plugin.removeActiveApiProfile();
            this.plugin.refreshOpenViews();
            this.display();
          });
      });

    new Setting(parent)
      .setName(this.plugin.t("settingsApiProfileName"))
      .addText((text) => {
        text
          .setPlaceholder(this.plugin.t("defaultApiProfileName"))
          .setValue(active.name)
          .onChange(async (value) => {
            await this.plugin.updateActiveApiProfile({ name: value.trim() || this.plugin.t("defaultApiProfileName") });
          });
      });

    new Setting(parent)
      .setName(this.plugin.t("settingsApiUrl"))
      .setDesc(this.plugin.t("settingsApiUrlDesc"))
      .addText((text) => {
        text
          .setPlaceholder("https://api.openai.com/v1")
          .setValue(active.apiUrl)
          .onChange(async (value) => {
            await this.plugin.updateActiveApiProfile({ apiUrl: value.trim() });
          });
      });

    new Setting(parent)
      .setName(this.plugin.t("settingsApiMode"))
      .setDesc(this.plugin.t("settingsApiModeDesc"))
      .addDropdown((dropdown) => {
        dropdown
          .addOptions({
            auto: this.plugin.t("apiModeAuto"),
            responses: this.plugin.t("apiModeResponses"),
            compatible: this.plugin.t("apiModeCompatible")
          })
          .setValue(active.apiMode)
          .onChange(async (value) => {
            await this.plugin.updateActiveApiProfile({ apiMode: value as ApiMode });
          });
      });

    new Setting(parent)
      .setName(this.plugin.t("settingsApiKey"))
      .setDesc(this.plugin.t("settingsApiKeyDesc"))
      .addText((text) => {
        text.inputEl.type = "password";
        text
          .setPlaceholder("sk-...")
          .setValue(active.apiKey)
          .onChange(async (value) => {
            await this.plugin.updateActiveApiProfile({ apiKey: value.trim() });
          });
      });

    const modelOptions: Record<string, string> = Object.fromEntries(
      normalizeModelOptions(this.plugin.settings.modelOptions, active.model).map((model) => [model, model])
    );

    new Setting(parent)
      .setName(this.plugin.t("settingsModel"))
      .addDropdown((dropdown) => {
        dropdown
          .addOptions(modelOptions)
          .setValue(active.model)
          .onChange(async (value) => {
            await this.plugin.updateActiveApiProfile({ model: value });
            this.plugin.refreshOpenViews();
          });
      })
      .addText((text) => {
        text
          .setPlaceholder("gpt-5.5")
          .setValue(active.model)
          .onChange(async (value) => {
            await this.plugin.updateActiveApiProfile({ model: value.trim() });
            this.plugin.refreshOpenViews();
          });
      });
  }
}

function emptyLocalVersionIndex(): LocalVersionIndex {
  return {
    schemaVersion: LOCAL_VERSION_SCHEMA_VERSION,
    lastDailyDate: "",
    commits: [],
    latestHashes: {}
  };
}

function normalizeLocalVersionIndex(raw: unknown): LocalVersionIndex {
  if (!isRecord(raw)) return emptyLocalVersionIndex();
  const latestHashes: Record<string, string> = {};
  if (isRecord(raw.latestHashes)) {
    for (const [path, hash] of Object.entries(raw.latestHashes)) {
      if (typeof hash === "string" && !isSensitiveLocalVersionPath(path)) latestHashes[path] = hash;
    }
  }
  const commits = Array.isArray(raw.commits)
    ? raw.commits
        .filter(isRecord)
        .map((item) => ({
          id: typeof item.id === "string" ? item.id : "",
          kind: item.kind === "daily" ? "daily" as const : "manual" as const,
          message: typeof item.message === "string" ? item.message : "",
          createdAt: typeof item.createdAt === "string" ? item.createdAt : "",
          scannedCount: typeof item.scannedCount === "number" ? item.scannedCount : 0,
          fileCount: typeof item.fileCount === "number" ? item.fileCount : 0
        }))
        .filter((item) => item.id && item.createdAt)
    : [];
  return {
    schemaVersion: LOCAL_VERSION_SCHEMA_VERSION,
    lastDailyDate: typeof raw.lastDailyDate === "string" ? raw.lastDailyDate : "",
    commits,
    latestHashes
  };
}

function isLocalVersionCandidate(file: TFile, maxBytes: number): boolean {
  const path = file.path.replace(/\\/g, "/");
  if (path.startsWith(".obsidian/")) return false;
  if (path === ".cancip/config.json") return false;
  if (path.startsWith(".cancip/versions/")) return false;
  if (path.startsWith(".trash/")) return false;
  if (isSensitiveLocalVersionPath(path)) return false;
  if (file.stat.size > maxBytes) return false;
  return isContextTextFile(file);
}

function isSensitiveLocalVersionPath(path: string): boolean {
  const lower = path.toLowerCase();
  if (lower.endsWith("config.json") || lower.includes(".config.")) return true;
  return /(^|[\/._-])(secret|secrets|password|passwd|token|tokens|credential|credentials|recovery|codes|config|apikey|api-key|api_key|private-key|private_key|ssh-key|ssh_key)([\/._-]|$)/i.test(lower);
}

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

type NodeFsLike = {
  existsSync: (path: string) => boolean;
  readFileSync: (path: string, encoding: "utf8") => string;
};

function getNodeFs(): NodeFsLike | null {
  try {
    if (typeof require !== "function") return null;
    const fs = require("fs") as Partial<NodeFsLike>;
    if (typeof fs.existsSync !== "function" || typeof fs.readFileSync !== "function") return null;
    return fs as NodeFsLike;
  } catch {
    return null;
  }
}

function normalizeExternalPath(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/\/+$/, "");
}

function safeVaultFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, "_").replace(/\0/g, "").slice(0, 120) || "memory.md";
}

function isImportedCodexMemoryFile(path: string): boolean {
  const name = path.split("/").pop() ?? "";
  return (CODEX_CORE_MEMORY_FILES as readonly string[]).includes(name) || name === "README.md";
}

function sanitizeImportedMemory(content: string): string {
  return content
    .replace(/\0/g, "")
    .replace(/sk-[A-Za-z0-9_-]{20,}/g, "[REDACTED_OPENAI_KEY]")
    .replace(/ghp_[A-Za-z0-9_]{20,}/g, "[REDACTED_GITHUB_TOKEN]")
    .replace(/github_pat_[A-Za-z0-9_]{20,}/g, "[REDACTED_GITHUB_TOKEN]")
    .replace(/AKIA[0-9A-Z]{16}/g, "[REDACTED_AWS_KEY]");
}

function makeMemorySnippet(content: string, tokens: string[], maxChars: number): string {
  const normalized = content.replace(/\0/g, "").trim();
  if (!tokens.length) return trimContext(normalized, maxChars);
  const lower = normalized.toLowerCase();
  const hit = tokens
    .map((token) => lower.indexOf(token))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];
  if (hit === undefined) return trimContext(normalized, maxChars);
  const start = Math.max(0, hit - Math.floor(maxChars / 3));
  return trimContext(normalized.slice(start, start + maxChars), maxChars);
}

function selectRelevantExperience(raw: string, prompt: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const entries = trimmed
    .split(/\n(?=## \d{4}-\d{2}-\d{2}T)/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (entries.length <= 1) return trimmed;
  const header = entries[0].startsWith("# ") ? entries.shift() : "# Cancip Experience";
  const tokens = tokenize(prompt).filter((token) => token.length >= 2).slice(0, 12);
  const relevant = tokens.length
    ? entries.filter((entry) => {
      const lower = entry.toLowerCase();
      return tokens.some((token) => lower.includes(token));
    })
    : [];
  const selected = (relevant.length ? relevant : entries).slice(-5);
  return [header, ...selected].filter(Boolean).join("\n\n");
}

function normalizeAutomationTask(raw: unknown): AutomationTask | null {
  if (!isRecord(raw)) return null;
  const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : "";
  const title = typeof raw.title === "string" && raw.title.trim() ? raw.title.trim() : "";
  const prompt = typeof raw.prompt === "string" && raw.prompt.trim() ? raw.prompt.trim() : "";
  const command = typeof raw.command === "string" && raw.command.trim() ? raw.command.trim() : undefined;
  if (!id || !title || (!prompt && !command)) return null;
  const intervalMinutes = Number.parseInt(String(raw.intervalMinutes ?? ""), 10);
  const hour = Number.parseInt(String(raw.hour ?? ""), 10);
  const createdAt = typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString();
  const updatedAt = typeof raw.updatedAt === "string" ? raw.updatedAt : createdAt;
  const lastStatus = raw.lastStatus === "ok" || raw.lastStatus === "failed" ? raw.lastStatus : undefined;
  return {
    id,
    title,
    prompt,
    command,
    args: isRecord(raw.args) ? raw.args : undefined,
    schedule: isAutomationSchedule(raw.schedule) ? raw.schedule : "manual",
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : true,
    intervalMinutes: Number.isFinite(intervalMinutes) ? Math.max(1, Math.min(1440, intervalMinutes)) : 60,
    hour: Number.isFinite(hour) ? Math.max(0, Math.min(23, hour)) : 9,
    createdAt,
    updatedAt,
    lastRunAt: typeof raw.lastRunAt === "string" ? raw.lastRunAt : undefined,
    lastStatus,
    lastResult: typeof raw.lastResult === "string" ? raw.lastResult : undefined,
    lastResultPath: typeof raw.lastResultPath === "string" ? raw.lastResultPath : undefined
  };
}

function cancipAutomationTemplates(): AutomationTemplate[] {
  return [
    {
      id: "auto-review-gate-current-vault",
      title: "Daily OB Review Gate scan",
      description: "Build a read-only mobile review package for recent vault scope. No vault edits are applied.",
      command: "cancip.reviewGate",
      args: { title: "Daily Cancip OB Review Gate", maxFiles: 60 },
      schedule: "daily",
      enabled: false,
      hour: 8
    },
    {
      id: "auto-import-codex-memory",
      title: "Import Codex memory",
      description: "Refresh visible AI/Cancip/Memory from local Codex memory when desktop files are available.",
      command: "cancip.importCodexMemory",
      args: {},
      schedule: "daily",
      enabled: true,
      hour: 7
    },
    {
      id: "auto-local-version-daily",
      title: "Daily local version commit",
      description: "Create one lightweight daily local version snapshot under .cancip/versions.",
      command: "cancip.localVersionCommit",
      args: {},
      schedule: "daily",
      enabled: false,
      hour: 4
    },
    {
      id: "auto-github-status",
      title: "GitHub status check",
      description: "Check GitHub API/rate status through configured mobile-safe command bus.",
      command: "github.status",
      args: {},
      schedule: "hourly",
      enabled: false,
      intervalMinutes: 180
    },
    {
      id: "auto-vault-index-refresh",
      title: "Refresh Cancip vault index",
      description: "Refresh the lightweight local vault index used by @ and search suggestions.",
      command: "cancip.rebuildIndex",
      args: {},
      schedule: "hourly",
      enabled: true,
      intervalMinutes: 120
    }
  ];
}

function formatAutomationTemplates(templates: AutomationTemplate[]): string {
  return templates
    .map((template) => {
      const mode = template.command ? `command:${template.command}` : "prompt";
      return `- ${template.id}: ${template.title} [${template.schedule}, ${mode}] ${template.description}`;
    })
    .join("\n");
}

function isAutomationDue(task: AutomationTask, now: Date): boolean {
  if (!task.enabled || task.schedule === "manual") return false;
  const lastRun = task.lastRunAt ? new Date(task.lastRunAt) : null;
  if (task.schedule === "hourly") {
    if (!lastRun || Number.isNaN(lastRun.getTime())) return true;
    return now.getTime() - lastRun.getTime() >= task.intervalMinutes * 60 * 1000;
  }
  if (now.getHours() < task.hour) return false;
  if (!lastRun || Number.isNaN(lastRun.getTime())) return true;
  return localDateKey(lastRun) !== localDateKey(now);
}

function localVersionCommitId(iso: string): string {
  return iso.replace(/\.\d{3}Z$/, "Z").replace(/[:.]/g, "-");
}

function sessionExportId(date: Date): string {
  return `session-${localVersionCommitId(date.toISOString())}`;
}

function snapshotFileName(path: string): string {
  const name = path.split("/").pop() || "file";
  const safeName = name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(-80) || "file";
  return `${stableTextHash(path)}-${safeName}.txt`;
}

function stableTextHash(input: string): string {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

async function sha256Text(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function tokenize(input: string): string[] {
  const lower = input.toLowerCase();
  const matches = lower.match(/[a-z0-9_\-/]{2,}|[\u4e00-\u9fff]{1,2}/g) ?? [];
  const stop = new Set([
    "the", "and", "for", "with", "this", "that",
    "hi", "hello", "hey", "test", "ping", "ok",
    "你", "我", "的", "了", "是", "在", "和", "就", "都", "把",
    "你好", "您好", "测试", "試試", "在吗", "在嗎", "哈喽", "哈囉"
  ]);
  return [...new Set(matches.filter((token) => !stop.has(token)))];
}

function extractMentionTokens(input: string): string[] {
  const tokens: string[] = [];
  const regex = /(^|[\s([{，。；,;])(?:@\[([^\]]+)\]|@([^\s@#|，。；,;]+))/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(input)) !== null) {
    const mentionToken = normalizeMentionQuery(match[2] || match[3] || "");
    if (mentionToken) tokens.push(mentionToken);
  }
  return [...new Set(tokens)];
}

function normalizeMentionQuery(input: string): string {
  return input
    .trim()
    .replace(/^@/, "")
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .replace(/\\/g, "/")
    .trim();
}

function mentionIcon(kind: MentionKind): string {
  if (kind === "command") return "terminal";
  if (kind === "folder") return "folder";
  if (kind === "skill") return "sparkles";
  if (kind === "action") return "wrench";
  return "file-text";
}

function mentionTargetKey(target: MentionTarget): string {
  return `${target.kind}:${target.source}:${target.path}`;
}

function contextChipName(path: string, fallback: string): string {
  const raw = (path || fallback).trim().replace(/\\/g, "/");
  const last = raw.split("/").filter(Boolean).pop() || fallback || raw;
  return trimContext(last, 36);
}

function contextChipKey(kind: string, path: string): string {
  return `${kind}:${path}`;
}

function isContextSource(value: unknown): value is ContextSource {
  return value === "file" || value === "folder" || value === "virtual";
}

function mentionKindRank(kind: MentionKind): number {
  if (kind === "action") return 0;
  if (kind === "command") return 1;
  if (kind === "skill") return 2;
  if (kind === "file") return 3;
  return 4;
}

function mentionPathKeywords(path: string, title: string): string[] {
  const parts = path.split(/[\/\\._\-\s]+/).filter(Boolean);
  return uniqueStrings([path, title, path.replace(/\.[^.]+$/, ""), ...parts]);
}

function frontmatterKeywords(frontmatter: Record<string, unknown> | undefined): string[] {
  if (!frontmatter) return [];
  const keys = ["aliases", "alias", "tags", "tag", "title", "name", "summary", "description"];
  const values: string[] = [];
  for (const key of keys) {
    values.push(...flattenKeywordValue(frontmatter[key]));
  }
  return values;
}

function flattenKeywordValue(value: unknown): string[] {
  if (typeof value === "string" || typeof value === "number") return [String(value)];
  if (Array.isArray(value)) return value.flatMap((item) => flattenKeywordValue(item));
  return [];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function isSkillLikeMention(path: string, title: string): boolean {
  const text = `${path}\n${title}`.toLowerCase();
  return /(^|[\/\\._\-\s])skills?($|[\/\\._\-\s])/.test(text) || text.includes("skillob") || text.includes("skill.md") || /技能|能力/.test(text);
}

function mentionQueryParts(query: string): string[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  const parts = q.split(/[\s\/\\._\-:]+/).filter(Boolean);
  const cjk = q.match(/[\u4e00-\u9fff]/g) ?? [];
  return uniqueStrings([q, ...parts, ...cjk]);
}

function scoreMentionTarget(target: MentionTarget, query: string): number {
  const q = query.toLowerCase().trim();
  if (!q) return target.score;

  const path = target.path.toLowerCase();
  const title = target.title.toLowerCase();
  const detail = target.detail.toLowerCase();
  const fields = [path, title, detail, ...target.keywords.map((keyword) => keyword.toLowerCase())];
  let score = 0;
  let matched = false;

  if (title === q || path === q || `${target.kind}:${path}` === q) {
    score += 140;
    matched = true;
  }
  if ((target.source === "file" || target.kind === "skill") && path.replace(/\.[^.]+$/, "") === q) {
    score += 120;
    matched = true;
  }
  if (title.startsWith(q)) {
    score += 92;
    matched = true;
  }
  if (path.startsWith(q)) {
    score += 72;
    matched = true;
  }
  if (title.includes(q)) {
    score += 58;
    matched = true;
  }
  if (path.includes(q)) {
    score += 42;
    matched = true;
  }

  for (const part of mentionQueryParts(q)) {
    for (const field of fields) {
      if (field === part) {
        score += 24;
        matched = true;
      } else if (field.startsWith(part)) {
        score += 16;
        matched = true;
      } else if (field.includes(part)) {
        score += 9;
        matched = true;
      }
    }
  }

  if (!matched) return 0;
  score += Math.min(target.score, 35);
  if (target.kind === "action") score += 8;
  if (target.kind === "command") score += 7;
  if (target.kind === "skill") score += 6;
  if (target.source === "folder") score += Math.min(10, target.path.split("/").length * 2);
  if (path.includes("skillob") || title.includes("skillob")) score += 30;
  return score;
}

function isPathInFolder(path: string, folderPath: string): boolean {
  const prefix = folderPath.endsWith("/") ? folderPath : `${folderPath}/`;
  return path === folderPath || path.startsWith(prefix);
}

async function listVaultTextPaths(
  adapter: DataAdapter,
  folder: string,
  timeBudgetMs = 5000,
  startedAt = Date.now(),
  maxResults = 2000
): Promise<string[]> {
  const results: string[] = [];
  if (Date.now() - startedAt > timeBudgetMs || results.length >= maxResults) return results;
  let listing: { files: string[]; folders: string[] };
  try {
    listing = await adapter.list(folder);
  } catch {
    return results;
  }
  for (const file of listing.files) {
    if (Date.now() - startedAt > timeBudgetMs || results.length >= maxResults) break;
    const normalized = normalizePath(file);
    if (isContextTextPath(normalized)) results.push(normalized);
  }
  for (const child of listing.folders) {
    if (Date.now() - startedAt > timeBudgetMs || results.length >= maxResults) break;
    const normalized = normalizePath(child);
    const childResults = await listVaultTextPaths(adapter, normalized, timeBudgetMs, startedAt, maxResults - results.length);
    results.push(...childResults);
  }
  return results;
}

function vaultTextFileFromPath(path: string): VaultTextFile {
  const name = path.split("/").pop() || path;
  const dot = name.lastIndexOf(".");
  const basename = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  return { path, basename, extension };
}

function isContextTextPath(path: string): boolean {
  const name = path.split("/").pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot > 0 && isContextTextExtension(name.slice(dot + 1));
}

function isContextTextFile(file: TFile): boolean {
  return isContextTextExtension(file.extension);
}

function isContextTextExtension(extension: string): boolean {
  const textExtensions = new Set([
    "md",
    "txt",
    "json",
    "jsonl",
    "csv",
    "ts",
    "tsx",
    "js",
    "jsx",
    "css",
    "html",
    "xml",
    "yml",
    "yaml",
    "base",
    "canvas"
  ]);
  return textExtensions.has(extension.toLowerCase());
}

function shouldUsePathInAutomaticVaultSearch(path: string, query: string, tokens: string[]): boolean {
  const normalized = normalizePath(path);
  if (normalized.startsWith(".cancip/exports/")) return false;
  if (normalized.startsWith(".cancip/sessions/")) return false;
  if (normalized.startsWith(".cancip/versions/")) return false;
  if (normalized.startsWith(".cancip/automations/")) return false;
  if (normalized.startsWith(".trash/")) return false;
  if (normalized.startsWith(".obsidian/")) {
    const lower = query.toLowerCase();
    const wantsObsidianConfig = lower.includes(".obsidian") || lower.includes("obsidian") || lower.includes("插件") || lower.includes("配置") || lower.includes("config");
    return wantsObsidianConfig || tokens.some((token) => normalized.toLowerCase().includes(token));
  }
  if (normalized.startsWith(".cancip/")) {
    const lower = query.toLowerCase();
    const wantsCancipConfig = lower.includes(".cancip") || lower.includes("cancip") || lower.includes("配置") || lower.includes("config");
    return wantsCancipConfig || tokens.some((token) => normalized.toLowerCase().includes(token));
  }
  return true;
}

function shouldAutoSearchForPrompt(prompt: string): boolean {
  const text = prompt.trim();
  if (!text) return false;
  if (extractMentionTokens(text).length) return true;
  if (looksLikePathQuery(text)) return true;
  const lower = text.toLowerCase();
  if (/(search|find|read|open|summari[sz]e|index|rag|vault|note|file|folder|config|plugin|github|查|搜|找|读取|打开|总结|索引|笔记|文件|文件夹|配置|插件|仓库|命令)/.test(lower)) return true;
  const tokens = tokenize(text);
  if (tokens.length >= 3) return true;
  if (text.length >= 18 && /[\u4e00-\u9fff]/.test(text)) return true;
  return false;
}

function shouldShowLocalFallbackHits(prompt: string): boolean {
  return shouldAutoSearchForPrompt(prompt);
}

function shouldSuppressToolActionsForPrompt(prompt: string): boolean {
  const text = prompt.trim();
  if (!text) return true;
  if (extractMentionTokens(text).length) return false;
  if (looksLikePathQuery(text)) return false;
  const lower = text.toLowerCase();
  if (/(search|find|read|open|summari[sz]e|index|rag|vault|note|file|folder|config|plugin|github|command|run|execute|write|edit|patch|delete|move|rename|fix|repair|button|style|css|ui|self|查|搜|找|读取|打开|总结|索引|笔记|文件|文件夹|配置|插件|仓库|命令|执行|运行|写|改|修|删|移动|重命名|按钮|样式|界面|自己|自身|自修)/.test(lower)) {
    return false;
  }
  const compact = lower.replace(/[\s，。！？!?.、~～]+/g, "");
  if (/^(hi|hello|hey|yo|ok|test|ping|thanks|thankyou|whoareyou|whatareyou|你好|您好|嗨|哈喽|测试|在吗|你是谁|你是誰|你叫什么|你叫什麼|谢谢|謝謝|好的|好)$/.test(compact)) {
    return true;
  }
  return text.length <= 12 && /^(你是谁|你是誰|你好|您好|测试|嗨|哈喽|在吗|hi|hello|test|ping)/i.test(text);
}

function isContinuePrompt(prompt: string): boolean {
  const compact = prompt.trim().toLowerCase().replace(/[\s，。！？!?.、~～]+/g, "");
  return /^(继续|继续修|继续做|接着|接着来|接着做|接着修|往下|往下做|下一步|继续吧|继续呀|继续啊|continue|goon|next|proceed|keepgoing)$/.test(compact);
}

function isTrivialChatPrompt(prompt: string): boolean {
  const compact = prompt.trim().toLowerCase().replace(/[\s，。！？!?.、~～]+/g, "");
  return /^(hi|hello|hey|yo|ok|test|ping|thanks|thankyou|你好|您好|嗨|哈喽|测试|在吗|你是谁|你是誰|你叫什么|你叫什麼|谢谢|謝謝|好的|好)$/.test(compact);
}

function shouldExpectToolActionForPrompt(prompt: string): boolean {
  const text = prompt.trim();
  if (!text) return false;
  if (isReadOnlyPluginInventoryPrompt(text)) return false;
  if (shouldSuppressToolActionsForPrompt(text)) return false;
  const lower = text.toLowerCase();
  return /(add|implement|fix|repair|change|modify|update|setting|option|manage|management|button|ui|style|css|plugin|source|install|restart|verify|build|github|automation|command|execute|patch|write|not working|broken|failed|failure|bug|error|stuck|off.?topic|加|新增|添加|补|改|修改|更新|修|修复|设置|选项|管理|按钮|界面|样式|插件|源码|装好|安装|重启|验证|构建|自动化|命令|执行|写入|落地|自身|自己|全权|不行|没效果|沒效果|老样子|老樣子|还是|還是|失败|失敗|错误|錯誤|报错|報錯|问题|問題|坏了|壞了|卡住|不回复|不回復|乱滑|亂滑|跑偏|套话|套話|敷衍|不实时|不即時|一股脑|一股腦)/.test(lower);
}

function isReadOnlyPluginInventoryPrompt(prompt: string): boolean {
  const compact = prompt.trim().toLowerCase().replace(/[\s，。！？!?.、~～"'`]+/g, "");
  if (!compact) return false;
  return /(我)?(装了|裝了|安装了|安裝了|启用(?:了)?|啟用(?:了)?|有)(哪些|那些|什么|什麼|多少)?插件/.test(compact)
    || /(已安装|已安裝|启用|啟用)插件(清单|列表)?/.test(compact)
    || /插件(清单|列表|有哪些|有那些|有多少|都有什么|都有哪些)/.test(compact)
    || /(installed|enabled)(obsidian)?plugins?/.test(compact)
    || /whatplugins/.test(compact);
}

function isWeakFinalConclusion(content: string): boolean {
  const normalized = content.replace(/\s+/g, "");
  return normalized.includes("还没完成最终回答")
    || normalized.includes("只完成了读取/检索资料")
    || normalized.includes("请继续让Cancip")
    || normalized.includes("重新发送更明确的问题")
    || normalized.includes("会话已加载")
    || normalized.includes("仅表示载入记录")
    || normalized.includes("刚才我做了这些")
    || normalized.includes("工具执行结果")
    || normalized.includes("patchfindtextwasnotfound")
    || normalized.includes("动作失败");
}

function hasFinalConclusion(content: string): boolean {
  return /(^|\n)\s*#{1,3}\s*(最终结论|Final conclusion|Final answer)\b/i.test(content)
    || /(^|\n)\s*(最终结论|Final conclusion|Final answer)\s*[:：]/i.test(content);
}

function classifyStaleRunningMessages(messages: Record<string, unknown>[]): {
  status: NonNullable<SessionHistoryEntry["status"]>;
  needsClosure: boolean;
  content: string;
  detail: string;
} {
  const assistantMessages = messages
    .filter((message) => message.role === "assistant" && typeof message.content === "string")
    .map((message) => String(message.content));
  const lastVisible = [...assistantMessages].reverse().find((content) => {
    const stripped = removeCancipActionBlocks(content)
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<details>[\s\S]*?<\/details>/gi, "")
      .trim();
    return stripped.length > 0 && !isProcessOnlySessionContent(content);
  });
  if (lastVisible && hasFinalConclusion(lastVisible) && !isWeakFinalConclusion(lastVisible)) {
    return {
      status: "completed",
      needsClosure: false,
      content: "",
      detail: "stale running session already had a final answer; marked completed"
    };
  }
  const pluginList = extractCommunityPluginListFromMessages(messages);
  if (pluginList.length) {
    return {
      status: "completed",
      needsClosure: true,
      content: `## 最终结论\n\n${formatRecoveredPluginListAnswer(pluginList)}`,
      detail: "stale running session recovered from completed plugin-list tool result"
    };
  }
  return {
    status: "failed",
    needsClosure: true,
    content: "## 最终结论\n\n这条会话不是还在执行，而是 Obsidian/Cancip 重载或切换会话后，请求被中断，历史状态卡在“运行中”。\n\n已自动把它收口为失败，避免继续转圈。原任务没有拿到最终模型回复，请重新发送或点继续后从最近工具结果接着做。",
    detail: "stale running session had no active request and no recoverable final answer; marked failed"
  };
}

function isProcessOnlySessionContent(content: string): boolean {
  const normalized = content.replace(/<!--[\s\S]*?-->/g, "").replace(/\s+/g, "");
  return normalized.includes("执行中·")
    || normalized.includes("已执行·")
    || normalized.includes("工具反馈：")
    || normalized.includes("工具执行结果：")
    || normalized.includes("正在根据工具结果继续")
    || normalized.includes("模型生成中")
    || normalized.includes("正在准备上下文");
}

function extractCommunityPluginListFromMessages(messages: Record<string, unknown>[]): string[] {
  for (const message of [...messages].reverse()) {
    const toolRuns = Array.isArray(message.toolRuns) ? message.toolRuns.filter(isRecord) : [];
    for (const run of toolRuns) {
      if (!isRecord(run.action)) continue;
      if (run.action.type !== "read" || run.action.path !== ".obsidian/community-plugins.json") continue;
      if (typeof run.result !== "string") continue;
      const parsed = parseJsonArrayFromText(run.result);
      if (parsed.length) return parsed;
    }
  }
  for (const message of [...messages].reverse()) {
    if (typeof message.content !== "string" || !message.content.includes(".obsidian/community-plugins.json")) continue;
    const parsed = parseJsonArrayFromText(message.content);
    if (parsed.length) return parsed;
  }
  return [];
}

function extractInstalledPluginAnswerFromToolRuns(runs: ToolRun[]): string {
  for (const run of [...runs].reverse()) {
    if (run.status !== "executed" || !run.result) continue;
    if (run.action.type === "command" && run.action.command.trim() === "cancip.installedPlugins") {
      return finalAnswerFromInstalledPluginsSummary(run.result);
    }
    if (run.action.type === "read" && run.action.path === ".obsidian/community-plugins.json") {
      const parsed = parseJsonArrayFromText(run.result);
      if (parsed.length) return formatPluginListConclusion(parsed);
    }
  }
  return "";
}

function finalAnswerFromInstalledPluginsSummary(result: string): string {
  const body = result.replace(/^command\s+cancip\.installedPlugins\s*/i, "").trim();
  if (!body) return "";
  return `已完成。你的 Obsidian 已启用插件清单如下：\n\n${body}`;
}

function parseJsonArrayFromText(text: string): string[] {
  const match = text.match(/\[[\s\S]*?\]/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  } catch {
    return [];
  }
}

function formatRecoveredPluginListAnswer(plugins: string[]): string {
  return `${formatPluginListConclusion(plugins)}\n\n这条会话之前卡在“正在根据工具结果继续”，但工具结果已经读到了插件列表；现在已把会话状态收口为完成，不会继续转圈。`;
}

function formatPluginListConclusion(plugins: string[]): string {
  const list = plugins.map((plugin) => `- ${plugin}`).join("\n");
  return `已完成。你当前启用的社区插件共 ${plugins.length} 个：\n\n${list}`;
}

function formatInstalledPluginsSummary(plugins: InstalledPluginInfo[], enabledCount: number, includeDisabled: boolean): string {
  if (!plugins.length) {
    return "没有在 .obsidian/community-plugins.json 里找到已启用社区插件。";
  }
  const title = includeDisabled
    ? `已启用 ${enabledCount} 个；插件目录共 ${plugins.length} 个`
    : `已启用 ${enabledCount} 个`;
  const lines = plugins.map((plugin, index) => {
    const state = plugin.enabled ? "" : " [未启用]";
    const version = plugin.version ? ` v${plugin.version}` : "";
    const manifest = plugin.manifestFound ? "" : " [缺 manifest]";
    const error = plugin.error ? ` [manifest 读取失败: ${trimContext(plugin.error, 80)}]` : "";
    const name = plugin.name && plugin.name !== plugin.id ? `${plugin.name} (${plugin.id})` : plugin.id;
    return `${index + 1}. ${name}${version}${state}${manifest}${error}`;
  });
  return `${title}：\n\n${lines.join("\n")}`;
}

function timestampMs(value: unknown, fallback = Date.now()): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return fallback;
}

function formatElapsed(ms: number): string {
  const safe = Math.max(0, Math.round(ms));
  if (safe < 1000) return `${safe}ms`;
  const seconds = Math.round(safe / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}m${String(rest).padStart(2, "0")}s`;
}

function shouldNeedMoreActionAfterToolRuns(runs: ToolRun[]): boolean {
  if (!runs.length) return true;
  const active = runs.filter((run) => run.status === "executed" || run.status === "failed");
  if (!active.length) return false;
  if (active.some((run) => run.status === "failed")) return true;
  if (active.every((run) => isLowCommitmentAction(run.action))) return true;
  return hasUnverifiedWriteAction(active);
}

function shouldNeedMoreActionForPrompt(prompt: string, runs: ToolRun[]): boolean {
  if (isReadOnlyPluginInventoryPrompt(prompt)) return false;
  if (shouldNeedMoreActionAfterToolRuns(runs)) return true;
  const lower = prompt.toLowerCase();
  const isUiOrPluginTask = /(settings?\s*(page|tab|ui)|ui|interface|button|model\s*options?|model\s*management|设置页|设置中|界面|按钮|可选模型|模型管理|插件|自身|自己)/i.test(lower);
  if (!isUiOrPluginTask) return false;
  const active = runs.filter((run) => run.status === "executed");
  const writePaths = uniqueStrings(active
    .filter((run) => isWriteActionForContinuation(run.action))
    .map((run) => actionVerificationPath(run.action))
    .filter(Boolean));
  if (!writePaths.length) return true;
  if (!hasUnverifiedWriteAction(active)) return false;
  const hasPluginWrite = writePaths.some((path) => path.startsWith(".obsidian/plugins/cancip/"));
  if (hasPluginWrite) return false;
  return writePaths.every((path) => path === ".cancip/config.json" || path.startsWith(".cancip/"));
}

function shouldContinueToolLoopFromRuns(runs: ToolRun[]): boolean {
  if (!runs.length) return false;
  if (runs.some((run) => run.status === "pending" || run.status === "executing" || run.status === "blocked")) return false;
  if (runs.some((run) => run.status === "failed" || run.status === "rejected")) return true;
  const executed = runs.filter((run) => run.status === "executed");
  if (!executed.length) return false;
  if (executed.every((run) => isLowCommitmentAction(run.action))) return false;
  return hasUnverifiedWriteAction(executed);
}

function hasUnverifiedWriteAction(runs: ToolRun[]): boolean {
  const writePaths = uniqueStrings(runs
    .filter((run) => run.status === "executed" && isWriteActionForContinuation(run.action))
    .map((run) => actionVerificationPath(run.action))
    .filter(Boolean));
  if (!writePaths.length) return false;
  if (runs.some((run) => run.status === "executed" && isSelfVerifyingAction(run.action, writePaths))) return false;
  return !runs.some((run) => run.status === "executed" && isVerificationAction(run.action, writePaths));
}

function isWriteActionForContinuation(action: CancipAction): boolean {
  if (action.type === "write" || action.type === "append" || action.type === "patch" || action.type === "mkdir" || action.type === "rename" || action.type === "move" || action.type === "copy" || action.type === "delete") return true;
  if (action.type === "config") return true;
  if (action.type === "todo") return action.op !== "list";
  if (action.type === "automation") return action.op !== "list";
  if (action.type !== "command") return false;
  return !isLowCommitmentAction(action);
}

function actionVerificationPath(action: CancipAction): string {
  if (action.type === "rename" || action.type === "move" || action.type === "copy") return normalizePath(action.newPath);
  if (action.type === "config") return normalizePath(action.path?.trim() || CANCIP_CONFIG_PATH);
  if ("path" in action && typeof action.path === "string") return normalizePath(action.path);
  if (action.type === "command") return action.command.trim();
  if (action.type === "automation") return action.id?.trim() || "automation";
  return "";
}

function isSelfVerifyingAction(action: CancipAction, writePaths: string[]): boolean {
  if (action.type === "write" || action.type === "append" || action.type === "delete") {
    const path = normalizePath(action.path);
    return writePaths.some((target) => target === path);
  }
  if (action.type === "rename" || action.type === "move") {
    const newPath = normalizePath(action.newPath);
    return writePaths.some((target) => target === newPath);
  }
  if (action.type === "config") {
    const path = normalizePath(action.path?.trim() || CANCIP_CONFIG_PATH);
    return writePaths.some((target) => target === path);
  }
  return false;
}

function isVerificationAction(action: CancipAction, writePaths: string[]): boolean {
  if (action.type === "config") {
    const path = normalizePath(action.path?.trim() || CANCIP_CONFIG_PATH);
    return writePaths.some((target) => target === path);
  }
  if (action.type === "read") {
    const path = normalizePath(action.path);
    return writePaths.some((target) => target === path || target.startsWith("command:"));
  }
  if (action.type !== "command") return false;
  const command = action.command.trim();
  if (command === "cancip.searchVault" || command === "cancip.previewVaultSearch") return true;
  return writePaths.some((target) => target === command);
}

function isLowCommitmentAction(action: CancipAction): boolean {
  if (action.type === "read") return true;
  if (action.type === "todo") return true;
  if (action.type === "automation") return action.op === "list";
  if (action.type !== "command") return false;
  return new Set([
    "obsidian.listCommands",
    "cancip.reviewGate.list",
    "cancip.sessionEvents",
    "cancip.installedPlugins",
    "cancip.searchVault",
    "cancip.previewVaultSearch",
    "cancip.automation.templates",
    "cancip.automation.list",
    "github.help",
    "github.status",
    "github.repo",
    "github.issues",
    "github.pulls",
    "github.releases",
    "github.workflowRuns",
    "github.branches",
    "github.file"
  ]).has(action.command.trim());
}

function removeCancipActionBlocks(content: string): string {
  return content
    .replace(/```cancip-action\s*[\s\S]*?```/gi, "\n\n")
    .replace(/<cancip-action\b[^>]*>[\s\S]*?<\/cancip-action>/gi, "\n\n")
    .replace(/\n{3,}/g, "\n\n");
}

function isRepairSlashCommand(input: string): boolean {
  const normalized = input.trim().toLowerCase();
  return normalized === "/修复" || normalized === "/fix" || normalized === "/repair";
}

function looksLikePathQuery(input: string): boolean {
  return /(^|[\s"'`])\.?[A-Za-z0-9_\-\u4e00-\u9fff]+[\/\\][^\s"'`]+/.test(input) || /\.[A-Za-z0-9]{2,6}($|[\s"'`，。；,;])/.test(input);
}

function shouldScanHiddenForQuery(query: string): boolean {
  const lower = query.toLowerCase().trim();
  return lower.startsWith(".") || lower.includes("obsidian") || lower.includes("cancip") || lower.includes("config") || lower.includes("plugin") || lower.includes("插件") || lower.includes("配置");
}

function hiddenMentionFoldersForQuery(query: string): string[] {
  const lower = query.toLowerCase();
  if (lower.includes(".obsidian") || lower.includes("obsidian") || lower.includes("plugin") || lower.includes("插件")) return [".obsidian"];
  if (lower.includes(".cancip") || lower.includes("cancip") || lower.includes("config") || lower.includes("配置")) return [".cancip", ".obsidian"];
  return [".obsidian", ".cancip"];
}

function scoreSearchCandidate(file: VaultTextFile, tokens: string[]): number {
  const text = `${file.basename}\n${file.path}`.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (file.basename.toLowerCase() === token) score += 100;
    if (file.basename.toLowerCase().includes(token)) score += 20;
    if (text.includes(token)) score += 8;
  }
  if (file.path.startsWith("AI/Cancip/Memory/")) score += 6;
  if (file.loaded) score += 2;
  return score;
}

function memoryFilePriority(path: string): number {
  const name = path.split("/").pop() ?? "";
  const order = [
    "USER_PREFERENCES_QUICK.md",
    "PREFERENCES.md",
    "PROJECTS.md",
    "WORKFLOWS.md",
    "TOOLS.md",
    "SKILLS.md",
    "PROFILE.md",
    "obsidian-整理偏好.md",
    "INDEX.md",
    "NOTIFICATIONS.md",
    "TRADING.md",
    "C-DEPENDENCY-MIGRATION.md",
    "README.md"
  ];
  const index = order.indexOf(name);
  return index >= 0 ? index : 100;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutId: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  });
}

function resolveLanguage(mode: LanguageMode): Language {
  if (isLanguage(mode)) return mode;
  return resolveLocaleLanguage(navigator.language || "en");
}

function resolveLocaleLanguage(locale: string): Language {
  const normalized = locale.toLowerCase();
  if (normalized.startsWith("zh")) {
    return normalized.includes("tw") || normalized.includes("hk") || normalized.includes("mo") || normalized.includes("hant")
      ? "zh-TW"
      : "zh";
  }
  if (normalized.startsWith("ug")) return "ug";
  if (normalized.startsWith("tr")) return "tr";
  if (normalized.startsWith("ru")) return "ru";
  if (normalized.startsWith("ja")) return "ja";
  if (normalized.startsWith("ko")) return "ko";
  if (normalized.startsWith("es")) return "es";
  if (normalized.startsWith("fr")) return "fr";
  if (normalized.startsWith("de")) return "de";
  if (normalized.startsWith("ar")) return "ar";
  return "en";
}

function languageSelectOptions(autoLabel: string): Record<LanguageMode, string> {
  return {
    auto: autoLabel,
    zh: LANGUAGE_LABELS.zh,
    "zh-TW": LANGUAGE_LABELS["zh-TW"],
    en: LANGUAGE_LABELS.en,
    ug: LANGUAGE_LABELS.ug,
    tr: LANGUAGE_LABELS.tr,
    ru: LANGUAGE_LABELS.ru,
    ja: LANGUAGE_LABELS.ja,
    ko: LANGUAGE_LABELS.ko,
    es: LANGUAGE_LABELS.es,
    fr: LANGUAGE_LABELS.fr,
    de: LANGUAGE_LABELS.de,
    ar: LANGUAGE_LABELS.ar
  };
}

function isChineseLanguage(language: Language): boolean {
  return language === "zh" || language === "zh-TW";
}

function formatI18n(template: string, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? ""));
}

function isReadOnlyAction(action: CancipAction): boolean {
  if (action.type === "read") return true;
  if (action.type === "todo") return action.op === "list";
  if (action.type === "automation") return action.op === "list";
  if (action.type !== "command") return false;
  const command = action.command.trim();
  return new Set([
    "obsidian.listCommands",
    "cancip.reviewGate.list",
    "cancip.sessionEvents",
    "cancip.installedPlugins",
    "cancip.searchVault",
    "cancip.previewVaultSearch",
    "cancip.automation.templates",
    "cancip.automation.list",
    "github.help",
    "github.status",
    "github.repo",
    "github.issues",
    "github.pulls",
    "github.releases",
    "github.workflowRuns",
    "github.branches",
    "github.file"
  ]).has(command);
}

function getDefaultApiProfile(): ApiProfile {
  return { ...DEFAULT_SETTINGS.apiProfiles[0] };
}

function normalizeApiProfile(raw: Partial<ApiProfile>, fallback: ApiProfile): ApiProfile {
  const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : fallback.id;
  const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : fallback.name;
  const apiMode = isApiMode(raw.apiMode) ? raw.apiMode : fallback.apiMode;
  return {
    id,
    name,
    apiUrl: typeof raw.apiUrl === "string" ? raw.apiUrl.trim() : fallback.apiUrl,
    apiKey: typeof raw.apiKey === "string" ? raw.apiKey.trim() : fallback.apiKey,
    apiMode,
    model: typeof raw.model === "string" && raw.model.trim() ? raw.model.trim() : fallback.model
  };
}

function normalizeApiProfiles(raw: unknown, legacy: ApiProfile): ApiProfile[] {
  if (!Array.isArray(raw) || !raw.length) return [legacy];
  const seen = new Set<string>();
  const profiles: ApiProfile[] = [];
  raw.forEach((item, index) => {
    if (!isRecord(item)) return;
    const fallback = index === 0 ? legacy : { ...legacy, id: `profile-${index + 1}`, name: `Profile ${index + 1}`, apiKey: "" };
    let profile = normalizeApiProfile(item as Partial<ApiProfile>, fallback);
    if (seen.has(profile.id)) {
      profile = { ...profile, id: `${profile.id}-${index + 1}` };
    }
    seen.add(profile.id);
    profiles.push(profile);
  });
  return profiles.length ? profiles : [legacy];
}

function normalizeModelOptions(raw: unknown, activeModel?: string): string[] {
  const values: string[] = [];
  const push = (value: unknown): void => {
    if (typeof value !== "string") return;
    for (const part of value.split(/[\r\n,]+/)) {
      const model = part.trim();
      if (model) values.push(model);
    }
  };
  if (Array.isArray(raw)) {
    for (const item of raw) push(item);
  } else {
    push(raw);
  }
  if (!values.length) values.push(...MODEL_PRESETS);
  if (activeModel?.trim()) values.unshift(activeModel.trim());
  return uniqueStrings(values).slice(0, 80);
}

function getActiveApiProfile(settings: Settings): ApiProfile {
  return settings.apiProfiles.find((profile) => profile.id === settings.activeApiProfileId) ?? settings.apiProfiles[0] ?? getDefaultApiProfile();
}

function hasLegacyApiProfileFields(settings: Partial<Settings>): boolean {
  return settings.apiUrl !== undefined || settings.apiKey !== undefined || settings.apiMode !== undefined || settings.model !== undefined;
}

function migrateVisibleFolderDefaults(settings: Settings): Settings {
  const folder = normalizePath(settings.memoryFolder);
  if (
    folder !== normalizePath(LEGACY_DEFAULT_MEMORY_FOLDER) &&
    folder !== normalizePath(INTERRUPTED_DEFAULT_MEMORY_FOLDER)
  ) {
    return settings;
  }
  return { ...settings, memoryFolder: DEFAULT_MEMORY_FOLDER };
}

function migrateDefaultMemorySearchPolicy(settings: Settings): Settings {
  let next = settings;
  if (settings.useVaultSearchByDefault) {
    next = { ...next, useVaultSearchByDefault: false };
  }
  if (settings.codexMemoryAutoSearch) {
    next = { ...next, codexMemoryAutoSearch: false };
  }
  if (!settings.includeCoreMemory) {
    next = { ...next, includeCoreMemory: true };
  }
  if (!settings.memoryFolder.trim()) {
    next = { ...next, memoryFolder: DEFAULT_MEMORY_FOLDER };
  }
  if (isOutdatedSystemPrompt(settings.systemPrompt)) {
    next = { ...next, systemPrompt: DEFAULT_SYSTEM_PROMPT };
  }
  return next;
}

function isOutdatedSystemPrompt(prompt: string): boolean {
  const normalized = prompt.trim();
  if (!normalized) return true;
  if (/Cancip Core Prompt v0\.1\.\d+/i.test(normalized) && !normalized.includes("Cancip Core Prompt v0.1.102")) return true;
  return (
    normalized === LEGACY_SYSTEM_PROMPT ||
    normalized.includes("核心记忆和 Vault Search 上下文回答") ||
    normalized.includes("Vault Search 自动命中只作为来源路径元数据") ||
    normalized.includes("你是 Obsidian Vault 里的 Cancip") ||
    (!normalized.includes("工具结果和错误是权威上下文") && !normalized.includes("Tool failures are authoritative"))
  );
}

function normalizeSettings(input: Partial<Settings>): Settings {
  const merged = { ...DEFAULT_SETTINGS, ...input };
  const temperature = Number(merged.temperature);
  const maxOutputTokens = Number.parseInt(String(merged.maxOutputTokens), 10);
  const maxContextFiles = Number.parseInt(String(merged.maxContextFiles), 10);
  const maxCoreMemoryFiles = Number.parseInt(String(merged.maxCoreMemoryFiles), 10);
  const maxRecentTranscriptMessages = Number.parseInt(String(merged.maxRecentTranscriptMessages), 10);
  const maxMentionResults = Number.parseInt(String(merged.maxMentionResults), 10);
  const maxMentionFolderFiles = Number.parseInt(String(merged.maxMentionFolderFiles), 10);
  const maxFileContextChars = Number.parseInt(String(merged.maxFileContextChars), 10);
  const maxFolderFileContextChars = Number.parseInt(String(merged.maxFolderFileContextChars), 10);
  const maxToolIterations = Number.parseInt(String(merged.maxToolIterations), 10);
  const codexMemoryMaxFiles = Number.parseInt(String(merged.codexMemoryMaxFiles), 10);
  const codexMemoryMaxChars = Number.parseInt(String(merged.codexMemoryMaxChars), 10);
  const localVersionHour = Number.parseInt(String(merged.localVersionHour), 10);
  const localVersionMaxFileBytes = Number.parseInt(String(merged.localVersionMaxFileBytes), 10);
  const automationCheckMinutes = Number.parseInt(String(merged.automationCheckMinutes), 10);
  const legacyProfile = normalizeApiProfile(
    {
      id: "default",
      name: DEFAULT_SETTINGS.apiProfiles[0].name,
      apiUrl: merged.apiUrl,
      apiKey: merged.apiKey,
      apiMode: merged.apiMode,
      model: merged.model
    },
    getDefaultApiProfile()
  );
  const apiProfiles = normalizeApiProfiles(input.apiProfiles, legacyProfile);
  const activeApiProfileId =
    typeof merged.activeApiProfileId === "string" && apiProfiles.some((profile) => profile.id === merged.activeApiProfileId)
      ? merged.activeApiProfileId
      : apiProfiles[0].id;
  const activeProfile = apiProfiles.find((profile) => profile.id === activeApiProfileId) ?? apiProfiles[0];
  const modelOptions = normalizeModelOptions(merged.modelOptions, activeProfile.model);
  return {
    ...merged,
    language: isLanguageMode(merged.language) ? merged.language : DEFAULT_SETTINGS.language,
    accessMode: isAccessMode(merged.accessMode) ? merged.accessMode : DEFAULT_SETTINGS.accessMode,
    activeApiProfileId,
    apiProfiles,
    apiMode: activeProfile.apiMode,
    apiUrl: activeProfile.apiUrl,
    apiKey: activeProfile.apiKey,
    model: activeProfile.model,
    modelOptions,
    temperature: Number.isFinite(temperature) ? Math.max(0, Math.min(2, temperature)) : DEFAULT_SETTINGS.temperature,
    maxOutputTokens: Number.isFinite(maxOutputTokens) ? Math.max(16, Math.min(32000, maxOutputTokens)) : DEFAULT_SETTINGS.maxOutputTokens,
    maxContextFiles: Number.isFinite(maxContextFiles) ? Math.max(1, Math.min(20, maxContextFiles)) : DEFAULT_SETTINGS.maxContextFiles,
    memoryFolder: typeof merged.memoryFolder === "string" ? merged.memoryFolder : DEFAULT_SETTINGS.memoryFolder,
    includeCurrentFile: Boolean(merged.includeCurrentFile),
    includeCoreMemory: Boolean(merged.includeCoreMemory),
    maxCoreMemoryFiles: Number.isFinite(maxCoreMemoryFiles) ? Math.max(0, Math.min(12, maxCoreMemoryFiles)) : DEFAULT_SETTINGS.maxCoreMemoryFiles,
    codexMemoryImportPath: typeof merged.codexMemoryImportPath === "string" ? merged.codexMemoryImportPath : DEFAULT_SETTINGS.codexMemoryImportPath,
    codexMemoryAutoImport: typeof merged.codexMemoryAutoImport === "boolean" ? merged.codexMemoryAutoImport : DEFAULT_SETTINGS.codexMemoryAutoImport,
    codexMemoryAutoSearch: typeof merged.codexMemoryAutoSearch === "boolean" ? merged.codexMemoryAutoSearch : DEFAULT_SETTINGS.codexMemoryAutoSearch,
    codexMemoryMaxFiles: Number.isFinite(codexMemoryMaxFiles) ? Math.max(1, Math.min(12, codexMemoryMaxFiles)) : DEFAULT_SETTINGS.codexMemoryMaxFiles,
    codexMemoryMaxChars: Number.isFinite(codexMemoryMaxChars) ? Math.max(1000, Math.min(60000, codexMemoryMaxChars)) : DEFAULT_SETTINGS.codexMemoryMaxChars,
    useVaultSearchByDefault: Boolean(merged.useVaultSearchByDefault),
    showAttachmentButton: typeof merged.showAttachmentButton === "boolean" ? merged.showAttachmentButton : DEFAULT_SETTINGS.showAttachmentButton,
    compactHeader: typeof merged.compactHeader === "boolean" ? merged.compactHeader : DEFAULT_SETTINGS.compactHeader,
    autoOpenPlanPanel: typeof merged.autoOpenPlanPanel === "boolean" ? merged.autoOpenPlanPanel : DEFAULT_SETTINGS.autoOpenPlanPanel,
    showLiveTodos: typeof merged.showLiveTodos === "boolean" ? merged.showLiveTodos : DEFAULT_SETTINGS.showLiveTodos,
    showManualTodos: typeof merged.showManualTodos === "boolean" ? merged.showManualTodos : DEFAULT_SETTINGS.showManualTodos,
    commandBusEnabled: typeof merged.commandBusEnabled === "boolean" ? merged.commandBusEnabled : DEFAULT_SETTINGS.commandBusEnabled,
    executeObsidianCommands: typeof merged.executeObsidianCommands === "boolean" ? merged.executeObsidianCommands : DEFAULT_SETTINGS.executeObsidianCommands,
    githubCommandsEnabled: typeof merged.githubCommandsEnabled === "boolean" ? merged.githubCommandsEnabled : DEFAULT_SETTINGS.githubCommandsEnabled,
    githubApiBaseUrl: typeof merged.githubApiBaseUrl === "string" ? merged.githubApiBaseUrl : DEFAULT_SETTINGS.githubApiBaseUrl,
    githubDownloadBaseUrl: typeof merged.githubDownloadBaseUrl === "string" ? merged.githubDownloadBaseUrl : DEFAULT_SETTINGS.githubDownloadBaseUrl,
    githubOwner: typeof merged.githubOwner === "string" ? merged.githubOwner : DEFAULT_SETTINGS.githubOwner,
    githubRepo: typeof merged.githubRepo === "string" ? merged.githubRepo : DEFAULT_SETTINGS.githubRepo,
    githubToken: typeof merged.githubToken === "string" ? merged.githubToken : DEFAULT_SETTINGS.githubToken,
    autoContinueAfterTools: typeof merged.autoContinueAfterTools === "boolean" ? merged.autoContinueAfterTools : DEFAULT_SETTINGS.autoContinueAfterTools,
    maxToolIterations: Number.isFinite(maxToolIterations) ? Math.max(0, Math.min(10, maxToolIterations)) : DEFAULT_SETTINGS.maxToolIterations,
    exportMarkdownContextSnapshots: typeof merged.exportMarkdownContextSnapshots === "boolean" ? merged.exportMarkdownContextSnapshots : DEFAULT_SETTINGS.exportMarkdownContextSnapshots,
    exportMarkdownManualTodos: typeof merged.exportMarkdownManualTodos === "boolean" ? merged.exportMarkdownManualTodos : DEFAULT_SETTINGS.exportMarkdownManualTodos,
    maxRecentTranscriptMessages: Number.isFinite(maxRecentTranscriptMessages) ? Math.max(0, Math.min(40, maxRecentTranscriptMessages)) : DEFAULT_SETTINGS.maxRecentTranscriptMessages,
    maxMentionResults: Number.isFinite(maxMentionResults) ? Math.max(4, Math.min(40, maxMentionResults)) : DEFAULT_SETTINGS.maxMentionResults,
    maxMentionFolderFiles: Number.isFinite(maxMentionFolderFiles) ? Math.max(1, Math.min(30, maxMentionFolderFiles)) : DEFAULT_SETTINGS.maxMentionFolderFiles,
    maxFileContextChars: Number.isFinite(maxFileContextChars) ? Math.max(500, Math.min(50000, maxFileContextChars)) : DEFAULT_SETTINGS.maxFileContextChars,
    maxFolderFileContextChars: Number.isFinite(maxFolderFileContextChars) ? Math.max(300, Math.min(20000, maxFolderFileContextChars)) : DEFAULT_SETTINGS.maxFolderFileContextChars,
    dailyLocalVersioning: typeof merged.dailyLocalVersioning === "boolean" ? merged.dailyLocalVersioning : DEFAULT_SETTINGS.dailyLocalVersioning,
    localVersionHour: Number.isFinite(localVersionHour) ? Math.max(0, Math.min(23, localVersionHour)) : DEFAULT_SETTINGS.localVersionHour,
    localVersionMaxFileBytes: Number.isFinite(localVersionMaxFileBytes) ? Math.max(1024, Math.min(5242880, localVersionMaxFileBytes)) : DEFAULT_SETTINGS.localVersionMaxFileBytes,
    automationsEnabled: typeof merged.automationsEnabled === "boolean" ? merged.automationsEnabled : DEFAULT_SETTINGS.automationsEnabled,
    automationCheckMinutes: Number.isFinite(automationCheckMinutes) ? Math.max(1, Math.min(1440, automationCheckMinutes)) : DEFAULT_SETTINGS.automationCheckMinutes,
    showSupportCodes: typeof merged.showSupportCodes === "boolean" ? merged.showSupportCodes : DEFAULT_SETTINGS.showSupportCodes,
    supportCodeOnePath: typeof merged.supportCodeOnePath === "string" ? merged.supportCodeOnePath : DEFAULT_SETTINGS.supportCodeOnePath,
    supportCodeTwoPath: typeof merged.supportCodeTwoPath === "string" ? merged.supportCodeTwoPath : DEFAULT_SETTINGS.supportCodeTwoPath,
    supportCodeOneLabel: typeof merged.supportCodeOneLabel === "string" ? merged.supportCodeOneLabel : DEFAULT_SETTINGS.supportCodeOneLabel,
    supportCodeTwoLabel: typeof merged.supportCodeTwoLabel === "string" ? merged.supportCodeTwoLabel : DEFAULT_SETTINGS.supportCodeTwoLabel,
    systemPrompt: typeof merged.systemPrompt === "string" ? merged.systemPrompt : DEFAULT_SETTINGS.systemPrompt
  };
}

function settingsToCancipConfig(settings: Settings): Record<string, unknown> {
  return {
    schemaVersion: CANCIP_CONFIG_SCHEMA_VERSION,
    accessMode: settings.accessMode,
    language: settings.language,
    activeApiProfileId: settings.activeApiProfileId,
    apiProfiles: settings.apiProfiles,
    apiUrl: settings.apiUrl,
    apiKey: settings.apiKey,
    apiMode: settings.apiMode,
    model: settings.model,
    modelOptions: settings.modelOptions,
    temperature: settings.temperature,
    maxOutputTokens: settings.maxOutputTokens,
    maxContextFiles: settings.maxContextFiles,
    memoryFolder: settings.memoryFolder,
    includeCurrentFile: settings.includeCurrentFile,
    includeCoreMemory: settings.includeCoreMemory,
    maxCoreMemoryFiles: settings.maxCoreMemoryFiles,
    codexMemoryImportPath: settings.codexMemoryImportPath,
    codexMemoryAutoImport: settings.codexMemoryAutoImport,
    codexMemoryAutoSearch: settings.codexMemoryAutoSearch,
    codexMemoryMaxFiles: settings.codexMemoryMaxFiles,
    codexMemoryMaxChars: settings.codexMemoryMaxChars,
    useVaultSearchByDefault: settings.useVaultSearchByDefault,
    showAttachmentButton: settings.showAttachmentButton,
    compactHeader: settings.compactHeader,
    autoOpenPlanPanel: settings.autoOpenPlanPanel,
    showLiveTodos: settings.showLiveTodos,
    showManualTodos: settings.showManualTodos,
    commandBusEnabled: settings.commandBusEnabled,
    executeObsidianCommands: settings.executeObsidianCommands,
    githubCommandsEnabled: settings.githubCommandsEnabled,
    githubApiBaseUrl: settings.githubApiBaseUrl,
    githubDownloadBaseUrl: settings.githubDownloadBaseUrl,
    githubOwner: settings.githubOwner,
    githubRepo: settings.githubRepo,
    githubToken: settings.githubToken,
    autoContinueAfterTools: settings.autoContinueAfterTools,
    maxToolIterations: settings.maxToolIterations,
    exportMarkdownContextSnapshots: settings.exportMarkdownContextSnapshots,
    exportMarkdownManualTodos: settings.exportMarkdownManualTodos,
    maxRecentTranscriptMessages: settings.maxRecentTranscriptMessages,
    maxMentionResults: settings.maxMentionResults,
    maxMentionFolderFiles: settings.maxMentionFolderFiles,
    maxFileContextChars: settings.maxFileContextChars,
    maxFolderFileContextChars: settings.maxFolderFileContextChars,
    dailyLocalVersioning: settings.dailyLocalVersioning,
    localVersionHour: settings.localVersionHour,
    localVersionMaxFileBytes: settings.localVersionMaxFileBytes,
    automationsEnabled: settings.automationsEnabled,
    automationCheckMinutes: settings.automationCheckMinutes,
    showSupportCodes: settings.showSupportCodes,
    supportCodeOnePath: settings.supportCodeOnePath,
    supportCodeTwoPath: settings.supportCodeTwoPath,
    supportCodeOneLabel: settings.supportCodeOneLabel,
    supportCodeTwoLabel: settings.supportCodeTwoLabel,
    systemPrompt: settings.systemPrompt
  };
}

function parseCancipConfig(raw: unknown): Partial<Settings> {
  if (!isRecord(raw)) return {};
  const config: Partial<Settings> = {};
  if (isLanguageMode(raw.language)) config.language = raw.language;
  if (isAccessMode(raw.accessMode)) config.accessMode = raw.accessMode;
  if (typeof raw.activeApiProfileId === "string") config.activeApiProfileId = raw.activeApiProfileId;
  if (Array.isArray(raw.apiProfiles)) {
    const legacy = normalizeApiProfile(
      {
        id: "default",
        name: typeof raw.name === "string" ? raw.name : DEFAULT_SETTINGS.apiProfiles[0].name,
        apiUrl: typeof raw.apiUrl === "string" ? raw.apiUrl : DEFAULT_SETTINGS.apiUrl,
        apiKey: typeof raw.apiKey === "string" ? raw.apiKey : DEFAULT_SETTINGS.apiKey,
        apiMode: isApiMode(raw.apiMode) ? raw.apiMode : DEFAULT_SETTINGS.apiMode,
        model: typeof raw.model === "string" ? raw.model : DEFAULT_SETTINGS.model
      },
      getDefaultApiProfile()
    );
    config.apiProfiles = normalizeApiProfiles(raw.apiProfiles, legacy);
  }
  if (typeof raw.apiUrl === "string") config.apiUrl = raw.apiUrl;
  if (typeof raw.apiKey === "string") config.apiKey = raw.apiKey;
  if (isApiMode(raw.apiMode)) config.apiMode = raw.apiMode;
  if (typeof raw.model === "string") config.model = raw.model;
  if (Array.isArray(raw.modelOptions) || typeof raw.modelOptions === "string") config.modelOptions = normalizeModelOptions(raw.modelOptions, typeof raw.model === "string" ? raw.model : undefined);
  if (typeof raw.temperature === "number" || typeof raw.temperature === "string") config.temperature = Number(raw.temperature);
  if (typeof raw.maxOutputTokens === "number" || typeof raw.maxOutputTokens === "string") config.maxOutputTokens = Number.parseInt(String(raw.maxOutputTokens), 10);
  if (typeof raw.maxContextFiles === "number" || typeof raw.maxContextFiles === "string") config.maxContextFiles = Number.parseInt(String(raw.maxContextFiles), 10);
  if (typeof raw.memoryFolder === "string") config.memoryFolder = raw.memoryFolder;
  if (typeof raw.includeCurrentFile === "boolean") config.includeCurrentFile = raw.includeCurrentFile;
  if (typeof raw.includeCoreMemory === "boolean") config.includeCoreMemory = raw.includeCoreMemory;
  if (typeof raw.maxCoreMemoryFiles === "number" || typeof raw.maxCoreMemoryFiles === "string") config.maxCoreMemoryFiles = Number.parseInt(String(raw.maxCoreMemoryFiles), 10);
  if (typeof raw.codexMemoryImportPath === "string") config.codexMemoryImportPath = raw.codexMemoryImportPath;
  if (typeof raw.codexMemoryAutoImport === "boolean") config.codexMemoryAutoImport = raw.codexMemoryAutoImport;
  if (typeof raw.codexMemoryAutoSearch === "boolean") config.codexMemoryAutoSearch = raw.codexMemoryAutoSearch;
  if (typeof raw.codexMemoryMaxFiles === "number" || typeof raw.codexMemoryMaxFiles === "string") config.codexMemoryMaxFiles = Number.parseInt(String(raw.codexMemoryMaxFiles), 10);
  if (typeof raw.codexMemoryMaxChars === "number" || typeof raw.codexMemoryMaxChars === "string") config.codexMemoryMaxChars = Number.parseInt(String(raw.codexMemoryMaxChars), 10);
  if (typeof raw.useVaultSearchByDefault === "boolean") config.useVaultSearchByDefault = raw.useVaultSearchByDefault;
  if (typeof raw.showAttachmentButton === "boolean") config.showAttachmentButton = raw.showAttachmentButton;
  if (typeof raw.compactHeader === "boolean") config.compactHeader = raw.compactHeader;
  if (typeof raw.autoOpenPlanPanel === "boolean") config.autoOpenPlanPanel = raw.autoOpenPlanPanel;
  if (typeof raw.showLiveTodos === "boolean") config.showLiveTodos = raw.showLiveTodos;
  if (typeof raw.showManualTodos === "boolean") config.showManualTodos = raw.showManualTodos;
  if (typeof raw.commandBusEnabled === "boolean") config.commandBusEnabled = raw.commandBusEnabled;
  if (typeof raw.executeObsidianCommands === "boolean") config.executeObsidianCommands = raw.executeObsidianCommands;
  if (typeof raw.githubCommandsEnabled === "boolean") config.githubCommandsEnabled = raw.githubCommandsEnabled;
  if (typeof raw.githubApiBaseUrl === "string") config.githubApiBaseUrl = raw.githubApiBaseUrl;
  if (typeof raw.githubDownloadBaseUrl === "string") config.githubDownloadBaseUrl = raw.githubDownloadBaseUrl;
  if (typeof raw.githubOwner === "string") config.githubOwner = raw.githubOwner;
  if (typeof raw.githubRepo === "string") config.githubRepo = raw.githubRepo;
  if (typeof raw.githubToken === "string") config.githubToken = raw.githubToken;
  if (typeof raw.autoContinueAfterTools === "boolean") config.autoContinueAfterTools = raw.autoContinueAfterTools;
  if (typeof raw.maxToolIterations === "number" || typeof raw.maxToolIterations === "string") config.maxToolIterations = Number.parseInt(String(raw.maxToolIterations), 10);
  if (typeof raw.exportMarkdownContextSnapshots === "boolean") config.exportMarkdownContextSnapshots = raw.exportMarkdownContextSnapshots;
  if (typeof raw.exportMarkdownManualTodos === "boolean") config.exportMarkdownManualTodos = raw.exportMarkdownManualTodos;
  if (typeof raw.maxRecentTranscriptMessages === "number" || typeof raw.maxRecentTranscriptMessages === "string") config.maxRecentTranscriptMessages = Number.parseInt(String(raw.maxRecentTranscriptMessages), 10);
  if (typeof raw.maxMentionResults === "number" || typeof raw.maxMentionResults === "string") config.maxMentionResults = Number.parseInt(String(raw.maxMentionResults), 10);
  if (typeof raw.maxMentionFolderFiles === "number" || typeof raw.maxMentionFolderFiles === "string") config.maxMentionFolderFiles = Number.parseInt(String(raw.maxMentionFolderFiles), 10);
  if (typeof raw.maxFileContextChars === "number" || typeof raw.maxFileContextChars === "string") config.maxFileContextChars = Number.parseInt(String(raw.maxFileContextChars), 10);
  if (typeof raw.maxFolderFileContextChars === "number" || typeof raw.maxFolderFileContextChars === "string") config.maxFolderFileContextChars = Number.parseInt(String(raw.maxFolderFileContextChars), 10);
  if (typeof raw.dailyLocalVersioning === "boolean") config.dailyLocalVersioning = raw.dailyLocalVersioning;
  if (typeof raw.localVersionHour === "number" || typeof raw.localVersionHour === "string") config.localVersionHour = Number.parseInt(String(raw.localVersionHour), 10);
  if (typeof raw.localVersionMaxFileBytes === "number" || typeof raw.localVersionMaxFileBytes === "string") config.localVersionMaxFileBytes = Number.parseInt(String(raw.localVersionMaxFileBytes), 10);
  if (typeof raw.automationsEnabled === "boolean") config.automationsEnabled = raw.automationsEnabled;
  if (typeof raw.automationCheckMinutes === "number" || typeof raw.automationCheckMinutes === "string") config.automationCheckMinutes = Number.parseInt(String(raw.automationCheckMinutes), 10);
  if (typeof raw.showSupportCodes === "boolean") config.showSupportCodes = raw.showSupportCodes;
  if (typeof raw.supportCodeOnePath === "string") config.supportCodeOnePath = raw.supportCodeOnePath;
  if (typeof raw.supportCodeTwoPath === "string") config.supportCodeTwoPath = raw.supportCodeTwoPath;
  if (typeof raw.supportCodeOneLabel === "string") config.supportCodeOneLabel = raw.supportCodeOneLabel;
  if (typeof raw.supportCodeTwoLabel === "string") config.supportCodeTwoLabel = raw.supportCodeTwoLabel;
  if (typeof raw.systemPrompt === "string") config.systemPrompt = raw.systemPrompt;
  return config;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneJsonObject(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function cloneJsonValue(value: unknown): unknown {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
}

function deepMergeJsonObject(target: Record<string, unknown>, patch: Record<string, unknown>, changed: Set<string>, prefix = ""): void {
  for (const [key, value] of Object.entries(patch)) {
    if (!key) continue;
    const keyPath = prefix ? `${prefix}.${key}` : key;
    if (isRecord(value) && isRecord(target[key])) {
      deepMergeJsonObject(target[key] as Record<string, unknown>, value, changed, keyPath);
      continue;
    }
    target[key] = cloneJsonValue(value);
    changed.add(keyPath);
  }
}

function deleteJsonPath(target: Record<string, unknown>, keyPath: string): boolean {
  const parts = keyPath.split(".").map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return false;
  let cursor: Record<string, unknown> = target;
  for (const part of parts.slice(0, -1)) {
    const next = cursor[part];
    if (!isRecord(next)) return false;
    cursor = next;
  }
  const last = parts[parts.length - 1];
  if (!Object.prototype.hasOwnProperty.call(cursor, last)) return false;
  delete cursor[last];
  return true;
}

function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && (LANGUAGE_VALUES as readonly string[]).includes(value);
}

function isLanguageMode(value: unknown): value is LanguageMode {
  return value === "auto" || isLanguage(value);
}

function isAccessMode(value: unknown): value is AccessMode {
  return value === "ask-for-approval" || value === "full-access";
}

function isSessionStatus(value: unknown): value is NonNullable<SessionHistoryEntry["status"]> {
  return value === "idle" || value === "running" || value === "completed" || value === "failed";
}

function redactSessionEvent(event: SessionEvent): SessionEvent {
  return {
    ...event,
    summary: event.summary ? trimContext(redactSensitiveText(event.summary), 400) : undefined,
    detail: event.detail ? trimContext(redactSensitiveText(event.detail), 1600) : undefined
  };
}

async function recordCancipSessionEvent(adapter: DataAdapter, event: SessionEvent): Promise<void> {
  try {
    await ensureFolder(adapter, SESSION_HISTORY_DIR);
    const payload: SessionEvent = {
      ...event,
      at: event.at ?? new Date().toISOString()
    };
    const line = `${JSON.stringify(redactSessionEvent(payload))}\n`;
    if (!(await adapter.exists(SESSION_EVENTS_PATH))) {
      await adapter.write(SESSION_EVENTS_PATH, line);
      return;
    }
    const existing = await adapter.read(SESSION_EVENTS_PATH);
    const next = existing.length > SESSION_EVENTS_MAX_BYTES
      ? `${existing.slice(-Math.floor(SESSION_EVENTS_MAX_BYTES * 0.8))}${line}`
      : `${existing}${line}`;
    await adapter.write(SESSION_EVENTS_PATH, next);
  } catch (error) {
    console.warn("Cancip session event write failed", error);
  }
}

function formatSessionEventLine(event: SessionEventView): string {
  const parts = [
    event.at || "-",
    event.kind,
    event.sessionId ? `session=${event.sessionId}` : "",
    event.status ? `status=${event.status}` : "",
    event.toolStatus ? `tool=${event.toolStatus}` : "",
    event.role ? `role=${event.role}` : "",
    event.summary ? `summary=${trimContext(redactSensitiveText(event.summary).replace(/\r?\n/g, " "), 180)}` : "",
    event.path ? `path=${event.path}` : "",
    event.detail ? `detail=${trimContext(redactSensitiveText(event.detail).replace(/\r?\n/g, " "), 260)}` : ""
  ].filter(Boolean);
  return parts.join(" | ");
}

function sessionEventIcon(kind: SessionEventKind): string {
  if (kind === "plugin.load") return "plug";
  if (kind.startsWith("session.")) return "messages-square";
  if (kind.startsWith("prompt.")) return "send";
  if (kind === "message.add") return "message-square";
  if (kind.startsWith("tool.")) return "wrench";
  return "list-checks";
}

function isComposerMode(value: unknown): value is ComposerMode {
  return value === "ask" || value === "search" || value === "plan" || value === "edit";
}

function isApiMode(value: unknown): value is ApiMode {
  return value === "auto" || value === "compatible" || value === "responses";
}

function normalizeSessionApiProfile(raw: Record<string, unknown>): ChatMessage["apiProfile"] {
  return {
    id: typeof raw.id === "string" ? raw.id : "",
    name: typeof raw.name === "string" ? raw.name : "",
    apiMode: isApiMode(raw.apiMode) ? raw.apiMode : "auto",
    model: typeof raw.model === "string" ? raw.model : "",
    hasApiUrl: Boolean(raw.hasApiUrl),
    hasApiKey: Boolean(raw.hasApiKey)
  };
}

function normalizeManualTodos(raw: unknown): ManualTodo[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(isRecord)
    .map((item) => ({
      id: typeof item.id === "string" && item.id ? item.id : crypto.randomUUID(),
      text: typeof item.text === "string" ? item.text.trim() : "",
      done: Boolean(item.done),
      createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString()
    }))
    .filter((item) => item.text);
}

function prepareMessageDisplay(content: string): MessageDisplay {
  const hiddenToolBlocks: FoldedMessageBlock[] = [];
  const processOnly = isProgressMessage(content) || isToolFeedbackMessage(content) || content.includes(PROCESS_MESSAGE_MARKER);
  let visibleContent = content.replace(/```([^\n`]*)\n?([\s\S]*?)```/g, (full: string, rawLang: string, body: string) => {
    const lang = rawLang.trim().toLowerCase();
    const trimmed = body.trim();
    if (trimmed && shouldFoldCodeBlock(lang, trimmed)) {
      hiddenToolBlocks.push({ title: foldedBlockTitle(lang, trimmed), content: lang ? `${lang}\n${trimmed}` : trimmed });
      return "\n\n";
    }
    return full;
  });
  visibleContent = visibleContent.replace(/<cancip-action\b[^>]*>([\s\S]*?)<\/cancip-action>/gi, (_full, body: string) => {
    const trimmed = body.trim();
    if (trimmed) hiddenToolBlocks.push({ title: "cancip-action", content: trimmed });
    return "\n\n";
  });
  visibleContent = visibleContent.replace(/<(thinking|reasoning)>([\s\S]*?)<\/\1>/gi, (_full, tag: string, body: string) => {
    const trimmed = body.trim();
    if (trimmed) hiddenToolBlocks.push({ title: tag, content: `${tag}\n${trimmed}` });
    return "\n\n";
  });
  visibleContent = foldInlineDetails(visibleContent, hiddenToolBlocks);
  visibleContent = foldReasoningSections(visibleContent, hiddenToolBlocks);
  visibleContent = foldProcessAfterConclusion(visibleContent, hiddenToolBlocks);

  const visibleLines: string[] = [];
  for (const line of visibleContent.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === PROGRESS_STEP_MARKER || trimmed === PROCESS_MESSAGE_MARKER) continue;
    if (trimmed.startsWith(TOOL_FEEDBACK_MARKER_PREFIX)) continue;
    const rawJson = trimmed.replace(/^(?:代码|code)\s*/i, "");
    if (/^\{\s*"?(?:actions|type)"?\s*:/.test(rawJson)) {
      hiddenToolBlocks.push({ title: "action json", content: rawJson });
      continue;
    }
    visibleLines.push(line);
  }

  visibleContent = visibleLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return { visibleContent, hiddenToolBlocks, hasProcessFold: hiddenToolBlocks.length > 0, processOnly };
}

function emptyMessageDisplay(content: string): MessageDisplay {
  return { visibleContent: content, hiddenToolBlocks: [], hasProcessFold: false, processOnly: false };
}

function isProgressMessage(content: string): boolean {
  return content.includes(PROGRESS_STEP_MARKER);
}

function isToolFeedbackMessage(content: string): boolean {
  return content.includes(TOOL_FEEDBACK_MARKER_PREFIX);
}

function messageOutlineText(content: string): string {
  const display = prepareMessageDisplay(redactSensitiveText(content));
  const text = (display.visibleContent || display.hiddenToolBlocks[0]?.title || content)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<details>[\s\S]*?<\/details>/gi, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_\-[\]()`]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return trimContext(text, 180);
}

function foldedBlockTitle(lang: string, body: string): string {
  if (lang === "cancip-action" || /^\{\s*"actions"\s*:/.test(body)) return "cancip-action";
  if (["bash", "sh", "zsh", "shell", "powershell", "ps1", "cmd", "bat", "terminal", "console"].includes(lang)) return lang || "command";
  if (lang) return lang;
  return body.startsWith("{") ? "json" : "details";
}

function foldInlineDetails(content: string, hiddenToolBlocks: FoldedMessageBlock[]): string {
  return content.replace(/<details>\s*<summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/gi, (_full, summary: string, body: string) => {
    const cleanSummary = summary.replace(/<[^>]+>/g, "").trim() || "details";
    const cleanBody = body.trim();
    if (cleanBody) hiddenToolBlocks.push({ title: cleanSummary, content: cleanBody });
    return "\n\n";
  });
}

function redactSensitiveText(input: string): string {
  if (!input) return input;
  let redacted = input.replace(/sk-[A-Za-z0-9_-]{12,}/g, "sk-***REDACTED***");
  redacted = redacted.replace(/ghp_[A-Za-z0-9_]{12,}/g, "ghp_***REDACTED***");
  redacted = redacted.replace(/github_pat_[A-Za-z0-9_]{12,}/g, "github_pat_***REDACTED***");
  redacted = redacted.replace(/AKIA[0-9A-Z]{16}/g, "AKIA***REDACTED***");
  redacted = redacted.replace(/(["']?(?:apiKey|githubToken|token|accessToken|secret|password)["']?\s*:\s*["'])[^"']+(["'])/gi, "$1***REDACTED***$2");
  return redacted;
}

function shouldFoldCodeBlock(lang: string, body: string): boolean {
  if (lang === "cancip-action") return true;
  if (["bash", "sh", "zsh", "shell", "powershell", "ps1", "cmd", "bat", "terminal", "console"].includes(lang)) return true;
  if (["ts", "tsx", "js", "jsx", "json", "html", "css", "python", "py", "diff"].includes(lang)) return true;
  if ((lang === "json" || !lang) && /^\{\s*"?(?:actions|type)"?\s*:/.test(body.trim())) return true;
  if (/^(?:\$|>|PS>|powershell|cmd|node|npm|git|gh|python|py|obsidian|cancip)\b/im.test(body.trim())) return true;
  return false;
}

function foldProcessAfterConclusion(content: string, hiddenToolBlocks: FoldedMessageBlock[]): string {
  const lines = content.split(/\r?\n/);
  const cutIndex = findProcessTailCutIndex(lines);
  if (cutIndex < 0) return content;
  const visible = lines.slice(0, cutIndex).join("\n").trim();
  const hidden = lines.slice(cutIndex).join("\n").trim();
  if (!visible || !hidden) return content;
  hiddenToolBlocks.push({ title: "process", content: hidden });
  return visible;
}

function findProcessTailCutIndex(lines: string[]): number {
  for (let index = 0; index < lines.length; index += 1) {
    if (index < 2) continue;
    const trimmed = lines[index].trim();
    if (!trimmed) continue;
    if (isProcessSectionLine(trimmed)) return index;
    if (hasConclusionCueBefore(lines, index) && looksLikeVerboseProcessLine(trimmed)) return index;
  }
  return -1;
}

function hasConclusionCueBefore(lines: string[], index: number): boolean {
  const before = lines.slice(0, index).join("\n").replace(/\s+/g, "");
  return /(?:最终结论|Finalanswer|已完成|没完成|未完成|部分完成|失败|等待确认|下一步)/i.test(before);
}

function isProcessSectionLine(trimmed: string): boolean {
  return /^(?:#{1,6}\s*)?(?:过程|执行过程|操作过程|工具过程|命令过程|过程记录|工具执行结果|执行详情|命令详情|细节|详情|步骤|检查|验证|日志|我做了这些|刚才我做了这些|本次执行|尝试过程|process|details?|steps?|commands?|logs?)[:：]?\s*$/i.test(trimmed);
}

function looksLikeVerboseProcessLine(trimmed: string): boolean {
  return /^(?:刚才我(?:做了|执行了|尝试了)这些|我(?:刚才|已经)?(?:做了|执行了|尝试了)|本次(?:执行|操作|改动|尝试)|已(?:执行|尝试|读取|修改|写入|验证)|尝试(?:修改|读取|执行)|工具执行结果|动作失败|失败步骤|失败原因|patch find text was not found|patch 修改|read |write |patch |command )[:：\s]/i.test(trimmed);
}

function foldReasoningSections(content: string, hiddenToolBlocks: FoldedMessageBlock[]): string {
  const lines = content.split(/\r?\n/);
  const kept: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!/^(?:#{1,6}\s*)?(?:思考过程|思考|推理过程|命令|执行命令|thinking|reasoning|commands?)[:：]?\s*$/i.test(trimmed)) {
      kept.push(line);
      continue;
    }

    const section: string[] = [];
    let cursor = index + 1;
    while (cursor < lines.length) {
      const next = lines[cursor];
      const nextTrimmed = next.trim();
      if (!nextTrimmed) break;
      if (/^#{1,6}\s+/.test(nextTrimmed)) break;
      section.push(next);
      cursor += 1;
    }

    if (section.length) {
      hiddenToolBlocks.push({ title: trimmed, content: `${trimmed}\n${section.join("\n").trim()}` });
      index = cursor;
      continue;
    }
    kept.push(line);
  }
  return kept.join("\n");
}

function extractChoiceOptions(content: string): ChoiceOption[] {
  const lines = content.split(/\r?\n/);
  const hasChoiceCue = lines.some((line) => /(?:下一步|建议|推荐|你可以|请选择|next step|recommended|suggest|choose|option|select|pick)/i.test(line));
  if (!hasChoiceCue) return [];

  const choices: ChoiceOption[] = [];
  let inFence = false;
  let inNextStepSection = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (/^(?:#{1,6}\s*)?(?:下一步|建议|推荐操作|推荐下一步|可选下一步|Next steps?|Recommended next steps?|Suggestions?|Options?)[:：]?\s*$/i.test(trimmed)) {
      inNextStepSection = true;
      continue;
    }
    if (inNextStepSection && /^#{1,6}\s+\S/.test(trimmed) && !/(?:下一步|建议|推荐|Next|Suggest|Option)/i.test(trimmed)) break;
    const match = trimmed.match(/^(?:(\d{1,2})[.)、]|([A-Ha-h])[.)]|[-*]\s+)\s*(.{2,160})$/);
    if (!match) continue;
    const text = match[3].trim();
    if (!text || /^(https?:|```|\{|\[)/i.test(text)) continue;
    if (/^[\w.-]+\/[\w./-]+$/.test(text)) continue;
    if (!inNextStepSection && !looksLikeNextStepChoice(text)) continue;
    const normalized = normalizeChoiceText(text);
    if (!normalized) continue;
    const prefix = match[1] ?? match[2]?.toUpperCase() ?? String(choices.length + 1);
    choices.push({ prefix, text: normalized });
  }

  const unique = new Map<string, ChoiceOption>();
  for (const choice of choices) {
    const key = choice.text.toLowerCase();
    if (!unique.has(key)) unique.set(key, choice);
  }
  return [...unique.values()].slice(0, 3);
}

function looksLikeNextStepChoice(text: string): boolean {
  if (/[`{}[\]]/.test(text)) return false;
  if (looksLikePathQuery(text)) return false;
  if (text.length > 72) return false;
  return /^(?:继续|修复|检查|重试|总结|生成|打开|查看|应用|确认|取消|导出|保存|重新|补充|执行|测试|验证|Continue|Fix|Check|Retry|Summari[sz]e|Generate|Open|Review|Apply|Confirm|Cancel|Export|Save|Run|Test|Verify)\b/i.test(text)
    || /(?:继续|修复|检查|重试|总结|生成|打开|查看|应用|确认|取消|导出|保存|重新|补充|执行|测试|验证|下一步)/.test(text);
}

function normalizeChoiceText(text: string): string {
  const cleaned = text
    .replace(/\s+/g, " ")
    .replace(/[。；;,.，]+$/g, "")
    .trim();
  if (!cleaned || cleaned.length < 2) return "";
  if (cleaned.length > 90) return "";
  return cleaned;
}

function normalizeToolRuns(raw: unknown): ToolRun[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(isRecord)
    .map((item): ToolRun | null => {
      const action = parseCancipAction(item.action);
      if (!action) return null;
      const status = isToolRunStatus(item.status) ? item.status : "pending";
      return {
        id: typeof item.id === "string" && item.id ? item.id : crypto.randomUUID(),
        action,
        summary: typeof item.summary === "string" && item.summary ? item.summary : action.type,
        status,
        createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString(),
        executedAt: typeof item.executedAt === "string" ? item.executedAt : undefined,
        result: typeof item.result === "string" ? item.result : undefined,
        error: typeof item.error === "string" ? item.error : undefined
      };
    })
    .filter((item): item is ToolRun => item !== null);
}

function isToolRunStatus(value: unknown): value is ToolRunStatus {
  return value === "pending" || value === "executing" || value === "executed" || value === "blocked" || value === "failed" || value === "rejected";
}

function formatSessionHistoryTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${month}-${day} ${hour}:${minute}`;
}

function extractCancipActions(answer: string): CancipAction[] {
  const actions: CancipAction[] = [];
  const fenceRegex = /```cancip-action\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = fenceRegex.exec(answer)) !== null) {
    actions.push(...extractCancipActionsFromJson(match[1]));
  }
  const xmlRegex = /<cancip-action\b[^>]*>([\s\S]*?)<\/cancip-action>/gi;
  while ((match = xmlRegex.exec(answer)) !== null) {
    actions.push(...extractCancipActionsFromJson(match[1]));
  }
  return actions.slice(0, 20);
}

function hasCancipActionMarker(answer: string): boolean {
  return /```cancip-action\b/i.test(answer) || /<cancip-action\b/i.test(answer);
}

function extractCancipActionsFromJson(raw: string): CancipAction[] {
  const body = raw.trim();
  if (!body) return [];
  try {
    const parsed = JSON.parse(body) as unknown;
    const candidates = isRecord(parsed) && Array.isArray(parsed.actions) ? parsed.actions : [parsed];
    return candidates
      .map((candidate) => parseCancipAction(candidate))
      .filter((action): action is CancipAction => action !== null);
  } catch {
    return [];
  }
}

function parseCancipAction(input: unknown): CancipAction | null {
  if (!isRecord(input) || typeof input.type !== "string") {
    return null;
  }

  if (input.type === "command" && typeof input.command === "string") {
    return {
      type: "command",
      command: input.command,
      args: isRecord(input.args) ? input.args : undefined
    };
  }

  if (input.type === "todo" && isTodoActionOperation(input.op)) {
    return {
      type: "todo",
      op: input.op,
      id: typeof input.id === "string" ? input.id : undefined,
      text: typeof input.text === "string" ? input.text : undefined,
      done: typeof input.done === "boolean" ? input.done : undefined,
      items: normalizeTodoActionItems(input.items)
    };
  }

  if (input.type === "automation" && isAutomationActionOperation(input.op)) {
    return {
      type: "automation",
      op: input.op,
      id: typeof input.id === "string" ? input.id : undefined,
      title: typeof input.title === "string" ? input.title : undefined,
      prompt: typeof input.prompt === "string" ? input.prompt : undefined,
      command: typeof input.command === "string" ? input.command : undefined,
      args: isRecord(input.args) ? input.args : undefined,
      schedule: isAutomationSchedule(input.schedule) ? input.schedule : undefined,
      enabled: typeof input.enabled === "boolean" ? input.enabled : undefined,
      intervalMinutes: typeof input.intervalMinutes === "number" ? input.intervalMinutes : Number.isFinite(Number.parseInt(String(input.intervalMinutes ?? ""), 10)) ? Number.parseInt(String(input.intervalMinutes), 10) : undefined,
      hour: typeof input.hour === "number" ? input.hour : Number.isFinite(Number.parseInt(String(input.hour ?? ""), 10)) ? Number.parseInt(String(input.hour), 10) : undefined
    };
  }

  if (input.type === "config") {
    const set = isRecord(input.set) ? input.set : undefined;
    const unset = Array.isArray(input.unset)
      ? input.unset.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
      : undefined;
    if (!set && !unset?.length) return null;
    return {
      type: "config",
      path: typeof input.path === "string" ? input.path : undefined,
      set,
      unset,
      replace: Boolean(input.replace)
    };
  }

  if (typeof input.path !== "string") {
    return null;
  }

  if (input.type === "read") {
    return {
      type: "read",
      path: input.path,
      query: typeof input.query === "string" ? input.query : undefined,
      occurrence: typeof input.occurrence === "number" ? input.occurrence : Number.isFinite(Number.parseInt(String(input.occurrence ?? ""), 10)) ? Number.parseInt(String(input.occurrence), 10) : undefined,
      maxChars: typeof input.maxChars === "number" ? input.maxChars : Number.isFinite(Number.parseInt(String(input.maxChars ?? ""), 10)) ? Number.parseInt(String(input.maxChars), 10) : undefined
    };
  }

  if (input.type === "write") {
    const chunks = normalizeStringChunks(input.chunks);
    if (typeof input.content !== "string" && !chunks) return null;
    return { type: "write", path: input.path, content: typeof input.content === "string" ? input.content : undefined, chunks };
  }

  if (input.type === "append") {
    const chunks = normalizeStringChunks(input.chunks);
    if (typeof input.content !== "string" && !chunks) return null;
    return { type: "append", path: input.path, content: typeof input.content === "string" ? input.content : undefined, chunks };
  }

  if (input.type === "patch" && typeof input.find === "string" && typeof input.replace === "string") {
    return {
      type: "patch",
      path: input.path,
      find: input.find,
      replace: input.replace,
      all: Boolean(input.all),
      regex: Boolean(input.regex),
      flags: typeof input.flags === "string" ? input.flags : undefined
    };
  }

  if (input.type === "mkdir") {
    return { type: "mkdir", path: input.path };
  }

  if (input.type === "rename" && typeof input.newPath === "string") {
    return { type: "rename", path: input.path, newPath: input.newPath };
  }

  if (input.type === "move" && typeof input.newPath === "string") {
    return { type: "move", path: input.path, newPath: input.newPath };
  }

  if (input.type === "copy" && typeof input.newPath === "string") {
    return { type: "copy", path: input.path, newPath: input.newPath };
  }

  if (input.type === "delete" || input.type === "remove") {
    return { type: "delete", path: input.path, permanent: Boolean(input.permanent) };
  }

  return null;
}

function isTodoActionOperation(value: unknown): value is TodoActionOperation {
  return value === "set" || value === "add" || value === "update" || value === "remove" || value === "list" || value === "clear";
}

function isAutomationActionOperation(value: unknown): value is AutomationActionOperation {
  return value === "add" || value === "update" || value === "remove" || value === "list" || value === "run";
}

function isAutomationSchedule(value: unknown): value is AutomationSchedule {
  return value === "manual" || value === "hourly" || value === "daily";
}

function normalizeTodoActionItems(raw: unknown): TodoActionItem[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw
    .filter(isRecord)
    .map((item) => ({
      id: typeof item.id === "string" ? item.id : undefined,
      text: typeof item.text === "string" ? item.text : "",
      done: typeof item.done === "boolean" ? item.done : undefined
    }))
    .filter((item) => item.text.trim());
}

function normalizeActionPath(rawPath: string): string {
  const original = rawPath;
  const trimmed = rawPath.trim().replace(/\\/g, "/");
  if (!trimmed) throw new Error(`Invalid action path: ${original}`);
  if (trimmed.startsWith("/") || trimmed.startsWith("//")) throw new Error(`Invalid action path: ${original}`);
  if (/^[a-zA-Z]:/.test(trimmed)) throw new Error(`Invalid action path: ${original}`);
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) throw new Error(`Invalid action path: ${original}`);

  const normalized = normalizePath(trimmed);
  if (!normalized || normalized === "." || normalized.startsWith("/") || normalized.startsWith("../")) {
    throw new Error(`Invalid action path: ${original}`);
  }
  if (normalized.split("/").includes("..")) throw new Error(`Invalid action path: ${original}`);
  return normalized;
}

async function ensureParentFolder(adapter: DataAdapter, path: string): Promise<void> {
  const parent = path.split("/").slice(0, -1).join("/");
  if (parent) await ensureFolder(adapter, parent);
}

async function ensureFolder(adapter: DataAdapter, folderPath: string): Promise<void> {
  const folder = normalizeActionPath(folderPath);
  const parts = folder.split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    const stat = await adapter.stat(current);
    if (stat?.type === "file") throw new Error(`Path is a file: ${current}`);
    if (!stat) await adapter.mkdir(current);
  }
}

function normalizeStringChunks(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const chunks = raw.filter((item): item is string => typeof item === "string");
  return chunks.length === raw.length && chunks.length ? chunks : undefined;
}

function textWriteActionContent(action: Extract<CancipAction, { type: "write" | "append" }>): string {
  if (Array.isArray(action.chunks)) return action.chunks.join("");
  if (typeof action.content === "string") return action.content;
  throw new Error(`${action.type} action requires content or chunks`);
}

function splitTextChunks(content: string, chunkSize: number): string[] {
  if (!content.length) return [""];
  if (content.length <= chunkSize) return [content];
  const chunks: string[] = [];
  for (let index = 0; index < content.length; index += chunkSize) {
    chunks.push(content.slice(index, index + chunkSize));
  }
  return chunks;
}

async function writeTextInChunks(adapter: DataAdapter, path: string, content: string): Promise<number> {
  const chunks = splitTextChunks(content, FILE_WRITE_CHUNK_SIZE);
  await adapter.write(path, chunks[0] ?? "");
  for (const chunk of chunks.slice(1)) {
    await adapter.append(path, chunk);
  }
  return chunks.length;
}

function makeExcerpt(content: string, tokens: string[]): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  const lower = normalized.toLowerCase();
  const firstHit = tokens
    .map((token) => lower.indexOf(token))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];
  const start = Math.max(0, (firstHit ?? 0) - 80);
  return normalized.slice(start, start + 320);
}

function trimContext(content: string, maxLength: number): string {
  const trimmed = content.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength)}\n\n...[truncated]`;
}

function stringOccurrences(content: string, query: string): number[] {
  const indexes: number[] = [];
  if (!query) return indexes;
  let cursor = 0;
  while (cursor <= content.length) {
    const index = content.indexOf(query, cursor);
    if (index < 0) break;
    indexes.push(index);
    cursor = index + Math.max(1, query.length);
  }
  return indexes;
}

function snippetAroundIndex(content: string, index: number, maxLength: number): string {
  const safeMax = Math.max(200, maxLength);
  const start = Math.max(0, index - Math.floor(safeMax / 2));
  const end = Math.min(content.length, start + safeMax);
  const prefix = start > 0 ? `...[start ${start}]\n` : "";
  const suffix = end < content.length ? `\n...[end ${end}]` : "";
  return `${prefix}${content.slice(start, end)}${suffix}`;
}

function normalizePatchRegexFlags(rawFlags: string | undefined, all: boolean): string {
  const allowed = new Set(["i", "m", "s", "u"]);
  const flags: string[] = [];
  for (const flag of String(rawFlags ?? "")) {
    if (flag === "g") continue;
    if (allowed.has(flag) && !flags.includes(flag)) flags.push(flag);
  }
  if (all) flags.push("g");
  return flags.join("");
}

function formatPatchFindFailure(path: string, current: string, find: string, regex: boolean): string {
  const hint = patchFailureHint(current, find);
  return [
    `patch ${regex ? "regex" : "find text"} was not found in ${path}.`,
    "Do not retry the same patch. First read the current file with a focused query, or use a smaller anchored patch.",
    `Suggested read action: {"type":"read","path":"${path}","query":"<short current anchor>","maxChars":8000}`,
    `file length: ${current.length}`,
    `missing ${regex ? "regex" : "find"}: ${trimContext(redactSensitiveText(find), 500)}`,
    hint ? `closest current snippet:\n${trimContext(redactSensitiveText(hint), 1200)}` : ""
  ].filter(Boolean).join("\n\n");
}

function patchFailureHint(current: string, find: string): string {
  const candidates = patchFindCandidates(find);
  for (const candidate of candidates) {
    const index = current.indexOf(candidate);
    if (index >= 0) return snippetAroundIndex(current, index, 1200);
  }
  return "";
}

function patchFindCandidates(find: string): string[] {
  const normalized = find.replace(/\s+/g, " ").trim();
  const candidates: string[] = [];
  const push = (value: string) => {
    const trimmed = value.trim();
    if (trimmed.length >= 12 && !candidates.includes(trimmed)) candidates.push(trimmed);
  };
  push(normalized.slice(0, 160));
  if (normalized.length > 220) {
    push(normalized.slice(Math.max(0, Math.floor(normalized.length / 2) - 80), Math.floor(normalized.length / 2) + 80));
    push(normalized.slice(-160));
  }
  const tokenPattern = /[A-Za-z_$][A-Za-z0-9_$]{8,}|[\u4e00-\u9fff]{4,}/g;
  let match: RegExpExecArray | null;
  while ((match = tokenPattern.exec(find)) !== null) {
    push(match[0]);
    if (candidates.length >= 8) break;
  }
  return candidates;
}

function patchRecoveryQuery(find: string): string | undefined {
  const cleaned = find
    .replace(/\\s[+*?]?/g, " ")
    .replace(/\\([/\\.^$*+?()[\]{}|])/g, "$1")
    .replace(/\(\?:/g, "(")
    .replace(/\s+/g, " ");
  const stopWords = new Set([
    "function", "return", "const", "let", "var", "this", "type", "path",
    "patch", "regex", "replace", "find", "true", "false", "string",
    "number", "object", "undefined", "null"
  ]);
  const tokenPattern = /[.#]?[A-Za-z_$][A-Za-z0-9_$-]{5,}|[\u4e00-\u9fff]{3,}/g;
  let match: RegExpExecArray | null;
  while ((match = tokenPattern.exec(cleaned)) !== null) {
    const token = match[0].trim();
    const normalized = token.replace(/^[.#]/, "").toLowerCase();
    if (stopWords.has(normalized)) continue;
    return token.slice(0, 80);
  }
  return patchFindCandidates(cleaned)[0]?.slice(0, 80);
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function parseGithubState(value: unknown): string {
  const state = typeof value === "string" ? value.trim().toLowerCase() : "";
  return state === "closed" || state === "all" ? state : "open";
}

function encodePathParts(path: string): string {
  return path
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function parseJsonFallback(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function formatGithubRepo(json: unknown): string {
  if (!isRecord(json)) return ensureDisplayText(json);
  const lines = [
    `${String(json.full_name ?? json.name ?? "repository")}`,
    `default_branch: ${String(json.default_branch ?? "")}`,
    `visibility: ${String(json.visibility ?? "")}`,
    `open_issues: ${String(json.open_issues_count ?? "")}`,
    `pushed_at: ${String(json.pushed_at ?? "")}`,
    `url: ${String(json.html_url ?? "")}`
  ];
  return lines.filter((line) => !line.endsWith(": ")).join("\n");
}

function formatGithubRateLimit(json: unknown): string {
  const resources = isRecord(json) && isRecord(json.resources) ? json.resources : {};
  const core = isRecord(resources.core) ? resources.core : isRecord(json) && isRecord(json.rate) ? json.rate : {};
  const remaining = String(core.remaining ?? "");
  const limit = String(core.limit ?? "");
  const reset = typeof core.reset === "number" ? new Date(core.reset * 1000).toISOString() : String(core.reset ?? "");
  return [`limit: ${limit}`, `remaining: ${remaining}`, `reset: ${reset}`].filter((line) => !line.endsWith(": ")).join("\n");
}

function formatGithubItems(json: unknown, kind: "issue" | "pull" | "release" | "branch"): string {
  if (!Array.isArray(json)) return ensureDisplayText(json);
  if (!json.length) return "No GitHub items.";
  return json
    .filter(isRecord)
    .map((item) => {
      if (kind === "branch") {
        const commit = isRecord(item.commit) ? String(item.commit.sha ?? "").slice(0, 12) : "";
        return `- ${String(item.name ?? "")}${commit ? ` (${commit})` : ""}`;
      }
      const number = item.number !== undefined ? `#${String(item.number)}` : "";
      const tag = typeof item.tag_name === "string" ? item.tag_name : "";
      const title = String(item.title ?? item.name ?? tag);
      const state = String(item.state ?? item.draft ?? "");
      const url = String(item.html_url ?? "");
      return `- ${number || tag} ${title}${state ? ` [${state}]` : ""}${url ? `\n  ${url}` : ""}`.trim();
    })
    .join("\n");
}

function formatSearchHitsForCommand(hits: SearchHit[]): string {
  if (!hits.length) return "No Vault Search hits.";
  return hits
    .map((hit, index) => {
      const excerpt = hit.excerpt.trim();
      const score = Number.isFinite(hit.score) ? ` score=${hit.score}` : "";
      return excerpt
        ? `${index + 1}. ${hit.path}${score}\n${excerpt}`
        : `${index + 1}. ${hit.path}${score}`;
    })
    .join("\n\n");
}

function formatGithubWorkflowRuns(json: unknown): string {
  const runs = isRecord(json) && Array.isArray(json.workflow_runs) ? json.workflow_runs : [];
  if (!runs.length) return "No workflow runs.";
  return runs
    .filter(isRecord)
    .map((run) => {
      const status = [run.status, run.conclusion].filter((item) => typeof item === "string" && item).join("/");
      return `- ${String(run.name ?? run.display_title ?? "workflow")} ${status ? `[${status}]` : ""}\n  ${String(run.html_url ?? "")}`.trim();
    })
    .join("\n");
}

function formatGithubFile(json: unknown): string {
  if (Array.isArray(json)) {
    return json
      .filter(isRecord)
      .map((item) => `- ${String(item.type ?? "file")} ${String(item.path ?? item.name ?? "")}`)
      .join("\n") || "Empty directory.";
  }
  if (!isRecord(json)) return ensureDisplayText(json);
  const path = String(json.path ?? json.name ?? "");
  const size = String(json.size ?? "");
  const encoding = String(json.encoding ?? "");
  const content = typeof json.content === "string" && encoding === "base64" ? decodeBase64Text(json.content) : "";
  const header = `${path}${size ? ` (${size} bytes)` : ""}`;
  return content ? `${header}\n\n${trimContext(content, 6000)}` : `${header}\n${String(json.html_url ?? "")}`.trim();
}

function formatGithubCreatedIssue(json: unknown): string {
  if (!isRecord(json)) return ensureDisplayText(json);
  return `Created issue #${String(json.number ?? "")}: ${String(json.title ?? "")}\n${String(json.html_url ?? "")}`.trim();
}

function decodeBase64Text(input: string): string {
  const compact = input.replace(/\s+/g, "");
  try {
    if (typeof window !== "undefined" && typeof window.atob === "function") {
      return decodeURIComponent(
        Array.from(window.atob(compact))
          .map((char) => `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`)
          .join("")
      );
    }
  } catch {
    return "";
  }
  return "";
}

function normalizeApiUrl(rawUrl: string): { chatUrl: string; responsesUrl: string; explicit: ApiMode | null } {
  const trimmed = rawUrl.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) {
    return {
      chatUrl: trimmed,
      responsesUrl: trimmed.replace(/\/chat\/completions$/, "/responses"),
      explicit: "compatible"
    };
  }
  if (trimmed.endsWith("/responses")) {
    return {
      chatUrl: trimmed.replace(/\/responses$/, "/chat/completions"),
      responsesUrl: trimmed,
      explicit: "responses"
    };
  }
  return {
    chatUrl: `${trimmed}/chat/completions`,
    responsesUrl: `${trimmed}/responses`,
    explicit: null
  };
}

function resolveApiMode(setting: ApiMode, endpoint: { explicit: ApiMode | null }): ApiMode {
  if (setting !== "auto") return setting;
  return endpoint.explicit ?? "auto";
}

function extractResponseText(json: unknown): string {
  if (!isRecord(json)) return extractTextFragment(json);

  const outputText = extractTextFragment(json.output_text);
  if (outputText) return outputText;

  const choicesText = extractChoicesText(json.choices);
  if (choicesText) return choicesText;

  const responsesText = extractResponsesOutputText(json.output);
  if (responsesText) return responsesText;

  const directText = extractTextFragment(json.text);
  if (directText) return directText;

  return extractTextFragment(json.content);
}

function extractNonJsonText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return "";
  return trimmed;
}

function describeResponseShape(json: unknown): string {
  if (!isRecord(json)) return `type=${typeof json}`;
  const fields: string[] = [];
  if (typeof json.status === "string") fields.push(`status=${json.status}`);
  if (typeof json.model === "string") fields.push(`model=${json.model}`);
  if (Array.isArray(json.output)) fields.push(`output=${json.output.length}`);
  if (Array.isArray(json.choices)) fields.push(`choices=${json.choices.length}`);
  if (typeof json.output_text === "string") fields.push(`output_text=${json.output_text.length}`);
  if (isRecord(json.usage)) fields.push("usage=present");
  const keys = Object.keys(json).slice(0, 8).join(",");
  fields.push(`keys=${keys || "none"}`);
  return fields.join(", ");
}

function extractChoicesText(choices: unknown): string {
  if (!Array.isArray(choices)) return "";
  return choices
    .map((choice) => {
      if (!isRecord(choice)) return extractTextFragment(choice);
      if (isRecord(choice.message)) {
        return extractTextFragment(choice.message.content) || extractTextFragment(choice.message.text);
      }
      return extractTextFragment(choice.text) || extractTextFragment(choice.content) || extractTextFragment(choice.delta);
    })
    .filter(Boolean)
    .join("\n");
}

function extractResponsesOutputText(output: unknown): string {
  if (!Array.isArray(output)) return extractTextFragment(output);
  return output
    .map((item) => {
      if (!isRecord(item)) return extractTextFragment(item);
      return (
        extractTextFragment(item.content) ||
        extractTextFragment(item.text) ||
        extractTextFragment(item.message)
      );
    })
    .filter(Boolean)
    .join("\n");
}

function extractTextFragment(value: unknown, depth = 0): string {
  if (depth > 8 || value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return "";
  if (Array.isArray(value)) {
    return value
      .map((item) => extractTextFragment(item, depth + 1))
      .filter(Boolean)
      .join("\n");
  }
  if (!isRecord(value)) return "";

  return (
    extractTextFragment(value.text, depth + 1) ||
    extractTextFragment(value.output_text, depth + 1) ||
    extractTextFragment(value.content, depth + 1) ||
    extractTextFragment(value.parts, depth + 1) ||
    extractTextFragment(value.message, depth + 1) ||
    extractTextFragment(value.delta, depth + 1) ||
    extractTextFragment(value.value, depth + 1)
  );
}

function ensureDisplayText(value: unknown): string {
  const text = extractTextFragment(value);
  if (text) return text;
  if (typeof value === "string") return value;
  try {
    const json = JSON.stringify(value, null, 2);
    if (json) return json;
  } catch {
    // Fall through to String().
  }
  return String(value ?? "");
}












