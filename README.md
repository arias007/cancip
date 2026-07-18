# Obsidian Cancip AI

Obsidian Cancip AI is a right-side AI chat panel shaped toward a mobile-first agent workflow for Obsidian.

Cancip is a lightweight prototype for managing an Obsidian vault from a mobile-friendly AI panel:

- Multiple API profiles, each with its own Base URL, key, API mode, and model.
- Multilingual UI with auto device-language detection for Simplified Chinese, Traditional Chinese, English, Uyghur, Turkish, Russian, Japanese, Korean, Spanish, French, German, and Arabic; missing low-frequency strings fall back to English, and Arabic/Uyghur use RTL layout hints.
- Automatic OpenAI Responses and OpenAI-compatible Chat Completions support.
- `.cancip/config.json` as the authoritative vault-level config.
- Two execution access modes only: confirmation mode reads freely and queues write-like actions for approval; full-access mode executes implemented actions directly. Access is controlled only by the UI or `.cancip/config.json`, not by conversation text.
- Current note, selection, dynamic `@` mentions, visible long-term/core memory, and universal hard-first search across notes, sessions, memories, paths, configs, PDFs, images/OCR sidecars, Office files, archives, and other Vault files.
- `cancip-action` JSON tool blocks for validated vault-relative actions, including read/write/append/patch/mkdir/rename/copy.
- Agent-style tool runs: approval mode queues action blocks under the assistant message with Run/Reject controls, while Full access executes and records results.
- Tool result continuation loop: after tools finish, Cancip can feed results back into the model and continue for a bounded number of iterations, closer to local agent runs.
- Outcome verification closes the execution loop inside Obsidian: `cancip.outcome.observe/verify` compare the active view, DOM/layout, file readback, plugin state, and workspace leaves with explicit expectations; `capture` adds active-region PNG evidence only when structured checks are insufficient, and `exportPdf` uses an installed exporter for PDF evidence. Failed checks trigger bounded difference-only correction, while reports and screenshots stay under `.cancip/evidence/` with direct review links and no persisted Base64 payloads.
- Structured command bus actions for Obsidian internal commands, Cancip built-ins, and GitHub CLI-equivalent REST API commands.
- Native File Explorer pinning: pin/unpin files and folders from the normal context menu, keep mixed pinned siblings above ordinary items, reorder with explicit up/down buttons or drag handles, and persist folder-local order in `.cancip/file-pins.json` without replacing Obsidian's normal unpinned sort or file drag/move behavior.
- Universal document workbench: every Vault file can be opened as a Markdown representation from the native file menu. Text, HTML/MHTML, CSV, JSON, PDF, DOCX, XLSX, PPTX, media, ZIP-based documents, and unknown binaries receive format-aware previews; editable text formats save with readback verification, while binary originals remain protected and edited conversions export as Markdown or standalone HTML.
- Obsidian-native Markdown rendering for chat messages, including Obsidian-supported HTML.
- Cancip chat and rendered Markdown note code blocks keep Obsidian's copy action beside one global wrap toggle. Unwrapped horizontal scrolling is the default; one toggle updates current and future chat/note code blocks and persists across restarts.
- Long-term/core memory defaults to visible `AI/Cancip/Memory/` and is included in every model interaction.
- First-install Vault orientation writes `AI/Cancip/Memory/VAULT_OVERVIEW.md` when missing. It is a shallow programmatic map of top-level folders, file kinds, recent user-facing files, and installed Obsidian plugins, so later turns can pick the right folder/plugin to inspect on demand without sending the whole vault.
- Full-vault search is not attached by default. Cancip should first use long-term memory and necessary short-term/session context, then decide whether to run `cancip.searchVault` and read only the necessary matched files.
- Model calls use a payload policy: trivial chat stays lightweight, informational turns add only targeted context, and implementation/self-repair turns include the full tool protocol and compact memory.
- Skills and experience recipes are routed on demand: memory/rule/preference, OB plugin, command, attachment, and self-optimization tasks can auto-select relevant Skills, query `cancip.skills.*` / `cancip.experience.*`, and harvest repeatable successful workflows into `.cancip/skills/generated/`.
- Full session export from the chat header to Markdown and JSON under visible `AI/Cancip/Exports/`.
- Lightweight project session history stays under `.cancip/sessions/`, opened from the compact history button beside the new-chat button.
- Every session now keeps a normalized timeline: immutable creation time, latest activity, first start, and available completion/stop/failure times. History rows expand to exact local time with seconds and no timezone suffix; session commands, event audit, parent/child rows, and Markdown/JSON exports expose the same canonical ISO timestamps. Legacy sessions recover only timestamps that can be determined from stored data or a valid session ID.
- The Review Gate view opens immediately on desktop and mobile, recovers deferred or stale leaves, reuses an already rendered review page, and avoids scanning the same package again when the requested package and file have not changed. New review packages use visible `AI/Cancip/Review/` as the synchronized source of truth; startup merges legacy `.cancip/review-gates/` packages and decisions into it, and visible packages shadow same-name hidden copies so desktop/mobile counts converge without duplicate files. Paired review panes synchronize vertically on mobile and horizontally on desktop.
- Review data now uses one deduplicated parsed snapshot shared by the status bar, pending count, file list, and Review view. The snapshot is invalidated by Review changes, prewarmed before the view is revealed, and reused for ten seconds, eliminating repeated package scans and empty-list flashes. Status attention refreshes are coalesced and DOM updates are skipped when counts are unchanged.
- Compact context chips live inside the rounded composer/input box: the current active file is shown automatically with its extension, and source/context chips no longer occupy a separate panel.
- Context chips can be opened directly: file chips open the file in a tab, folder chips reveal the folder in the file navigator, and the small `x` removes only that context chip.
- Search is deterministic first: Cancip uses a persistent metadata/Bloom index, rereads every candidate before returning it, and includes source-backed hard-search excerpts in model context. If those results are insufficient, the active model may call `cancip.searchAll` once with 2-4 explicit `softQueries`; Cancip does not make a hidden second model call solely for query expansion. Config/session excerpts are redacted before indexing and return.
- Rounded composer with floating upward icon trays for context, access mode, and model selection; trays overlay from their buttons and close after selection or outside taps.
- Header controls include a single Plan button. The Plan button opens the planning/todo panel; it is not a chat mode and does not change read/write permission.
- The header includes an OB Review Gate button wired to a programmatic TypeScript builder adapted from `arias007/ob-review-gate-skill`: it scans selected vault files, writes review data under `AI/Cancip/Review/`, and opens it inside a native Cancip audit panel with file lists, structure changes, diffs, old text, and new text.
- Structured Plan todos are available as `cancip-action` tools, so the agent can set/add/update/remove/list/clear the visible Plan panel during an agent run instead of only describing a plan in prose.
- The composer keeps the access selector visible and wider for mobile tapping, with a paperclip attachment button beside it for quickly adding file/folder context.
- Settings expose common settings and every advanced category as peer horizontal pages. The tab strip scrolls on mobile, only the selected page is rendered, and changing an option no longer collapses an outer advanced section.
- The settings page can show two local payment QR codes at the bottom from `extras/code-1.jpg` and `extras/code-2.png`; the QR images are local plugin resources and are not included in prompts or JSON exports.
- Built-in model presets include GPT, Claude, Gemini, DeepSeek, Qwen, and Kimi-style names while still allowing a custom model string.
- `@` picker for files, folders, Skills, automations, plugins, Cancip functions, command bus entries, and real Obsidian commands. Empty `@` interleaves categories so Skills cannot crowd out every other target; typed text dynamically filters all categories. Selecting a target resolves it into an editable/removable composer context chip, while hand-typed `@keyword` still resolves by fuzzy match.
- Mobile composer geometry follows the active Obsidian WebView visual viewport, keeping the input and `@` picker above the Android keyboard. The Review detail shell reserves the Obsidian mobile status bar and keeps structure changes directly beside the content diff.
- Mobile keyboard positioning measures overlap between the stable chat host and the active WebView `visualViewport` while the composer is focused. Review bottom clearance uses the measured Obsidian status-bar height on every mobile viewport width instead of relying on a fixed narrow-screen media query.
- Button settings include `Send button info to Cancip` again, using the existing actionable button-context route without changing the button's normal short-press behavior.
- Running conversations use one first-level process record. Explicit readable model progress stays visible as numbered step headlines while API profiles, raw sent/received payloads, routing audits, tool JSON, tool results, and file-action details remain collapsed. Attribute-bearing `<details>` audit blocks are parsed structurally, empty audit blocks are omitted, and markup/JSON/truncation text cannot leak into step headlines. The process record opens while the request is running and collapses after the final answer.
- Compact live plan and changed-file summaries sit immediately beside the Cancip title. The plan summary opens the full plan panel; the file summary opens a scrollable, deduplicated file list with green added lines, red removed lines, and direct Vault navigation. The composer now reserves its status area for actually queued prompts.
- New chat renders and focuses immediately, then serializes the previous session and bootstraps the new session in the background. Session history reads before replacing visible rows, keeps the previous list during refresh, lazy-loads in batches, puts pinned sessions first, and shows `loaded/total` counts in the header.
- Sessions unused for 30 days move out of the hot session set into reversible cold storage under `.cancip/archive/`. Pinned, running, actively requested, and currently open sessions are protected. Cold sessions stay visible/searchable and are copy-verified before the hot file is removed; opening or restoring one verifies it back into `.cancip/sessions/`. Old event/experience history is deduplicated into month bundles, while user-authored long-term memory is never moved or deleted merely because it is old.
- Completed multi-step workflows are harvested only after at least two successful tool actions. The verified action sequence and final result feed the generated experience Skill so similar future tasks can route to a concrete prior workflow instead of repeating broad discovery.
- Completion now requires a real user-visible final answer after process/tool work. Missing or process-only closure retries up to five times, then remains resumable instead of being stored as a false completion. Running and completed sessions broadcast disk-backed updates to every open view of the same session so background/foreground transitions preserve their correct shape.
- PrimeTTS uses paired source/spoken chunks: the source chunk keeps original digits for display/highlight, while the spoken chunk applies language-aware number conversion. Chinese chunks use word segmentation without splitting ordinary words, adjacent English words stay together and use the system English voice when available, and decoded look-ahead is widened to reduce playback gaps.
- Button rules store view, command, icon, stable target identity, creation time, and modification time. Recently changed buttons sort first in settings. Menu insertion applies rules only to the newly mounted menu subtree and runs one short subtree-only trailing pass; full refreshes cache repeated scope/selector queries. Observers and timers follow each live Obsidian document/WebView, ignore unrelated body/container class churn, and react only to actual editable buttons/menu/status items/tab headers; internal DOM writes never re-enter the queue, and stable menu-group/name identity prevents adjacent-item cross-application.
- Lightweight local versioning under `.cancip/versions/`: manual commits and one daily auto snapshot, without native git and without per-edit history.
- Built-in local automation templates are seeded once from source and remain permanently user-editable. They include precomputed personalized new-chat greetings, evidence-backed diary assistance, review-gate generation, local version snapshots, news briefs, GitHub status, vault index refresh, daily read-only Vault checkups, memory/workflow review, and guarded new-file curation. Deleted defaults stay dismissed instead of being recreated on restart.
- Automations run in a dedicated focus-neutral background view: starting a scheduled or manual task never reveals or switches the user's active leaf/session. Hidden runners skip message DOM repaint and cold foreground restore/index work, session snapshots are persisted at a lower bounded frequency for recoverability, and idle runners are released after a short reuse window.
- Startup and foreground loading follow a warm/cold lifecycle: the visible shell renders first, latest-session restore follows asynchronously, small high-value indexes warm during browser idle time, and startup maintenance yields between tasks so mobile interaction remains responsive.
- New-file curation runs in an isolated session with a stable minimal prompt prefix. A programmatic benefit gate classifies each file as curate, skip, or protected before any model call: only concrete high-value defects become candidates; clean, cosmetic-only, or Inbox-only cases are consumed silently; templates, frequently referenced notes, plugin syntax, and generated files are protected from automatic rename/restructure. Each candidate carries a defect-derived action allowlist so one formatting issue cannot authorize unrelated tags, links, summaries, or renaming.
- TTS is provider-routed by language. English defaults to Web Speech / system TTS and does not need a local model package. Chinese can auto-download and use the current compact PrimeTTS Chinese/English ONNX package. Other languages use system/Web/custom URL unless a compatible local PrimeTTS package is installed under `tts/<package>/` with a manifest.

## 2.14.18

- 修复笔记补全后台分支超时后继续逐项补发、再次重试造成的长期请求和状态栏持续旋转。现在每层严格只批量请求一次：首层 3 个一次，显示后对应 9 个一次；响应不完整或超时也不会在同一层自动追加模型请求。
- 自动补全网络活动使用 12 秒共享截止时间，逻辑超时会同步结束状态栏转圈，即使底层网络 Promise 迟迟不返回也不会留下活动计数。应用候选后通过专用分支交接事件同步显示已缓存的对应 3 个，只启动这 3 个的下一层预加载，不再重新生成或替换当前批次。

## 2.14.17

- 笔记自动补全改为低 token 递归树：首轮只请求 3 个一级并立即显示轮换；一级显示后后台请求这 3 个一级各自的 3 个下一级，共 9 个。选择其中一个时优先立即交接已缓存的 3 个，再为这 3 个请求下一层 9 个，依次递归，未选而输入新内容则开始新的一级 3 项请求。
- 状态栏转圈只绑定真实自动补全网络请求 `requestUrl` 的生命周期。记忆读取、模型冷却、JSON 解析、缓存命中、Promise 等待、UI 更新和后台无网络处理均不转圈；已在生成中的分支会复用同一 Promise，完成后自动接上。

## 2.14.16

- 修复自动补全返回 3 个候选后被重定位逻辑错误裁成 1 个的问题，模型候选现在会完整显示并按设置轮换。
- 二级候选预取改为静默后台任务，不再让状态栏图标长时间旋转；批量响应缺少部分分支时并发补齐缺项。选择候选后会接管同一个进行中的预取 Promise，已缓存则立即显示对应下一批，仍在生成则完成后直接交接，不重复发请求，也不会把迟到结果写到已移动的光标。

## 2.14.15

- 笔记自动补全改为先显示、后预加载：当前层按设置生成 `N` 个候选后立即显示和轮换，不再等待下一级；候选出现后再用一个后台批量请求准备每项各 `N` 个下一级，默认先显示 3 项、随后预加载 9 项。选中候选时直接交接已就绪的对应分支，并继续后台准备再下一层。
- 自动补全设置新增预加载开关、2 至 30 秒轮换间隔和 1 至 5 个每批候选数；候选数同时控制当前层、下一级和聊天输入推荐。手动选择“上一个/下一个”后仅暂停当前批次，输入变化、应用候选或换批后恢复自动轮换。

## 2.14.14

- 编辑器自动补全改为真正的前瞻流水线：首批三个轮换候选只有在各自三个二级候选全部进入缓存后才显示，当前批次始终先备齐 3+9 共 12 项；选中一级后同步切换到对应三个二级候选，不再临时等待模型。
- 一级与二级改为一次紧凑的 3×3 树请求，首个响应直接缓存完整 12 项；显示下一层时再用一次批量请求准备新的九项，并按完整文件、前缀、模型和补全偏好复用进行中的 Promise。重复刷新不重复消耗请求，强制换批同样先通过 12 项就绪检查，生成期间保留现有候选。

## 2.14.13

- 默认开启编辑器自动补全；只要光标仍在当前活动编辑器，即使焦点短暂转移到工作台或其他 UI，也会继续准备候选。首批 3 个候选先快速返回，3×3 二级候选随后后台预取；个性化缓存刷新只更新记忆，不再取消正在返回的补全。新会话启动立即后台预热个性化问候；没有可靠资料时只显示自然的时段问候，不声称“没有信息”或猜测近况。
- DOCX、XLSX、PPTX、HTML/MHTML 和其他未被占用的常见文档默认进入文档工作台；PDF 保持 Obsidian 核心视图默认打开，也可手动送入工作台。扩展冲突逐项隔离，不再中断 Cancip 启动。XLSX 按 OOXML 工作簿关系解析工作表，兼容大小写/相对路径差异，并在关系异常时按工作表顺序回退，保留共享字符串、空列位置、公式和布尔值。

## 2.14.12

- Keeps recursive 3-by-3 editor completion prefetch, but makes it lighter: compact complete candidates, smaller relevant context, lower output budget, shorter debounce/cooldown, and a cached working Responses/Chat Completions route avoid repeated failed transport probes.
- Selecting a completion synchronously adopts its prefetched children at the new cursor, including multiline candidates. If recursive prefetch finishes after selection, the inserted text is matched and its children are handed off without losing the branch.
- Editor ghost text now participates in the same inline text flow as inserted text instead of moving as one atomic flex box, so wrapping and explicit newlines begin at the real cursor position and match the applied result.

## 2.14.11

- Mobile buttons inside the keyboard-lifted composer footer now remain owned by the Cancip view after the footer is portaled to the document body, so recommendations, menus, queue controls, model/access actions, and Send execute on the first touch instead of only dismissing the keyboard.
- The autocomplete apply/settings control preserves its long-press menu while handling a short touch on pointer-up and suppressing the delayed duplicate click.

## 2.14.10

- Restores document-workbench leaves in place after plugin hot reload, preserving the same tab, file, mode, pin state, and active state without detaching leaves or creating blank tabs.
- Reuses one workbench tab by default when opening different files. A dedicated Workbench settings page controls default Preview/Markdown/Edit mode, compact headers, file metadata, and single-tab reuse.
- Compact workbench layout keeps the title, mode selector, and fixed action buttons in a short two-row header on narrow sidebars; metadata becomes a single scrollable line and document content begins near the top instead of the lower half.

## 2.14.9

- Mobile touch now activates Cancip recommendations and conversation controls on the first press while suppressing the delayed duplicate click and preserving autocomplete long-press controls.
- Live process records use a stable turn key: untouched records open while running and collapse on completion, while a user's manual open/closed choice survives streaming DOM rebuilds and the final answer.
- Process audits are reduced to at most three independently expandable groups: exact sent source, exact received source, and compact runtime information. Redundant split prompts and visible-answer copies are omitted when raw payloads exist.
- Composer todo/plan rows are hard-bounded to the sidebar and floating visual viewport, preventing long tasks from overflowing left or right.
- Markdown completion rotates every five seconds and generates a three-option tree with three prefetched continuations per option. Applying a branch shows its cached next choices immediately and starts prefetching the following level.
- Button editing and autocomplete now have independent settings pages. Built-in automation controls use localized labels, templates choose Chinese or English fallback content from the active UI language, and user-edited tasks are never overwritten by startup migration.
- Personalized greeting refresh and diary writing assistance are visible built-in automation tasks. Their prompts, schedules, model/profile routes, notifications, and enabled state remain editable in `.cancip/automations.json` through the normal automation settings UI.

## 2.14.4

- Moved Copy and Wrap into a fixed action layer outside horizontal code scrolling, eliminating the visible move-then-snap effect in chat and rendered notes.
- Restored live elapsed-time headlines and classified real fenced API audits into sent, received, runtime, and other details without exposing redundant progress prose.
- Settings category redraws now retain the horizontal tab-strip position as well as the visible vertical option.
- Markdown editor autocomplete now keeps one model request in flight, rebases a matching response onto continued input, retries only after a mismatch, and cancels stale work after a newline, completed sentence, block delimiter, selection change, or focus loss.

## 2.14.3

- Removed the precomputed diary button and file-list insertion flow. Diary-writing requests in an active daily note now use the current model with a bounded record of today's real prompts and verified tool outcomes, while normal review still governs note writes.
- Restored independently expandable Chinese process-audit fields, consecutive previous-prompt navigation, stable TTS session UI, and sentence-change source-highlight recentering.
- Automation task settings are collapsed by default and default tasks migrate to a relevant prior session when one is available. Chinese composer autocomplete now triggers earlier and preserves local suggestions when model completion fails.
- Copy and wrap controls remain fixed at the code-block viewport edge while chat and note code scroll horizontally.
- Settings redraws preserve the visible option instead of jumping the page. `Add current file` now creates the same removable file snapshot used by `Send to Cancip`, including parsed document or image context when applicable.
- The active model now provides quiet line-end completion inside Markdown editing as well as the Cancip composer, with local candidates first, bounded nearby context, stale-result rejection, and Tab or an inline icon to apply.
- Preferred name, locality, weather, and restrained caring cues are inferred from direct user-related evidence by Cancip itself. Manual name/location fields are optional corrections; ambiguous or unverified details stay absent.

## 2.14.2

- New chats now select a stable greeting from several background-generated, evidence-backed variants. Greetings can use an explicitly configured or reliably labeled preferred name, optionally include cached live Open-Meteo weather, and offer two or three concrete next-action buttons without delaying chat creation.
- Composer autocomplete now returns one compact JSON result containing the gray suffix, up to three input-specific action buttons, and short reusable workflow steps. The suggestions float without changing footer height, while scroll clearance keeps the final chat content reachable above the keyboard.
- Cancip records recommendation-button use locally. Repeated choices create a native Review Gate sorting proposal at three uses; priority changes only after approval. Repeated successful multi-tool workflows may become generated Skills, while one-off actions are no longer promoted.
- The core agent prompt now explicitly completes clear low-risk next steps on the user's behalf while keeping writes and high-impact operations behind the existing access mode and audit flow.

## 2.14.1

- Reworked outcome-capture and hidden-button styling through Obsidian DOM/CSS helpers, removing the blocking static-style review errors without changing capture behavior.
- Replaced native element creation with popout-safe Obsidian helpers, adopted the active Vault configuration directory for universal search, and added the Obsidian 1.13 settings-definition entry point while preserving the complete legacy settings UI.
- Cleaned review warnings for unsafe values, redundant assertions, regular expressions, cross-window element checks, unused code, code-block controls, and document-preview selectors.

## 2.14.0

- Added a single mobile-safe document workbench with Preview, Markdown, and Edit modes. Every Vault file now has `Open in document workbench` and `Open as Markdown` actions in the normal file menu.
- Added semantic DOCX conversion with headings, emphasis, tables, headers/footers and notes; XLSX conversion preserves sheet names and cell column positions; PPTX conversion keeps slide boundaries, titles, text, and speaker notes.
- Added isolated HTML/MHTML preview, MHTML embedded-media decoding, quoted CSV/TSV tables, native PDF/media preview, ZIP-based document extraction, and safe metadata/embed fallback for unsupported binaries.
- Text-family files can be edited in place with readback verification. Office, PDF, media, archive, and unknown binary originals are never rewritten; edited output is saved as a new Markdown or standalone HTML conversion.
- Added `cancip.documents.help/open/convert` command-bus routes and fixed the release workflow to publish normal numeric tags while keeping release assets limited to `main.js`, `manifest.json`, and `styles.css`.

## 2.13.0

- Native File Explorer pinning now keeps files and folders mixed at the top of their original folder, with inline up/down/unpin controls and no separate pinned-items panel.
- New chats use a short background-precomputed greeting from the current time, recent files, compact memory, and recent session signals; date-based notes expose an enabled-by-default personalized diary action.
- The composer now offers quiet gray context completion from local candidates first and a compact model fallback only after an idle delay. Tab or the inline check applies it, while long-press opens enable, regenerate, and guidance controls.
- Chat and Markdown-note code blocks reserve fixed non-overlapping 26px slots for Copy and Wrap across narrow and desktop layouts.

## 2.12.0

- Added structured post-action verification for active view/file text, DOM selectors and geometry, file contents/JSON paths, plugin versions, workspace leaf counts, layout stability, and overflow.
- Added active-region PNG evidence with non-blank pixel checks, optional one-image model review, local JSON reports, and visible evidence links in tool runs. Screenshot Base64 remains memory-only and is never stored in session JSON.
- Failed verification now continues with the same loop id and incremented attempt for measured, minimal correction only. The loop stops at its declared limit and hands the saved evidence to the user instead of retrying indefinitely.
- Added installed-exporter PDF verification and a real Obsidian regression fixture covering pass/fail/attempt-limit behavior, PNG integrity and pixels, report schema, evidence UI, image handoff, and cleanup.

## 2.11.1

- Fixed smoke-test cleanup so a restored `data.json` remains authoritative over the mirrored `.cancip/config.json`, preventing test runs from reapplying stale UI rules or preferences.

## 2.11.0

- Added a dedicated mobile acceptance smoke profile covering viewport bounds, Android keyboard/composer geometry, `@` popover placement, bottom-of-chat reachability, history reuse, and blank-leaf prevention.
- Process-record raw sent/received fields and inline tool results now load only when the first-level process record is opened. Folded sessions keep the full auditable source on disk without immediately laying out tens of thousands of hidden DOM characters.
- Mobile keyboard clearance now follows the actual overlay inset, so the final chat record can scroll above both the keyboard and floating composer and docks cleanly after keyboard dismissal.
- Fixed temporary hidden-button reveal restoring explicit hide rules, flattened mobile menu groups and cross-section sorting, and made native File Explorer pin tests open and restore the mobile left drawer explicitly.
- Exact-answer prompts now use one zero-context model call, explicit read-only memory/plugin questions take narrow programmatic routes, and completed tool-backed answers retain a completed session state instead of being misclassified as failed.
- Smoke fixtures now stay under `Cancip验收-临时/`, Windows PowerShell 5.1 automatically relaunches the suite under PowerShell 7 for UTF-8 safety, and reusable npm smoke/verify commands are included.

## 2.10.2

- Extended the persistent code-block wrap toggle to rendered code blocks in Markdown note reading view, Live Preview widgets, and note embeds. Non-Markdown leaves and raw editor text are untouched, and unloading Cancip restores native note DOM.
- Plugin reload now restores an existing Cancip placeholder leaf in place, preserving its sidebar location without detaching the leaf or creating another tab.

## 2.10.1

- Added a persistent code-block wrap button beside Copy. The default keeps code unwrapped with horizontal touch scrolling; toggling it updates all current and future Cancip code blocks.

## 2.10.0

- Added reversible 30-day cold archiving for inactive sessions, session events, and machine-generated experience history. Archive indexes self-recover from the cold files, and age alone never deletes data.
- Added persistent universal search with hard search first, optional model-supplied semantic expansions second, source rereads to reject Bloom false positives, secret redaction, archived-session coverage, and focused image handoff.
- Added `cancip.searchAll`, search/archive status and maintenance commands, cold-session restore, and `lastOpenedAt` session tracking.
- Automations can now combine manual/hourly/daily schedules with debounced new-file triggers, comma-separated glob filters, per-task model/profile selection, and inherit/always/failure/never notification policies. The built-in new-file curation task batches Markdown creation events for 60 seconds to avoid one model call per file.
- Completion notifications are deduplicated and reduced to compact task/result/session lines. Programmatic/background completions use the same format and still honor Obsidian/ntfy switches.
- Model replies that report `length`, `max_output_tokens`, or `incomplete`, or end with strongly unfinished Markdown/sentences, are continued up to two times and overlap-merged. A reply that remains incomplete is kept resumable instead of being marked complete; actionable final answers receive local recommendation-button fallbacks without a hidden model call.
- Up to three recent sessions that were still running when Obsidian or Cancip exited are recovered before scheduled automation scanning starts. Interrupted runs of the same automation are deduplicated by task id/title so restart does not launch a replacement session; manual stops and ordinary failures remain user-controlled.
- Mobile send submission now happens before keyboard blur can move the floating composer, so one tap sends instead of only dismissing the keyboard.
- File Explorer pinning now supports mixed files/folders, explicit up/down controls, drag sorting, and reliable unpinning from the normal context menu.
- Native Review now includes AI changes to `.cancip/config.json`, top-level Obsidian JSON config, and installed plugin `main.js`, `manifest.json`, `styles.css`, and `data.json`, while sessions, indexes, logs, caches, and Review packages remain excluded.

## Build

```bash
npm install
npm run check
npm run build
```

Build output is written to:

```text
outputs/cancip/
```

## Smoke Tests

Reusable Cancip regression cases live in:

```text
tests/cancip-regression-cases.json
```

The default smoke test is read-only and does not call the model API. It checks prompt economy, memory routing, Skill discovery, command bus access, automation templates, current Obsidian view, and attachment/external-file help:

```bash
npm run smoke
```

Run the normal development gate before committing:

```bash
npm run verify
```

Run the broader read-only command set. This still excludes the heavy UI button customization/sorting cases so the full command/memory gate does not inherit mobile-menu timeout noise:

```bash
npm run smoke:full
```

Run the heavier UI button customization/sorting checks separately. These tests exercise native menu snapshots and mobile-style sortable overlays, so they are intentionally outside both the default core smoke path and the broader command/memory smoke path. The UI profile fails fast on transport timeouts because one stale Obsidian eval can cascade into several false failures:

```bash
npm run smoke:ui
```

Every smoke run writes a timestamped report plus `reports/cancip-smoke-latest.json`. The latest report contains failed case ids, group counts, and next-action recommendations so another agent or Cancip itself can resume from the smallest failing surface.

Optional write/config tests create temporary files under `.cancip/test-lab` and then clean them up. Run them only when Vault write tests are intentionally allowed:

```bash
npm run smoke:write
```

If Obsidian CLI connectivity is stale after a crashed UI smoke, restart Obsidian and rerun the focused case. The smoke script now fails fast and writes a report instead of hanging when both eval transports fail:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/run-cancip-smoke.ps1 -Case memory -FailFast
```

Useful direct PowerShell filters:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/run-cancip-smoke.ps1 -Case memory
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/run-cancip-smoke.ps1 -Full -Case command
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/run-cancip-smoke.ps1 -Full -Case ui-button
```

## Install

Copy these files into an Obsidian community plugin folder named `cancip`:

```text
manifest.json
main.js
prime-tts-worker.js
styles.css
versions.json
README.md
extras/code-1.jpg
extras/code-2.png
```

Then enable `Cancip` in Obsidian.

## TTS packages

Cancip supports multiple TTS routes:

- `auto`: picks a route by language and availability.
- `web-speech`: browser/WebView speech synthesis, useful for English when Android WebView exposes voices.
- `android-system`: native/system bridge route, used only when the Obsidian mobile environment exposes one.
- `builtin-prime-tts`: optional local ONNX package route.
- `custom-url`: trusted local/private TTS bridge route.

English is intentionally lightweight by default: `auto` tries Web Speech, Android/system, and custom URL before the local package. A local package is not required for ordinary English reading.

Chinese uses the current default downloadable local package when available:

```text
tts/prime-tts/acoustic_encoder.onnx
tts/prime-tts/acoustic_decoder.onnx
tts/prime-tts/vocoder.onnx
tts/prime-tts/meta.json
tts/prime-tts/symbol_table.json
tts/prime-tts/ort/ort-wasm-simd-threaded.mjs
tts/prime-tts/ort/ort-wasm-simd-threaded.wasm
```

The official review-clean plugin release ships only the core plugin files. Model/WASM assets are not bundled in the core release. Cancip downloads the default package only when the local install command/button is used, or when `builtin-prime-tts` is selected and the package is missing.

The default downloadable package is:

```text
https://github.com/arias007/obsidian-cancip-ai/releases/download/prime-tts/prime-tts.zip
```

The zip may contain the files at the archive root or inside one top-level folder such as `prime-tts/` or `prime-tts-zh-en/`.

Compatible packages for other languages can be installed as:

```text
tts/<package-id>/acoustic_encoder.onnx
tts/<package-id>/acoustic_decoder.onnx
tts/<package-id>/vocoder.onnx
tts/<package-id>/meta.json
tts/<package-id>/symbol_table.json
tts/<package-id>/ort/ort-wasm-simd-threaded.mjs
tts/<package-id>/ort/ort-wasm-simd-threaded.wasm
tts/<package-id>/manifest.json
```

Manifest example:

```json
{
  "engine": "prime-tts",
  "id": "prime-tts-ja",
  "label": "PrimeTTS Japanese package",
  "languages": ["ja-JP", "ja"],
  "notes": "Compatible ONNX PrimeTTS package."
}
```

When Cancip language is Japanese, Russian, Turkish, Uyghur, Korean, Spanish, French, German, Arabic, or another supported UI language, `auto` first checks whether an installed compatible local package declares that language. If not, Cancip falls back to system/Web/custom URL instead of pretending the bundled Chinese package can speak that language.

Use `cancip.tts.probe` to inspect the current route, selected package, installed compatible packages, and fallback reason. If the folder is missing or incomplete, Cancip reports that directly.

## Config

Cancip reads and writes:

```text
.cancip/config.json
```

On startup, `.cancip/config.json` wins over plugin `data.json` and the settings UI. Settings changed in the UI are saved back to both places.

API settings are stored in `apiProfiles`; the active profile is mirrored to the legacy `apiUrl`, `apiKey`, `apiMode`, and `model` fields for compatibility.

Do not commit or share `.cancip/config.json` if it contains an API key.

## Session Export

Use the history icon in the chat header to reload recent conversations. Cancip saves lightweight JSON session history under:

```text
.cancip/sessions/
```

Use the download icon to export the current conversation as a handoff/archive snapshot.

Cancip writes two files under:

```text
AI/Cancip/Exports/
```

The Markdown export is for reading and handoff to another agent. The JSON export preserves structured data:

- message ids, roles, timestamps, and full message text
- per-turn system prompt and context text actually sent to the model
- source hits attached to user messages
- current mode and access mode
- active API profile name/mode/model
- draft context currently attached to the composer
- key configuration booleans such as whether an API URL/key or GitHub token is configured
- tool run status, action summaries, results, and errors

The export intentionally does not include plaintext API keys or GitHub tokens.

## Command Bus

## 2.5.5

- Daily automations created after today's scheduled instant wait for the next scheduled day; opening Obsidian later can still catch up a genuinely missed run.
- Every model response carries hidden `continue` or `final` control metadata. Cancip no longer treats ordinary prose or a preparation plan as a final answer.
- Simple tasks may finish with a direct short answer. Complex tasks keep process updates folded, continue through actions and verification, and finish with a compact total-detail-total answer.
- Ordinary chat, tool continuation, approval continuation, and prompt/model-backed automations share the same structured completion gate. Missing or invalid control metadata is retried with a bounded correction prompt.
- Elapsed time, token usage, changed-file links, and verification facts remain programmatic; the model controls the useful visible conclusion and optional recommendations.

## 2.5.4

- Keeps the mobile composer and `@` panel attached to the Android visual keyboard viewport.
- Expands `@` discovery to installed plugins, automation instances, attachments, Skills, tools, functions, and Obsidian commands.
- Keeps the review panel above the mobile status bar and renders structure changes as a compact type plus `old -> new` route.
- Treats only manually created Markdown files as automatic new-file curation candidates; Cancip-created review items are excluded programmatically.
- Adds reciprocal links only for strongly related, currently unlinked notes, writes short property-only link summaries when useful, and skips clean notes that do not need curation.

Cancip treats command execution like a CLI surface inside the vault, but the executable layer is structured and auditable instead of raw string eval.

Example:

````text
```cancip-action
{"actions":[{"type":"command","command":"obsidian.listCommands","args":{"query":"file","limit":20}}]}
```
````

Plan todo example:

````text
```cancip-action
{"actions":[{"type":"todo","op":"set","items":[{"text":"Inspect relevant files"},{"text":"Apply the patch"},{"text":"Run verification"}]}]}
```
````

Currently supported command names:

- `obsidian.listCommands`: list Obsidian internal command ids from `app.commands.commands`.
- `obsidian.resolveCommand`: resolve a fuzzy command name, translated label, or id into exact Obsidian command candidates.
- `obsidian.execute`: execute an Obsidian command by exact id or high-confidence fuzzy name, for example `{"id":"app:open-settings"}` or `{"query":"open command palette"}`.
- `obsidian.js.help`, `obsidian.js.probe`: inspect the Obsidian JS bridge before writing glue code. The probe reports active file/view, loaded plugin ids, command count, and helper methods.
- `obsidian.eval`: execute explicit Obsidian app/workspace/vault/plugin JavaScript in the current WebView. Aliases `obsidian.js`, `js.eval`, `javascript.eval`, and `browser.eval` route here. Use `args.code`, `args.script`, `args.js`, `args.body`, or `args.expression`. Available variables include `app`, `workspace`, `vault`, `metadataCache`, `activeDocument`, `window`, `args`, `plugins`, `activeFile`, `activeLeaf`, `activeView`, and `helpers.plugin/api/runCommand/openPath/notice/query/click/input/sleep/snapshot`.
- `obsidian.files.pins`, `obsidian.files.pin`, `obsidian.files.unpin`, `obsidian.files.movePin`, `obsidian.files.reorderPins`: inspect and change the native File Explorer's folder-local pinned-file order by full Vault path.
- `cancip.pluginCapabilities`: inspect installed plugin capability routes by plugin name or feature words, including commands, runtime API surface, plugin files/settings, UI/API/config/web route hints, e.g. `{"query":"notedraw 涂鸦 高亮"}`.
- `cancip.pluginRoute`: generic plugin auto-adapter discovery for current or newly installed plugins. It summarizes commands, public API methods, settings/files, UI routes, and exact `pluginAction` examples.
- `cancip.pluginAction`: execute a plugin command or public API method after discovery, e.g. `{"pluginId":"plugin-id","commandQuery":"open panel"}` or `{"pluginId":"plugin-id","target":"api","method":"methodName","params":[]}`. Access mode controls approval/full-access execution.
- `cancip.annotate.help`, `cancip.annotate.note`, `cancip.annotate.pdf`: programmatic note/PDF annotation routes for NoteDraw/Pdftion-style highlighting, drawing, text, covers, exports, and active selection operations.
- `cancip.study.help`, `cancip.study.review`: spaced-repetition routes for review queue, active-note flashcards, all due cards, cram review, and note-review ratings.
- `cancip.rebuildIndex`: refresh Cancip's lightweight vault index.
- `cancip.searchAll`: search all indexed Vault/Cancip sources. Hard search always runs first; optional args include `softQueries`, `includeArchived`, `includeConfigs`, and `limit`. `cancip.searchVault` remains a compatibility alias to the same engine.
- `cancip.search.status`, `cancip.search.rebuild`: inspect the persistent universal-search index or rebuild it. Full rebuild is effectful and can take time on large Vaults.
- `cancip.archive.status`, `cancip.archive.run`, `cancip.archive.restore`: inspect cold-storage counts, run the 30-day maintenance pass, or restore a cold session by `sessionId`.
- `cancip.reviewGate`: programmatically build native Cancip audit-panel data. Example args: `{"paths":["Folder/Note.md"],"maxFiles":20}` or `{"items":[{"path":"Note.md","old_text":"...","new_text":"..."}]}`.
- `cancip.reviewGate.list`: list recent review data packages under `AI/Cancip/Review/`.
- `cancip.previewVaultSearch`: preview local Vault Search results.
- `cancip.localVersionCommit`: create a manual lightweight local version commit.
- `cancip.vaultDailyReport`: generate a read-only Vault maintenance and merge-candidate daily report.
- `cancip.automation.templates`: list built-in local automation presets.
- `cancip.automation.addTemplate`: add a built-in preset, e.g. `{"id":"auto-review-gate-current-vault"}`.
- `cancip.automation.addVaultDailyReport`: add or refresh the daily Vault maintenance report automation.
- `cancip.automation.addVaultCuration`: add or refresh the unified Vault curation automation. It keeps new/recent Markdown notes and old/specified-scope notes in separate lanes, then runs beautify/refactor, properties/tags/summaries/links, and file renaming as needed. New notes are scanned by the plugin before the model call and passed as a concrete candidate pack; specified files/folders become a strong-scope lane that the model must read and act on instead of doing vague full-vault scanning. Cancip also installs `.cancip/skills/vault-curation-specified-scope.skill.md` as a built-in strong Skill for explicit file/folder curation.
- `todo` action type: maintain the current session's visible Plan todos. Supported operations are `set`, `add`, `update`, `remove`, `list`, and `clear`.
- `github.help`: list mobile GitHub command targets.
- `github.repo`: show repository status from GitHub REST.
- `github.issues`: list issues, e.g. `{"state":"open","limit":10}`.
- `github.pulls`: list pull requests.
- `github.releases`: list releases.
- `github.workflowRuns`: list GitHub Actions runs.
- `github.branches`: list branches.
- `github.file`: read a repository file or directory via Contents API, e.g. `{"path":"README.md"}`.
- `github.createIssue`: create an issue with `{"title":"...","body":"..."}`; requires a GitHub token.

JS boundary: this is an Obsidian WebView/API bridge, not an OS shell. `obsidian.js.help/probe` are read-only. `obsidian.eval` and aliases are effect-capable and follow Cancip access mode: confirmation mode queues Approve/Reject, while full-access executes directly.

GitHub settings live in the advanced Command bus group and mirror to `.cancip/config.json`:

```json
{
  "githubApiBaseUrl": "https://api.github.com",
  "githubOwner": "arias007",
  "githubRepo": "obsidian-cancip-ai",
  "githubToken": "",
  "autoContinueAfterTools": true,
  "maxToolIterations": 3
}
```

Use the official API or a trusted self-owned relay; do not send GitHub tokens through public accelerators.

`autoContinueAfterTools` controls whether completed tool runs are sent back to the model for another reasoning step. `maxToolIterations` caps the loop so a bad prompt cannot run forever.

## Roadmap

- Product target: mobile-first AI agent for an Obsidian vault, not a whole-device
  remote-control assistant.
- Keep the core boundary vault-scoped: Cancip can control vault files, `.cancip`
  config, configured project workspaces, GitHub, and plugin build/install
  workflows, but should not control the entire device.
- Absorb Smart Composer's Obsidian-native chat UX: file chips, current-file context, vault chat, tool visibility, and compact mobile controls.
- Keep a clear frontend interaction model: command bar, access-mode selector, project/session list, plan feature, and action transparency.
- Build the backend toward a local-first agent runtime with code actions, OpenClaw-style tool routing, and Hermes-style memory/workflow patterns.
- Support GitHub management from mobile: status, issues, branches, commits,
  pushes, PRs, releases, workflow results, and a safe API acceleration layer
  with credential redaction.
- Expand the command bus into the main backend interface: Obsidian commands,
  Cancip tools, plugin/skill tools, GitHub CLI-equivalent commands, and the
  Obsidian JS bridge should all connect to the AI through named, reviewable
  command actions.
- Continue expanding lightweight local versioning: restore/diff UI, retention,
  and GitHub sync from `.cancip/versions/`.
- Support Obsidian plugin building/adaptation: source-first TypeScript/CSS
  changes, build/package/install loops, and built-JS patching only as a
  fallback.

See [docs/VISION.md](docs/VISION.md) for the detailed product boundary and
architecture direction.
See [docs/GITHUB_AND_VERSIONING.md](docs/GITHUB_AND_VERSIONING.md) for the
mobile GitHub and local versioning design.


## 2.6.8

- Review now filters Cancip's own review/export artifacts out of pending visible-note review lists, keeps the mobile review tree/detail panels scrollable above the status bar, and avoids stale internal files inflating review counts.
- Mobile chat keyboard handling uses both visual viewport shrinkage and direct footer overlap, so the composer and @ panel follow the Android keyboard more reliably.
- Session history omits created/last-activity rows from the list details, while individual chat messages show exact timestamps for task replay.
- Process records now auto-expand only for the currently running turn, fold structured raw details, and filter Cancip-generated progress filler such as generic "continue from result" messages.


## 2.6.9

- Internal review-gate JSON/JSONL now writes to the hidden `.cancip/review-gates` store by default instead of the visible `AI/Cancip/Review` note tree.
- Startup migrates legacy visible Cancip review JSON and session export JSON into hidden internal folders, then removes only the old internal JSON files when safe.
- Review package lookup accepts old visible paths but canonicalizes them to hidden paths, so old sessions and pending approvals keep working without recreating visible JSON.
- Session export keeps the human Markdown export visible and stores the machine JSON snapshot under `.cancip/exports`.


## 2.6.10

- Chat/session display times now show local seconds without the `+08:00` suffix.
- Mobile composer footer records visual-viewport bottom/side offsets and fixes the input box above the Android keyboard while focused.
- Mobile Review Gate constrains the outer shell above the Obsidian status bar and lets the file tree, diff body, and detail rail own their vertical scrolling.
