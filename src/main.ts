import {
  App,
  type DataAdapter,
  Editor,
  ItemView,
  MarkdownView,
  Notice,
  normalizePath,
  Plugin,
  PluginSettingTab,
  requestUrl,
  Setting,
  setIcon,
  TFile,
  WorkspaceLeaf
} from "obsidian";

import { DEFAULT_SYSTEM_PROMPT, LEGACY_SYSTEM_PROMPT, PLUGIN_NAME, VIEW_TYPE } from "./constants";

type ChatRole = "system" | "user" | "assistant";

type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: number;
  sources?: SearchHit[];
};

type ComposerMode = "ask" | "search" | "plan" | "edit";
type ApiMode = "auto" | "compatible" | "responses";
type LanguageMode = "auto" | "zh" | "en";
type Language = Exclude<LanguageMode, "auto">;
type AccessMode = "ask-for-approval" | "full-access";

type SearchHit = {
  path: string;
  title: string;
  excerpt: string;
  score: number;
};

type CancipAction =
  | { type: "read"; path: string }
  | { type: "write"; path: string; content: string }
  | { type: "append"; path: string; content: string }
  | { type: "mkdir"; path: string }
  | { type: "rename"; path: string; newPath: string }
  | { type: "copy"; path: string; newPath: string };

type Settings = {
  language: LanguageMode;
  accessMode: AccessMode;
  apiUrl: string;
  apiKey: string;
  apiMode: ApiMode;
  model: string;
  temperature: number;
  maxOutputTokens: number;
  maxContextFiles: number;
  memoryFolder: string;
  includeCurrentFile: boolean;
  includeCoreMemory: boolean;
  useVaultSearchByDefault: boolean;
  systemPrompt: string;
};

const DEFAULT_SETTINGS: Settings = {
  language: "auto",
  accessMode: "ask-for-approval",
  apiUrl: "https://api.openai.com/v1",
  apiKey: "",
  apiMode: "auto",
  model: "gpt-4.1-mini",
  temperature: 0.2,
  maxOutputTokens: 2048,
  maxContextFiles: 6,
  memoryFolder: "AI/Memory",
  includeCurrentFile: true,
  includeCoreMemory: true,
  useVaultSearchByDefault: true,
  systemPrompt: DEFAULT_SYSTEM_PROMPT
};

const CANCIP_CONFIG_DIR = ".cancip";
const CANCIP_CONFIG_PATH = `${CANCIP_CONFIG_DIR}/config.json`;
const CANCIP_CONFIG_SCHEMA_VERSION = 1;

const EN = {
  openCancip: "Open Cancip",
  commandOpenChat: "Open chat",
  commandNewChat: "New chat",
  commandAddSelection: "Add selection to chat",
  commandRebuildIndex: "Rebuild light index",
  noSelection: "No selection to add",
  newChatStatus: "New chat",
  contextAdded: "Context added: {label}",
  indexedStatus: "{count} Markdown files indexed",
  indexedNotice: "Cancip indexed {count} files",
  agentKicker: "agent",
  newChatTitle: "New chat",
  modeAsk: "Ask",
  modeSearch: "Search",
  modePlan: "Plan",
  modeEdit: "Edit",
  context: "context",
  clearContext: "Clear context",
  contextCleared: "Context cleared",
  addCurrentFile: "Add current file",
  previewVaultSearch: "Preview Vault Search",
  addCoreMemory: "Add core memory",
  stop: "Stop",
  send: "Send",
  placeholder: "Ask OB: @file, summarize, find notes, make a plan, suggest edits...",
  ready: "Ready",
  missingApi: "API URL/key/model is not configured.",
  generating: "Generating...",
  done: "Done",
  callFailed: "Call failed",
  stopped: "Stopped",
  localNoHits: "Model is not connected: {reason}\n\nLocal Vault Search did not find related notes. Configure API URL/key/model, or use clearer keywords.",
  localHits: "Model is not connected: {reason}\n\nHere are local Vault Search results for now.\n\nQuestion: {prompt}\n\n{list}",
  recentConversation: "Recent conversation",
  userQuestion: "User question",
  obsidianContext: "Obsidian context",
  none: "None",
  coreMemory: "Core memory",
  currentFile: "Current file",
  vaultSearch: "Vault Search",
  noActiveFile: "No active file",
  noCoreMemory: "No core memory files found",
  searchFirst: "Type a search question first",
  hitCount: "{count} hits",
  emptyContext: "No context",
  sourceAdded: "Added to context",
  modePromptSearch: "Current mode: Search. List matched note paths first, then answer.",
  modePromptPlan: "Current mode: Plan. Output an executable plan, risks, and actions needing user confirmation. Do not claim you have executed anything.",
  modePromptEdit: "Current mode: Edit. Provide copyable patches or Markdown edit suggestions. If a Vault write is needed, ask for confirmation first.",
  modePromptAsk: "Current mode: Ask. Answer directly and cite source paths when useful.",
  settingsLanguage: "Language",
  settingsLanguageDesc: "Auto follows the device language.",
  languageAuto: "Auto",
  languageZh: "中文",
  languageEn: "English",
  settingsApiUrl: "API URL",
  settingsApiUrlDesc: "Base URL or endpoint. Auto supports /responses and /chat/completions.",
  settingsAccessMode: "Access mode",
  settingsAccessModeDesc: "Controls whether write-like actions require approval.",
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
  advancedSettings: "Advanced settings",
  configAuthority: "Config file: .cancip/config.json. It wins over settings on restart.",
  settingsTemperature: "Temperature",
  settingsMaxOutputTokens: "Max output tokens",
  settingsCoreMemoryFolder: "Core memory folder",
  settingsCoreMemoryFolderDesc: "Markdown files under this folder are included as core memory.",
  settingsMaxContextFiles: "Max context files",
  settingsIncludeCurrentFile: "Include current file",
  settingsIncludeCoreMemory: "Include core memory",
  settingsUseVaultSearch: "Use Vault Search by default",
  settingsSystemPrompt: "System prompt",
  settingsSystemPromptDesc: "Applied to every chat.",
  selectionFrom: "Selection from {path}",
  currentFileLabel: "Current file {path}",
  score: "score {score}",
  accessPromptAsk: "Access mode: Ask for approval. Read context freely, but before any write, delete, move, rename, merge, or config change, ask the user for approval and do not claim execution.",
  accessPromptFull: "Access mode: Full access. The user allows Cancip tool actions to read and write the whole vault, including .cancip config, when those actions are implemented. Preserve data, keep changes auditable, and report concrete paths changed.",
  configWriteFailed: "Could not write .cancip/config.json: {reason}",
  configReadFailed: "Could not read .cancip/config.json: {reason}",
  toolProtocol: "Tool protocol: If an action is needed, output exactly one fenced block named cancip-action containing JSON like {\"actions\":[{\"type\":\"write\",\"path\":\"Folder/Note.md\",\"content\":\"...\"}]}. Supported action types: read, write, append, mkdir, rename, copy. Use Vault-relative paths only.",
  actionsNeedApproval: "Action block detected. Access mode is Ask for approval, so nothing was executed.\n\n{summary}",
  actionsExecuted: "Executed actions:\n\n{summary}",
  actionFailed: "Action failed: {reason}",
  actionRead: "read {path}\n{content}",
  actionWrite: "write {path}",
  actionAppend: "append {path}",
  actionMkdir: "mkdir {path}",
  actionRename: "rename {path} -> {newPath}",
  actionCopy: "copy {path} -> {newPath}",
  invalidActionPath: "Invalid action path: {path}",
  noActions: "No valid actions found."
} as const;

type I18nKey = keyof typeof EN;

const I18N: Record<Language, Record<I18nKey, string>> = {
  en: EN,
  zh: {
    openCancip: "打开 Cancip",
    commandOpenChat: "打开聊天",
    commandNewChat: "新对话",
    commandAddSelection: "把选中文本加入聊天",
    commandRebuildIndex: "重建轻量索引",
    noSelection: "没有可加入的选中文本",
    newChatStatus: "新对话",
    contextAdded: "已加入上下文：{label}",
    indexedStatus: "{count} 个 Markdown 文件可检索",
    indexedNotice: "Cancip 已索引 {count} 个文件",
    agentKicker: "agent",
    newChatTitle: "新对话",
    modeAsk: "问",
    modeSearch: "搜",
    modePlan: "计划",
    modeEdit: "改",
    context: "上下文",
    clearContext: "清空上下文",
    contextCleared: "上下文已清空",
    addCurrentFile: "加入当前文件",
    previewVaultSearch: "预览 Vault Search",
    addCoreMemory: "加入核心记忆",
    stop: "停止",
    send: "发送",
    placeholder: "问 OB：@文件名、总结、找笔记、生成计划、给当前笔记改法...",
    ready: "准备就绪",
    missingApi: "还没有配置 API URL/key/model。",
    generating: "模型生成中...",
    done: "完成",
    callFailed: "调用失败",
    stopped: "已停止",
    localNoHits: "模型未连接成功：{reason}\n\n本地也没有检索到相关笔记。你可以先在设置里填 API URL/key/model，或换更明确的关键词。",
    localHits: "模型未连接成功：{reason}\n\n先给本地 Vault Search 结果，供你继续判断。\n\n问题：{prompt}\n\n{list}",
    recentConversation: "最近对话",
    userQuestion: "用户问题",
    obsidianContext: "Obsidian 上下文",
    none: "无",
    coreMemory: "核心记忆",
    currentFile: "当前文件",
    vaultSearch: "Vault Search",
    noActiveFile: "没有当前文件",
    noCoreMemory: "没有找到核心记忆文件",
    searchFirst: "先输入要搜索的问题",
    hitCount: "命中 {count} 条",
    emptyContext: "暂无上下文",
    sourceAdded: "已加入上下文",
    modePromptSearch: "当前模式：Search。先列出命中的笔记路径，再回答。",
    modePromptPlan: "当前模式：Plan。输出可执行计划、风险和需要用户确认的动作，不要直接声称已执行。",
    modePromptEdit: "当前模式：Edit。给出可复制补丁/Markdown 修改建议；若要写入 Vault，必须先要求确认。",
    modePromptAsk: "当前模式：Ask。直接回答，必要时引用来源路径。",
    settingsLanguage: "语言",
    settingsLanguageDesc: "自动会跟随设备语言。",
    languageAuto: "自动",
    languageZh: "中文",
    languageEn: "English",
    settingsApiUrl: "API URL",
    settingsApiUrlDesc: "Base URL 或 endpoint。自动支持 /responses 和 /chat/completions。",
    settingsAccessMode: "访问模式",
    settingsAccessModeDesc: "控制写入类动作是否需要先确认。",
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
    advancedSettings: "高级设置",
    configAuthority: "配置文件：.cancip/config.json。重启后以该文件为准。",
    settingsTemperature: "Temperature",
    settingsMaxOutputTokens: "最大输出 tokens",
    settingsCoreMemoryFolder: "核心记忆文件夹",
    settingsCoreMemoryFolderDesc: "该文件夹下的 Markdown 会作为核心记忆加入上下文。",
    settingsMaxContextFiles: "最大上下文文件数",
    settingsIncludeCurrentFile: "包含当前文件",
    settingsIncludeCoreMemory: "包含核心记忆",
    settingsUseVaultSearch: "默认使用 Vault Search",
    settingsSystemPrompt: "系统提示词",
    settingsSystemPromptDesc: "每次聊天都会应用。",
    selectionFrom: "选中文本：{path}",
    currentFileLabel: "当前文件 {path}",
    score: "score {score}",
    accessPromptAsk: "访问模式：Ask for approval。可以自由读取上下文，但任何写入、删除、移动、重命名、合并或配置变更前必须先请求用户确认，不要声称已执行。",
    accessPromptFull: "访问模式：Full access。用户允许 Cancip 工具动作读写整个 Vault，包括 .cancip 配置；前提是对应工具动作已实现。必须保护数据、保持可审计，并报告实际改动路径。",
    configWriteFailed: "无法写入 .cancip/config.json：{reason}",
    configReadFailed: "无法读取 .cancip/config.json：{reason}",
    toolProtocol: "工具协议：如果需要执行动作，只输出一个名为 cancip-action 的 fenced block，JSON 形如 {\"actions\":[{\"type\":\"write\",\"path\":\"Folder/Note.md\",\"content\":\"...\"}]}。支持动作：read、write、append、mkdir、rename、copy。只能使用 Vault 相对路径。",
    actionsNeedApproval: "检测到动作块。当前是 Ask for approval 模式，所以没有执行。\n\n{summary}",
    actionsExecuted: "已执行动作：\n\n{summary}",
    actionFailed: "动作失败：{reason}",
    actionRead: "read {path}\n{content}",
    actionWrite: "write {path}",
    actionAppend: "append {path}",
    actionMkdir: "mkdir {path}",
    actionRename: "rename {path} -> {newPath}",
    actionCopy: "copy {path} -> {newPath}",
    invalidActionPath: "非法动作路径：{path}",
    noActions: "没有找到有效动作。"
  }
};

export default class CancipPlugin extends Plugin {
  settings: Settings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    await this.loadSettings();

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
        view?.newChat();
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
        chatView?.addDraftContext(this.t("selectionFrom", { path: file.path }), selected);
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

    this.addSettingTab(new CancipSettingTab(this.app, this));
  }

  onunload(): void {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
  }

  async loadSettings(): Promise<void> {
    const saved = (await this.loadData()) as Partial<Settings> | null;
    let nextSettings = normalizeSettings({ ...DEFAULT_SETTINGS, ...saved });
    if (!saved?.systemPrompt || saved.systemPrompt === LEGACY_SYSTEM_PROMPT) {
      nextSettings.systemPrompt = DEFAULT_SYSTEM_PROMPT;
    }

    const configSettings = await this.loadCancipConfig();
    if (configSettings) {
      nextSettings = normalizeSettings({ ...nextSettings, ...configSettings });
    }

    if (!nextSettings.systemPrompt || nextSettings.systemPrompt === LEGACY_SYSTEM_PROMPT) {
      nextSettings.systemPrompt = DEFAULT_SYSTEM_PROMPT;
    }

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

  async saveSettings(): Promise<void> {
    this.settings = normalizeSettings(this.settings);
    if (!this.settings.systemPrompt || this.settings.systemPrompt === LEGACY_SYSTEM_PROMPT) {
      this.settings.systemPrompt = DEFAULT_SYSTEM_PROMPT;
    }
    await this.saveData(this.settings);
    await this.writeCancipConfig();
  }

  language(): Language {
    return resolveLanguage(this.settings.language);
  }

  t(key: I18nKey, vars?: Record<string, string | number>): string {
    return formatI18n(I18N[this.language()][key], vars);
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
  private messages: ChatMessage[] = [];
  private mode: ComposerMode = "ask";
  private vaultIndex: SearchHit[] = [];
  private draftContext: { label: string; content: string }[] = [];
  private messagesEl!: HTMLElement;
  private sourcesEl!: HTMLElement;
  private inputEl!: HTMLTextAreaElement;
  private statusEl!: HTMLElement;
  private modeButtons: Record<ComposerMode, HTMLButtonElement> | null = null;
  private activeRequest: AbortController | null = null;

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
    await this.refreshVaultIndex(false);
  }

  async onClose(): Promise<void> {
    this.activeRequest?.abort();
  }

  newChat(): void {
    this.activeRequest?.abort();
    this.messages = [];
    this.draftContext = [];
    this.renderMessages();
    this.renderSources([]);
    this.setStatus(this.t("newChatStatus"));
    this.focusInput();
  }

  addDraftContext(label: string, content: string): void {
    this.draftContext.push({ label, content });
    this.setStatus(this.t("contextAdded", { label }));
    this.focusInput();
  }

  async refreshVaultIndex(forceNotice: boolean): Promise<void> {
    const files = this.app.vault.getMarkdownFiles();
    const hits: SearchHit[] = [];
    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      const title = cache?.frontmatter?.title as string | undefined;
      hits.push({
        path: file.path,
        title: title || file.basename,
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

    const shell = root.createDiv({ cls: "obcc-shell" });

    const header = shell.createDiv({ cls: "obcc-header" });
    const titleWrap = header.createDiv();
    titleWrap.createEl("div", { cls: "obcc-kicker", text: this.t("agentKicker") });
    titleWrap.createEl("h2", { text: "Cancip" });
    const newButton = header.createEl("button", {
      cls: "obcc-icon-button",
      attr: { "aria-label": this.t("newChatTitle"), title: this.t("newChatTitle") }
    });
    setIcon(newButton, "plus");
    newButton.addEventListener("click", () => this.newChat());

    const modeBar = shell.createDiv({ cls: "obcc-modebar" });
    this.modeButtons = {
      ask: this.createModeButton(modeBar, "ask", "message-square", this.t("modeAsk")),
      search: this.createModeButton(modeBar, "search", "search", this.t("modeSearch")),
      plan: this.createModeButton(modeBar, "plan", "list-todo", this.t("modePlan")),
      edit: this.createModeButton(modeBar, "edit", "square-pen", this.t("modeEdit"))
    };
    this.syncModeButtons();

    this.messagesEl = shell.createDiv({ cls: "obcc-messages" });

    const sourcesPanel = shell.createDiv({ cls: "obcc-sources" });
    const sourcesHead = sourcesPanel.createDiv({ cls: "obcc-sources-head" });
    sourcesHead.createSpan({ text: this.t("context") });
    const clearContext = sourcesHead.createEl("button", { text: "×", cls: "obcc-link-button", attr: { title: this.t("clearContext"), "aria-label": this.t("clearContext") } });
    clearContext.addEventListener("click", () => {
      this.draftContext = [];
      this.renderSources([]);
      this.setStatus(this.t("contextCleared"));
    });
    this.sourcesEl = sourcesPanel.createDiv({ cls: "obcc-source-list" });

    const footer = shell.createDiv({ cls: "obcc-footer" });
    const quickRow = footer.createDiv({ cls: "obcc-quick-row" });
    this.createQuickButton(quickRow, "file-plus-2", this.t("addCurrentFile"), () => void this.addCurrentFileContext());
    this.createQuickButton(quickRow, "folder-search", this.t("previewVaultSearch"), () => void this.previewVaultSearch());
    this.createQuickButton(quickRow, "brain-circuit", this.t("addCoreMemory"), () => void this.addMemoryContext());
    this.createQuickButton(quickRow, "square", this.t("stop"), () => this.stopRequest());

    const form = footer.createEl("form", { cls: "obcc-composer" });
    this.inputEl = form.createEl("textarea", {
      attr: {
        rows: "1",
        placeholder: this.t("placeholder")
      }
    });
    const sendButton = form.createEl("button", {
      cls: "obcc-send",
      attr: { type: "submit", title: this.t("send"), "aria-label": this.t("send") }
    });
    setIcon(sendButton, "corner-down-left");

    this.inputEl.addEventListener("input", () => this.resizeInput());
    this.inputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        form.requestSubmit();
      }
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.submit();
    });

    this.statusEl = shell.createDiv({ cls: "obcc-status" });
    this.setStatus(this.t("ready"));
    this.renderMessages();
    this.renderSources([]);
  }

  private createModeButton(parent: HTMLElement, mode: ComposerMode, icon: string, label: string): HTMLButtonElement {
    const button = parent.createEl("button", {
      cls: "obcc-mode",
      attr: { title: label, "aria-label": label }
    });
    setIcon(button, icon);
    button.addEventListener("click", () => {
      this.mode = mode;
      this.syncModeButtons();
      this.focusInput();
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

  private resizeInput(): void {
    this.inputEl.style.height = "auto";
    this.inputEl.style.height = `${Math.min(this.inputEl.scrollHeight, 150)}px`;
  }

  private focusInput(): void {
    window.setTimeout(() => this.inputEl?.focus(), 20);
  }

  private async submit(): Promise<void> {
    const rawPrompt = this.inputEl.value.trim();
    if (!rawPrompt) return;
    this.inputEl.value = "";
    this.resizeInput();

    const userMessage = this.addMessage("user", rawPrompt);
    this.renderMessages();

    const context = await this.buildContext(rawPrompt);
    userMessage.sources = context.searchHits;
    this.renderSources(context.searchHits);

    if (!this.plugin.settings.apiUrl || !this.plugin.settings.apiKey || !this.plugin.settings.model) {
      this.addMessage(
        "assistant",
        this.localFallback(rawPrompt, context.searchHits, this.t("missingApi"))
      );
      this.renderMessages();
      return;
    }

    this.setStatus(this.t("generating"));
    const request = new AbortController();
    this.activeRequest = request;
    try {
      const answer = await this.callModel(rawPrompt, context);
      if (request.signal.aborted || this.activeRequest !== request) return;
      this.addMessage("assistant", answer);
      const actionReport = await this.handleActionBlocks(answer);
      if (actionReport) this.addMessage("assistant", actionReport);
      this.setStatus(this.t("done"));
    } catch (error) {
      if (request.signal.aborted || this.activeRequest !== request) {
        this.setStatus(this.t("stopped"));
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.addMessage("assistant", this.localFallback(rawPrompt, context.searchHits, message));
      this.setStatus(this.t("callFailed"));
    } finally {
      if (this.activeRequest === request) this.activeRequest = null;
      this.renderMessages();
    }
  }

  private addMessage(role: ChatRole, content: unknown): ChatMessage {
    const message = {
      id: crypto.randomUUID(),
      role,
      content: ensureDisplayText(content),
      createdAt: Date.now()
    };
    this.messages.push(message);
    return message;
  }

  private async buildContext(prompt: string): Promise<{
    system: string;
    contextText: string;
    searchHits: SearchHit[];
  }> {
    const parts: string[] = [];
    const searchHits: SearchHit[] = [];
    const settings = this.plugin.settings;

    if (settings.includeCoreMemory) {
      const memory = await this.readMemoryFolder();
      if (memory) parts.push(`## ${this.t("coreMemory")}\n${memory}`);
    }

    if (settings.includeCurrentFile) {
      const current = await this.getCurrentFileContext();
      if (current) parts.push(`## ${this.t("currentFile")}\n${current}`);
    }

    for (const item of this.draftContext) {
      parts.push(`## ${item.label}\n${item.content}`);
    }

    const mentionFiles = this.findMentionedFiles(prompt);
    for (const file of mentionFiles) {
      const content = await this.app.vault.cachedRead(file);
      parts.push(`## @${file.path}\n${trimContext(content, 8000)}`);
    }

    if (settings.useVaultSearchByDefault || this.mode === "search") {
      const hits = await this.searchVault(prompt, settings.maxContextFiles);
      searchHits.push(...hits);
      if (hits.length) {
        parts.push(
          `## ${this.t("vaultSearch")}\n${hits
            .map((hit, index) => `[${index + 1}] ${hit.path}\n${hit.excerpt}`)
            .join("\n\n")}`
        );
      }
    }

    return {
      system: this.modePrompt(),
      contextText: parts.join("\n\n---\n\n"),
      searchHits
    };
  }

  private modePrompt(): string {
    const base = this.plugin.settings.systemPrompt || DEFAULT_SYSTEM_PROMPT;
    const accessPrompt = this.plugin.settings.accessMode === "full-access" ? this.t("accessPromptFull") : this.t("accessPromptAsk");
    if (this.mode === "search") return `${base}\n\n${accessPrompt}\n\n${this.t("toolProtocol")}\n\n${this.t("modePromptSearch")}`;
    if (this.mode === "plan") return `${base}\n\n${accessPrompt}\n\n${this.t("toolProtocol")}\n\n${this.t("modePromptPlan")}`;
    if (this.mode === "edit") return `${base}\n\n${accessPrompt}\n\n${this.t("toolProtocol")}\n\n${this.t("modePromptEdit")}`;
    return `${base}\n\n${accessPrompt}\n\n${this.t("toolProtocol")}\n\n${this.t("modePromptAsk")}`;
  }

  private async callModel(prompt: string, context: { system: string; contextText: string }): Promise<string> {
    const settings = this.plugin.settings;
    const recent = this.recentTranscript();
    const inputText = `${recent ? `${this.t("recentConversation")}:\n${recent}\n\n` : ""}${this.t("userQuestion")}：${prompt}\n\n${this.t("obsidianContext")}：\n${context.contextText || this.t("none")}`;
    const endpoint = normalizeApiUrl(settings.apiUrl);
    const mode = resolveApiMode(settings.apiMode, endpoint);

    if (mode === "responses") {
      return await this.callResponsesApi(endpoint.responsesUrl, context.system, inputText);
    }

    if (mode === "compatible") {
      return await this.callCompatibleApi(endpoint.chatUrl, context.system, inputText);
    }

    try {
      return await this.callResponsesApi(endpoint.responsesUrl, context.system, inputText);
    } catch (error) {
      const firstError = error instanceof Error ? error.message : String(error);
      try {
        return await this.callCompatibleApi(endpoint.chatUrl, context.system, inputText);
      } catch (secondError) {
        const second = secondError instanceof Error ? secondError.message : String(secondError);
        throw new Error(`Responses failed: ${firstError}; compatible failed: ${second}`);
      }
    }
  }

  private async callCompatibleApi(url: string, system: string, inputText: string): Promise<string> {
    const settings = this.plugin.settings;
    const body = {
      model: settings.model,
      temperature: settings.temperature,
      max_tokens: settings.maxOutputTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: inputText }
      ]
    };
    const response = await this.postJson(url, body);
    const text = extractResponseText(response.json) || extractNonJsonText(response.text);
    if (text) return text;
    throw new Error(`Chat Completions returned no assistant text (${describeResponseShape(response.json)})`);
  }

  private async callResponsesApi(url: string, instructions: string, inputText: string): Promise<string> {
    const settings = this.plugin.settings;
    const body = {
      model: settings.model,
      instructions,
      input: inputText,
      temperature: settings.temperature,
      max_output_tokens: settings.maxOutputTokens
    };
    const response = await this.postJson(url, body);
    const text = extractResponseText(response.json) || extractNonJsonText(response.text);
    if (text) return text;
    throw new Error(`Responses returned no assistant text (${describeResponseShape(response.json)})`);
  }

  private async postJson(url: string, body: unknown): Promise<{ status: number; text: string; json: unknown }> {
    const response = await requestUrl({
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.plugin.settings.apiKey}`
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
    if (!hits.length) {
      return this.t("localNoHits", { reason });
    }
    const list = hits
      .slice(0, 5)
      .map((hit, index) => `${index + 1}. ${hit.path}\n${hit.excerpt}`)
      .join("\n\n");
    return this.t("localHits", { reason, prompt, list });
  }

  private async getCurrentFileContext(): Promise<string | null> {
    const file = this.app.workspace.getActiveFile();
    if (!file) return null;
    const content = await this.app.vault.cachedRead(file);
    return `${file.path}\n${trimContext(content, 10000)}`;
  }

  private async addCurrentFileContext(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new Notice(this.t("noActiveFile"));
      return;
    }
    const content = await this.app.vault.cachedRead(file);
    this.addDraftContext(this.t("currentFileLabel", { path: file.path }), trimContext(content, 10000));
  }

  private async addMemoryContext(): Promise<void> {
    const memory = await this.readMemoryFolder();
    if (!memory) {
      new Notice(this.t("noCoreMemory"));
      return;
    }
    this.addDraftContext(this.t("coreMemory"), memory);
  }

  private async readMemoryFolder(): Promise<string> {
    const folder = this.plugin.settings.memoryFolder.trim();
    if (!folder) return "";
    const files = this.app.vault
      .getMarkdownFiles()
      .filter((file) => file.path.startsWith(folder.endsWith("/") ? folder : `${folder}/`))
      .slice(0, 12);
    const chunks: string[] = [];
    for (const file of files) {
      const content = await this.app.vault.cachedRead(file);
      chunks.push(`### ${file.path}\n${trimContext(content, 3000)}`);
    }
    return chunks.join("\n\n");
  }

  private findMentionedFiles(prompt: string): TFile[] {
    const mentions = [...prompt.matchAll(/@([^\s@#|，。；,;]+)/g)].map((match) => match[1].toLowerCase());
    if (!mentions.length) return [];
    const files = this.app.vault.getMarkdownFiles();
    return mentions
      .map((mention) => {
        return files.find((file) => {
          const base = file.basename.toLowerCase();
          const path = file.path.toLowerCase();
          return base.includes(mention) || path.includes(mention);
        });
      })
      .filter((file): file is TFile => Boolean(file))
      .slice(0, 8);
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
    const files = this.app.vault.getMarkdownFiles();
    const results: SearchHit[] = [];
    for (const file of files) {
      const content = await this.app.vault.cachedRead(file);
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

  private async handleActionBlocks(answer: string): Promise<string | null> {
    const actions = extractCancipActions(answer);
    if (!actions.length) return null;

    const summary = actions.map((action) => this.describeAction(action)).join("\n");
    if (this.plugin.settings.accessMode !== "full-access") {
      return this.t("actionsNeedApproval", { summary });
    }

    const results: string[] = [];
    for (const action of actions) {
      try {
        results.push(await this.executeAction(action));
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        results.push(this.t("actionFailed", { reason }));
      }
    }
    return this.t("actionsExecuted", { summary: results.join("\n\n") });
  }

  private async executeAction(action: CancipAction): Promise<string> {
    const adapter = this.app.vault.adapter;
    const path = normalizeActionPath(action.path);

    if (action.type === "read") {
      const content = await adapter.read(path);
      return this.t("actionRead", { path, content: trimContext(content, 2000) });
    }

    if (action.type === "write") {
      await ensureParentFolder(adapter, path);
      await adapter.write(path, action.content);
      return this.t("actionWrite", { path });
    }

    if (action.type === "append") {
      await ensureParentFolder(adapter, path);
      await adapter.append(path, action.content);
      return this.t("actionAppend", { path });
    }

    if (action.type === "mkdir") {
      await ensureFolder(adapter, path);
      return this.t("actionMkdir", { path });
    }

    if (action.type === "rename") {
      const newPath = normalizeActionPath(action.newPath);
      await ensureParentFolder(adapter, newPath);
      await adapter.rename(path, newPath);
      return this.t("actionRename", { path, newPath });
    }

    const newPath = normalizeActionPath(action.newPath);
    await ensureParentFolder(adapter, newPath);
    await adapter.copy(path, newPath);
    return this.t("actionCopy", { path, newPath });
  }

  private describeAction(action: CancipAction): string {
    const path = action.path;
    if (action.type === "read") return this.t("actionRead", { path, content: "" }).trim();
    if (action.type === "write") return this.t("actionWrite", { path });
    if (action.type === "append") return this.t("actionAppend", { path });
    if (action.type === "mkdir") return this.t("actionMkdir", { path });
    if (action.type === "rename") return this.t("actionRename", { path, newPath: action.newPath });
    return this.t("actionCopy", { path, newPath: action.newPath });
  }

  private stopRequest(): void {
    this.activeRequest?.abort();
    this.activeRequest = null;
    this.setStatus(this.t("stopped"));
  }

  private recentTranscript(): string {
    return this.messages
      .slice(-9, -1)
      .map((message) => `${message.role}: ${trimContext(message.content, 1800)}`)
      .join("\n\n");
  }

  private renderMessages(): void {
    this.messagesEl.empty();
    if (!this.messages.length) {
      const empty = this.messagesEl.createDiv({ cls: "obcc-empty" });
      empty.createEl("strong", { text: this.t("ready") });
      return;
    }
    for (const message of this.messages) {
      const item = this.messagesEl.createDiv({ cls: `obcc-message obcc-${message.role}` });
      item.createDiv({ cls: "obcc-role", text: message.role });
      item.createDiv({ cls: "obcc-content", text: message.content });
    }
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  private renderSources(hits: SearchHit[]): void {
    this.sourcesEl.empty();
    const draft = this.draftContext.map((item) => ({
      path: item.label,
      title: item.label,
      excerpt: trimContext(item.content, 220),
      score: 0
    }));
    const all = [...draft, ...hits];
    if (!all.length) {
      this.sourcesEl.createDiv({ cls: "obcc-empty-small", text: this.t("emptyContext") });
      return;
    }
    for (const hit of all) {
      const card = this.sourcesEl.createDiv({ cls: "obcc-source" });
      const title = card.createDiv({ cls: "obcc-source-title" });
      title.setText(hit.path);
      card.createDiv({ cls: "obcc-source-excerpt", text: hit.excerpt || this.t("sourceAdded") });
      if (hit.score) card.createDiv({ cls: "obcc-source-score", text: this.t("score", { score: hit.score }) });
    }
  }

  private setStatus(text: string): void {
    if (this.statusEl) this.statusEl.setText(text);
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
    containerEl.createEl("h2", { text: PLUGIN_NAME });
    containerEl.createEl("p", { cls: "obcc-settings-note", text: this.plugin.t("configAuthority") });

    const coreEl = containerEl.createDiv({ cls: "obcc-settings-core" });

    new Setting(coreEl)
      .setName(this.plugin.t("settingsLanguage"))
      .setDesc(this.plugin.t("settingsLanguageDesc"))
      .addDropdown((dropdown) => {
        dropdown
          .addOptions({
            auto: this.plugin.t("languageAuto"),
            zh: this.plugin.t("languageZh"),
            en: this.plugin.t("languageEn")
          })
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

    new Setting(coreEl)
      .setName(this.plugin.t("settingsApiUrl"))
      .setDesc(this.plugin.t("settingsApiUrlDesc"))
      .addText((text) => {
        text
          .setPlaceholder("https://api.openai.com/v1")
          .setValue(this.plugin.settings.apiUrl)
          .onChange(async (value) => {
            this.plugin.settings.apiUrl = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(coreEl)
      .setName(this.plugin.t("settingsApiMode"))
      .setDesc(this.plugin.t("settingsApiModeDesc"))
      .addDropdown((dropdown) => {
        dropdown
          .addOptions({
            auto: this.plugin.t("apiModeAuto"),
            responses: this.plugin.t("apiModeResponses"),
            compatible: this.plugin.t("apiModeCompatible")
          })
          .setValue(this.plugin.settings.apiMode)
          .onChange(async (value) => {
            this.plugin.settings.apiMode = value as ApiMode;
            await this.plugin.saveSettings();
          });
      });

    new Setting(coreEl)
      .setName(this.plugin.t("settingsApiKey"))
      .setDesc(this.plugin.t("settingsApiKeyDesc"))
      .addText((text) => {
        text.inputEl.type = "password";
        text
          .setPlaceholder("sk-...")
          .setValue(this.plugin.settings.apiKey)
          .onChange(async (value) => {
            this.plugin.settings.apiKey = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(coreEl)
      .setName(this.plugin.t("settingsModel"))
      .addText((text) => {
        text
          .setPlaceholder("gpt-4.1-mini")
          .setValue(this.plugin.settings.model)
          .onChange(async (value) => {
            this.plugin.settings.model = value.trim();
            await this.plugin.saveSettings();
          });
      });

    const advanced = containerEl.createEl("details", { cls: "obcc-advanced-settings" });
    advanced.createEl("summary", { text: this.plugin.t("advancedSettings") });
    const advancedBody = advanced.createDiv({ cls: "obcc-advanced-body" });

    new Setting(advancedBody)
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

    new Setting(advancedBody)
      .setName(this.plugin.t("settingsMaxOutputTokens"))
      .addText((text) => {
        text
          .setPlaceholder("2048")
          .setValue(String(this.plugin.settings.maxOutputTokens))
          .onChange(async (value) => {
            const parsed = Number.parseInt(value, 10);
            if (Number.isFinite(parsed)) {
              this.plugin.settings.maxOutputTokens = Math.max(16, Math.min(32000, parsed));
              await this.plugin.saveSettings();
            }
          });
      });

    new Setting(advancedBody)
      .setName(this.plugin.t("settingsCoreMemoryFolder"))
      .setDesc(this.plugin.t("settingsCoreMemoryFolderDesc"))
      .addText((text) => {
        text
          .setPlaceholder("AI/Memory")
          .setValue(this.plugin.settings.memoryFolder)
          .onChange(async (value) => {
            this.plugin.settings.memoryFolder = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(advancedBody)
      .setName(this.plugin.t("settingsMaxContextFiles"))
      .addText((text) => {
        text
          .setPlaceholder("6")
          .setValue(String(this.plugin.settings.maxContextFiles))
          .onChange(async (value) => {
            const parsed = Number.parseInt(value, 10);
            if (Number.isFinite(parsed)) {
              this.plugin.settings.maxContextFiles = Math.max(1, Math.min(20, parsed));
              await this.plugin.saveSettings();
            }
          });
      });

    new Setting(advancedBody)
      .setName(this.plugin.t("settingsIncludeCurrentFile"))
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.includeCurrentFile).onChange(async (value) => {
          this.plugin.settings.includeCurrentFile = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(advancedBody)
      .setName(this.plugin.t("settingsIncludeCoreMemory"))
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.includeCoreMemory).onChange(async (value) => {
          this.plugin.settings.includeCoreMemory = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(advancedBody)
      .setName(this.plugin.t("settingsUseVaultSearch"))
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.useVaultSearchByDefault).onChange(async (value) => {
          this.plugin.settings.useVaultSearchByDefault = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(advancedBody)
      .setName(this.plugin.t("settingsSystemPrompt"))
      .setDesc(this.plugin.t("settingsSystemPromptDesc"))
      .addTextArea((text) => {
        text.inputEl.rows = 10;
        text
          .setValue(this.plugin.settings.systemPrompt)
          .onChange(async (value) => {
            this.plugin.settings.systemPrompt = value;
            await this.plugin.saveSettings();
          });
      });
  }
}

function tokenize(input: string): string[] {
  const lower = input.toLowerCase();
  const matches = lower.match(/[a-z0-9_\-/]{2,}|[\u4e00-\u9fff]{1,2}/g) ?? [];
  const stop = new Set(["the", "and", "for", "with", "this", "that", "你", "我", "的", "了", "是", "在", "和", "就", "都", "把"]);
  return [...new Set(matches.filter((token) => !stop.has(token)))];
}

function resolveLanguage(mode: LanguageMode): Language {
  if (mode === "zh" || mode === "en") return mode;
  const locale = navigator.language.toLowerCase();
  return locale.startsWith("zh") ? "zh" : "en";
}

function formatI18n(template: string, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? ""));
}

function normalizeSettings(input: Partial<Settings>): Settings {
  const merged = { ...DEFAULT_SETTINGS, ...input };
  const temperature = Number(merged.temperature);
  const maxOutputTokens = Number.parseInt(String(merged.maxOutputTokens), 10);
  const maxContextFiles = Number.parseInt(String(merged.maxContextFiles), 10);
  return {
    ...merged,
    language: isLanguageMode(merged.language) ? merged.language : DEFAULT_SETTINGS.language,
    accessMode: isAccessMode(merged.accessMode) ? merged.accessMode : DEFAULT_SETTINGS.accessMode,
    apiMode: isApiMode(merged.apiMode) ? merged.apiMode : DEFAULT_SETTINGS.apiMode,
    apiUrl: typeof merged.apiUrl === "string" ? merged.apiUrl : DEFAULT_SETTINGS.apiUrl,
    apiKey: typeof merged.apiKey === "string" ? merged.apiKey : DEFAULT_SETTINGS.apiKey,
    model: typeof merged.model === "string" ? merged.model : DEFAULT_SETTINGS.model,
    temperature: Number.isFinite(temperature) ? Math.max(0, Math.min(2, temperature)) : DEFAULT_SETTINGS.temperature,
    maxOutputTokens: Number.isFinite(maxOutputTokens) ? Math.max(16, Math.min(32000, maxOutputTokens)) : DEFAULT_SETTINGS.maxOutputTokens,
    maxContextFiles: Number.isFinite(maxContextFiles) ? Math.max(1, Math.min(20, maxContextFiles)) : DEFAULT_SETTINGS.maxContextFiles,
    memoryFolder: typeof merged.memoryFolder === "string" ? merged.memoryFolder : DEFAULT_SETTINGS.memoryFolder,
    includeCurrentFile: Boolean(merged.includeCurrentFile),
    includeCoreMemory: Boolean(merged.includeCoreMemory),
    useVaultSearchByDefault: Boolean(merged.useVaultSearchByDefault),
    systemPrompt: typeof merged.systemPrompt === "string" ? merged.systemPrompt : DEFAULT_SETTINGS.systemPrompt
  };
}

function settingsToCancipConfig(settings: Settings): Record<string, unknown> {
  return {
    schemaVersion: CANCIP_CONFIG_SCHEMA_VERSION,
    accessMode: settings.accessMode,
    language: settings.language,
    apiUrl: settings.apiUrl,
    apiKey: settings.apiKey,
    apiMode: settings.apiMode,
    model: settings.model,
    temperature: settings.temperature,
    maxOutputTokens: settings.maxOutputTokens,
    maxContextFiles: settings.maxContextFiles,
    memoryFolder: settings.memoryFolder,
    includeCurrentFile: settings.includeCurrentFile,
    includeCoreMemory: settings.includeCoreMemory,
    useVaultSearchByDefault: settings.useVaultSearchByDefault,
    systemPrompt: settings.systemPrompt
  };
}

function parseCancipConfig(raw: unknown): Partial<Settings> {
  if (!isRecord(raw)) return {};
  const config: Partial<Settings> = {};
  if (isLanguageMode(raw.language)) config.language = raw.language;
  if (isAccessMode(raw.accessMode)) config.accessMode = raw.accessMode;
  if (typeof raw.apiUrl === "string") config.apiUrl = raw.apiUrl;
  if (typeof raw.apiKey === "string") config.apiKey = raw.apiKey;
  if (isApiMode(raw.apiMode)) config.apiMode = raw.apiMode;
  if (typeof raw.model === "string") config.model = raw.model;
  if (typeof raw.temperature === "number" || typeof raw.temperature === "string") config.temperature = Number(raw.temperature);
  if (typeof raw.maxOutputTokens === "number" || typeof raw.maxOutputTokens === "string") config.maxOutputTokens = Number.parseInt(String(raw.maxOutputTokens), 10);
  if (typeof raw.maxContextFiles === "number" || typeof raw.maxContextFiles === "string") config.maxContextFiles = Number.parseInt(String(raw.maxContextFiles), 10);
  if (typeof raw.memoryFolder === "string") config.memoryFolder = raw.memoryFolder;
  if (typeof raw.includeCurrentFile === "boolean") config.includeCurrentFile = raw.includeCurrentFile;
  if (typeof raw.includeCoreMemory === "boolean") config.includeCoreMemory = raw.includeCoreMemory;
  if (typeof raw.useVaultSearchByDefault === "boolean") config.useVaultSearchByDefault = raw.useVaultSearchByDefault;
  if (typeof raw.systemPrompt === "string") config.systemPrompt = raw.systemPrompt;
  return config;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLanguageMode(value: unknown): value is LanguageMode {
  return value === "auto" || value === "zh" || value === "en";
}

function isAccessMode(value: unknown): value is AccessMode {
  return value === "ask-for-approval" || value === "full-access";
}

function isApiMode(value: unknown): value is ApiMode {
  return value === "auto" || value === "compatible" || value === "responses";
}

function extractCancipActions(answer: string): CancipAction[] {
  const actions: CancipAction[] = [];
  const fenceRegex = /```cancip-action\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = fenceRegex.exec(answer)) !== null) {
    const body = match[1].trim();
    if (!body) continue;
    try {
      const parsed = JSON.parse(body) as unknown;
      const candidates = isRecord(parsed) && Array.isArray(parsed.actions) ? parsed.actions : [parsed];
      for (const candidate of candidates) {
        const action = parseCancipAction(candidate);
        if (action) actions.push(action);
      }
    } catch {
      continue;
    }
  }
  return actions.slice(0, 20);
}

function parseCancipAction(input: unknown): CancipAction | null {
  if (!isRecord(input) || typeof input.type !== "string" || typeof input.path !== "string") {
    return null;
  }

  if (input.type === "read") {
    return { type: "read", path: input.path };
  }

  if (input.type === "write" && typeof input.content === "string") {
    return { type: "write", path: input.path, content: input.content };
  }

  if (input.type === "append" && typeof input.content === "string") {
    return { type: "append", path: input.path, content: input.content };
  }

  if (input.type === "mkdir") {
    return { type: "mkdir", path: input.path };
  }

  if (input.type === "rename" && typeof input.newPath === "string") {
    return { type: "rename", path: input.path, newPath: input.newPath };
  }

  if (input.type === "copy" && typeof input.newPath === "string") {
    return { type: "copy", path: input.path, newPath: input.newPath };
  }

  return null;
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

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
