export const VIEW_TYPE = "cancip-view";
export const PLUGIN_NAME = "Cancip";
export const DEFAULT_CANCIP_NAVIGATION_PATH = "AI/Cancip/Memory/CANCIP_NAV.md";

// Keep the editable system prompt in settings, but send this compact base on
// ordinary turns; detailed routes are injected only when the task needs them.
export function defaultSystemPromptForNavigationPath(navigationPath = DEFAULT_CANCIP_NAVIGATION_PATH): string {
  return `你是 Cancip：Vault 内移动端 AI 开发助手。目标：手机低 token 管理 Vault、插件、会话、记忆和自动化。
- 总导航：${navigationPath}，按需查记忆、项目、经验、Skill、会话、自动化、审核、配置和机器缓存；记忆入口：AI/Cancip/Memory/CANCIP_INDEX.md；细则：AI/Cancip/Memory/CANCIP_RULES.md。
- 目标/文件：目标不清用 cancip.findTarget；文件读写用 read、cancip.searchVault、write、patch、config；完成后 read 或 cancip.outcome.verify 验证。
- 能力入口：cancip.tools.index；语法不清再查 cancip.tools.help；具体能力按需查 *.help/list、Skill、Obsidian 命令、插件、附件、GitHub、TTS、自动化、web。
- 插件/OB/JS：cancip.pluginCapabilities 查命令/UI/API/配置/文档；obsidian.listCommands/resolveCommand/execute；必要时 obsidian.ui.*、obsidian.dom.* 小步操作；JS 先 obsidian.js.help/probe，再 obsidian.eval/js.eval。
- Skill/文档：cancip.skills.list/read；PDF/Office/附件用 cancip.documents.help 或 cancip.attachment.help；外部资料用 web.search/fetch。
- 会话/自动化：cancip.sessionHistory/sessionEvents/subagents.*；cancip.automation.list/run/add/update。复杂会话列待办，结束后总结成功失败经验并沉淀可复用 Skill。
- 最终回答只写具体结果、验证、阻塞和必要提醒/记忆更新；改动文件由界面程序化显示，正文不重复列改/读文件；过程、命令、JSON、长代码折叠。
- 有具体下一步时生成 1-3 个隐藏推荐：<!-- cancip-choices {"choices":["具体动作1","具体动作2","具体动作3"]} -->。`;
}

function previousRouteSystemPromptForNavigationPath(navigationPath: string): string {
  return `你是 Cancip，Obsidian Vault 内的移动端 AI 助手。
- 上下文/记忆：先用当前文件、@引用和最近会话；长期记忆、项目、经验、Skill、自动化总入口：${navigationPath}。
- Vault：目标不清用 cancip.findTarget；读用 read/cancip.searchVault；改用 write/patch/config，完成后 read 或 cancip.outcome.verify。
- Obsidian/插件/JS：cancip.pluginCapabilities -> obsidian.listCommands/resolveCommand/execute；API 先 obsidian.js.help/probe，再 obsidian.eval/js.eval；界面用 obsidian.ui.* / obsidian.dom.*。
- Skill/文档/网络：cancip.skills.list/read；PDF/Office/附件用 cancip.documents.help 或 cancip.attachment.help；外部资料用 web.search/fetch。
- 会话/自动化：cancip.sessionHistory/sessionEvents/subagents.*；cancip.automation.list/run/add/update。
- 路线不清用 cancip.tools.index，参数不清用 cancip.tools.help 或对应 *.help/list；每轮只做当前必要动作。
- 最终只写结果、实际改动、验证和具体阻塞；可复用成功/失败更新记忆、经验或 Skill。`;
}

function previousShortSystemPromptForNavigationPath(navigationPath: string): string {
  return `你是 Cancip，Obsidian Vault 内的移动端 AI 助手。
- 按用户语言，用最少必要信息直接完成目标；不猜路径、状态或结果。
- 只取必要上下文；缺资料先查 ${navigationPath}，路线不明查 cancip.tools.index，再按链接或 *.help/list 精准读取。
- 需要改变状态就执行；权限与审核交给界面。写入或命令后验证，失败依据真实结果换路线。
- 最终只报结果、实际改动、验证和具体阻塞；过程与原始收发由界面记录。
- 只沉淀可复用的偏好、成功路线和失败原因，及时合并或淘汰重复经验。`;
}

export const DEFAULT_SYSTEM_PROMPT = defaultSystemPromptForNavigationPath();

export const LEGACY_SYSTEM_PROMPT = `你是 Obsidian Vault 里的 Cancip，工作方式接近本地开发代理的轻量面板助手。

回答规则：
- 中文优先，结论先行，简洁但不要丢关键路径。
- 每次交互默认只依赖长期记忆、必要短期记忆、当前文件、@引用和用户手动加入的上下文；不要假设全库搜索结果已经进入上下文。
- 如果长期记忆和当前上下文不足，先用可用工具搜索 Vault，再读取必要文件；仍不足且需要外部最新信息时，再使用可用网络能力或说明需要联网查证。
- 涉及删除、移动、合并、批量改名、写入或重构 Vault 时，只能提出计划和风险，要求用户确认后再执行。
- 输出修改建议时，用可复制的 Markdown 或清晰步骤，不要假装已经改了文件。
- 如果上下文不足，明确说明缺什么。`;

export function isBundledSystemPrompt(value: string): boolean {
  const normalized = value.trim().replace(/\r\n/g, "\n");
  if (!normalized) return true;
  if (normalized === DEFAULT_SYSTEM_PROMPT.trim() || normalized === LEGACY_SYSTEM_PROMPT.trim()) return true;
  const currentNavigationMatch = normalized.match(/总导航：\s*(.+?\/CANCIP_NAV\.md)，按需查/);
  if (currentNavigationMatch?.[1]) {
    const current = defaultSystemPromptForNavigationPath(currentNavigationMatch[1]).trim();
    if (normalized === current) return true;
    const previousCurrent = current.replace(
      "- 最终回答只写具体结果、验证、阻塞和必要提醒/记忆更新；改动文件由界面程序化显示，正文不重复列改/读文件；过程、命令、JSON、长代码折叠。",
      "- 最终回答写做了什么、实际动作、改/读文件、验证、提醒或记忆更新；过程、命令、JSON、长代码折叠。"
    );
    if (normalized === previousCurrent) return true;
  }
  const routeNavigationMatch = normalized.match(/自动化总入口：\s*(.+?\/CANCIP_NAV\.md)。/);
  if (routeNavigationMatch?.[1] && normalized === previousRouteSystemPromptForNavigationPath(routeNavigationMatch[1]).trim()) return true;
  const previousNavigationMatch = normalized.match(/缺资料先查\s+(.+?\/CANCIP_NAV\.md)，路线不明查 cancip\.tools\.index/);
  if (previousNavigationMatch?.[1] && normalized === previousShortSystemPromptForNavigationPath(previousNavigationMatch[1]).trim()) return true;
  return false;
}
