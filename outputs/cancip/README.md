# Cancip

Obsidian right-side AI chat panel shaped toward a mobile-first agent workflow.

Cancip is a lightweight prototype for managing an Obsidian vault from a mobile-friendly AI panel:

- Multiple API profiles, each with its own Base URL, key, API mode, and model.
- Multilingual UI with auto device-language detection for Simplified Chinese, Traditional Chinese, English, Uyghur, Turkish, Russian, Japanese, Korean, Spanish, French, German, and Arabic; missing low-frequency strings fall back to English, and Arabic/Uyghur use RTL layout hints.
- Automatic OpenAI Responses and OpenAI-compatible Chat Completions support.
- `.cancip/config.json` as the authoritative vault-level config.
- Two execution access modes only: confirmation mode reads freely and queues write-like actions for approval; full-access mode executes implemented actions directly. Access is controlled only by the UI or `.cancip/config.json`, not by conversation text.
- Current note, selection, dynamic `@` mentions, visible long-term/core memory folder, and on-demand Vault Search.
- `cancip-action` JSON tool blocks for validated vault-relative actions, including read/write/append/patch/mkdir/rename/copy.
- Agent-style tool runs: approval mode queues action blocks under the assistant message with Run/Reject controls, while Full access executes and records results.
- Tool result continuation loop: after tools finish, Cancip can feed results back into the model and continue for a bounded number of iterations, closer to local agent runs.
- Structured command bus actions for Obsidian internal commands, Cancip built-ins, and GitHub CLI-equivalent REST API commands.
- Obsidian-native Markdown rendering for chat messages, including Obsidian-supported HTML.
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
- On-demand Vault Search hits are metadata-only source suggestions until the agent explicitly reads selected files. They are not added to the composer chip row or model `contextText` by default. Exports keep the real full session snapshot, so the exported `contextText` is the authoritative record of what was sent as context.
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
- Completed multi-step workflows are harvested only after at least two successful tool actions. The verified action sequence and final result feed the generated experience Skill so similar future tasks can route to a concrete prior workflow instead of repeating broad discovery.
- Completion now requires a real user-visible final answer after process/tool work. Missing or process-only closure retries up to five times, then remains resumable instead of being stored as a false completion. Running and completed sessions broadcast disk-backed updates to every open view of the same session so background/foreground transitions preserve their correct shape.
- PrimeTTS uses paired source/spoken chunks: the source chunk keeps original digits for display/highlight, while the spoken chunk applies language-aware number conversion. Chinese chunks use word segmentation without splitting ordinary words, adjacent English words stay together and use the system English voice when available, and decoded look-ahead is widened to reduce playback gaps.
- Button rules store view, command, icon, stable target identity, creation time, and modification time. Recently changed buttons sort first in settings. Menu insertion applies rules only to the newly mounted menu subtree and runs one short subtree-only trailing pass; full refreshes cache repeated scope/selector queries. Observers and timers follow each live Obsidian document/WebView, ignore unrelated body/container class churn, and react only to actual editable buttons/menu/status items/tab headers; internal DOM writes never re-enter the queue, and stable menu-group/name identity prevents adjacent-item cross-application.
- Lightweight local versioning under `.cancip/versions/`: manual commits and one daily auto snapshot, without native git and without per-edit history.
- Built-in local automation templates for non-desktop agent tasks: review-gate package generation, local capability-pack import, lightweight local version snapshots, GitHub status checks, vault index refresh, a daily read-only Vault maintenance/merge-candidate report, and a unified Vault curation task with programmatic new/recent-note scan packs plus explicit file/folder strong-scope lanes for beautify/refactor, properties/tags/summaries/links, and renaming.
- New-file curation runs in an isolated session with a stable minimal prompt prefix. A programmatic preflight skips clean short notes without an API request, sends bounded full text for at most four meaningful candidates, leaves deferred candidates queued, and rejects writes whose only effect is whitespace, blank lines, punctuation, heading markers, or other cosmetic Markdown syntax.
- TTS is provider-routed by language. English defaults to Web Speech / system TTS and does not need a local model package. Chinese can auto-download and use the current compact PrimeTTS Chinese/English ONNX package. Other languages use system/Web/custom URL unless a compatible local PrimeTTS package is installed under `tts/<package>/` with a manifest.

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
https://github.com/arias007/cancip/releases/download/prime-tts/prime-tts.zip
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
- Adds reciprocal links only for strongly related, currently unlinked notes, and skips clean notes that do not need curation.

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
- `cancip.pluginCapabilities`: inspect installed plugin capability routes by plugin name or feature words, including commands, runtime API surface, plugin files/settings, UI/API/config/web route hints, e.g. `{"query":"notedraw 涂鸦 高亮"}`.
- `cancip.pluginRoute`: generic plugin auto-adapter discovery for current or newly installed plugins. It summarizes commands, public API methods, settings/files, UI routes, and exact `pluginAction` examples.
- `cancip.pluginAction`: execute a plugin command or public API method after discovery, e.g. `{"pluginId":"plugin-id","commandQuery":"open panel"}` or `{"pluginId":"plugin-id","target":"api","method":"methodName","params":[]}`. Access mode controls approval/full-access execution.
- `cancip.annotate.help`, `cancip.annotate.note`, `cancip.annotate.pdf`: programmatic note/PDF annotation routes for NoteDraw/Pdftion-style highlighting, drawing, text, covers, exports, and active selection operations.
- `cancip.study.help`, `cancip.study.review`: spaced-repetition routes for review queue, active-note flashcards, all due cards, cram review, and note-review ratings.
- `cancip.rebuildIndex`: refresh Cancip's lightweight vault index.
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
  "githubRepo": "cancip",
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
