# Cancip

Obsidian right-side AI chat panel shaped toward a Codex / Claude Code workflow.

Cancip is a lightweight prototype for managing an Obsidian vault from a mobile-friendly AI panel:

- Multiple API profiles, each with its own Base URL, key, API mode, and model.
- Multilingual UI with auto device-language detection for Simplified Chinese, Traditional Chinese, English, Uyghur, Turkish, Russian, Japanese, Korean, Spanish, French, German, and Arabic; missing low-frequency strings fall back to English, and Arabic/Uyghur use RTL layout hints.
- Automatic OpenAI Responses and OpenAI-compatible Chat Completions support.
- `.cancip/config.json` as the authoritative vault-level config.
- Two execution access modes only: confirmation mode reads freely and queues write-like actions for approval; full-access mode executes implemented actions directly. Access is controlled only by the UI or `.cancip/config.json`, not by conversation text.
- Current note, selection, dynamic `@` mentions, visible long-term/core memory folder, and on-demand Vault Search.
- `cancip-action` JSON tool blocks for validated vault-relative actions, including read/write/append/patch/mkdir/rename/copy.
- Codex-style tool runs: approval mode queues action blocks under the assistant message with Run/Reject controls, while Full access executes and records results.
- Tool result continuation loop: after tools finish, Cancip can feed results back into the model and continue for a bounded number of iterations, closer to Codex/Claude Code agent runs.
- Structured command bus actions for Obsidian internal commands, Cancip built-ins, and GitHub CLI-equivalent REST API commands.
- Obsidian-native Markdown rendering for chat messages, including Obsidian-supported HTML.
- Long-term/core memory defaults to visible `AI/Cancip/Memory/` and is included in every model interaction.
- Full-vault search is not attached by default. Cancip should first use long-term memory and necessary short-term/session context, then decide whether to run `cancip.searchVault` and read only the necessary matched files.
- Full session export from the chat header to Markdown and JSON under visible `AI/Cancip/Exports/`.
- Lightweight project session history stays under `.cancip/sessions/`, opened from the compact history button beside the new-chat button.
- Compact context chips live inside the rounded composer/input box: the current active file is shown automatically with its extension, and source/context chips no longer occupy a separate panel.
- Context chips can be opened directly: file chips open the file in a tab, folder chips reveal the folder in the file navigator, and the small `x` removes only that context chip.
- On-demand Vault Search hits are metadata-only source suggestions until the agent explicitly reads selected files. They are not added to the composer chip row or model `contextText` by default. Exports keep the real full session snapshot, so the exported `contextText` is the authoritative record of what was sent as context.
- Codex-style rounded composer with floating upward icon trays for context, access mode, and model selection; trays overlay from their buttons and close after selection or outside taps.
- Header mode controls are reduced to a single Codex-style Plan button. The Plan button toggles a planning/todo layer and opens a floating todo panel; it does not change read/write permission.
- The header includes an OB Review Gate button wired to a programmatic TypeScript builder adapted from `arias007/ob-review-gate-skill`: it scans selected vault files, writes a mobile HTML review package under `AI/Cancip/Review/`, and does not apply note edits by itself.
- Structured Plan todos are available as `cancip-action` tools, so the agent can set/add/update/remove/list/clear the visible Plan panel during an agent run instead of only describing a plan in prose.
- The composer keeps the access selector visible and wider for mobile tapping, with a paperclip attachment button beside it for quickly adding file/folder context.
- Settings keep core items up front and move optional controls into advanced folded groups for interface, context, plan, command bus, local versioning, export, payment QR codes, and advanced model behavior.
- The settings page can show two local payment QR codes at the bottom from `extras/code-1.jpg` and `extras/code-2.png`; the QR images are local plugin resources and are not included in prompts or JSON exports.
- Built-in model presets include GPT, Claude, Gemini, DeepSeek, Qwen, and Kimi-style names while still allowing a custom model string.
- Codex-style `@` picker for files, folders, Skills, Cancip functions, command bus entries, and real Obsidian commands. Empty `@` shows useful entries like modes/current file/recent files/skills; typed text dynamically filters all categories. Selected mentions are inserted as `@[path]`, `@[action:name]`, `@[command:name]`, or `@[obsidian-command:id]`, while hand-typed `@keyword` still resolves by fuzzy match.
- Lightweight local versioning under `.cancip/versions/`: manual commits and one daily auto snapshot, without native git and without per-edit history.
- Built-in local automation templates for non-desktop Codex-style tasks: review-gate package generation, Codex memory import, lightweight local version snapshots, GitHub status checks, and vault index refresh.

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

## Install

Copy these files into an Obsidian community plugin folder named `cancip`:

```text
manifest.json
main.js
styles.css
versions.json
README.md
extras/code-1.jpg
extras/code-2.png
```

Then enable `Cancip` in Obsidian.

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
- `obsidian.execute`: execute an Obsidian command by id, for example `{"id":"app:open-settings"}`.
- `cancip.rebuildIndex`: refresh Cancip's lightweight vault index.
- `cancip.reviewGate`: programmatically build an OB Review Gate package. Example args: `{"paths":["Folder/Note.md"],"maxFiles":20}` or `{"items":[{"path":"Note.md","old_text":"...","new_text":"..."}]}`.
- `cancip.reviewGate.list`: list recent review package index files under `AI/Cancip/Review/`.
- `cancip.sessionInspect`: diagnose a session id across `.cancip/sessions/index.json`, session JSON, and `events.jsonl`, and list nearby candidates when the requested session is missing.
- `cancip.previewVaultSearch`: preview local Vault Search results.
- `cancip.localVersionCommit`: create a manual lightweight local version commit.
- `cancip.automation.templates`: list built-in local automation presets.
- `cancip.automation.addTemplate`: add a built-in preset, e.g. `{"id":"auto-review-gate-current-vault"}`.
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

Raw JavaScript eval commands such as `js.eval`, `javascript.eval`, and `browser.eval` are intentionally blocked for now. Browser/JS-like command capability should be added later as a narrow allowlisted command set.

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

- Product target: mobile-first Codex for an Obsidian vault, not a whole-device
  remote-control assistant.
- Keep the core boundary vault-scoped: Cancip can control vault files, `.cancip`
  config, configured project workspaces, GitHub, and plugin build/install
  workflows, but should not control the entire device.
- Absorb Smart Composer's Obsidian-native chat UX: file chips, current-file context, vault chat, tool visibility, and compact mobile controls.
- Absorb Codex's frontend interaction model: command bar, access-mode selector, project/session list, plan mode, and action transparency.
- Build the backend toward a local-first agent runtime inspired by Codex, Claude Code-style code actions, OpenClaw-style tool routing, and Hermes-style memory/workflow patterns.
- Support GitHub management from mobile: status, issues, branches, commits,
  pushes, PRs, releases, workflow results, and a safe API acceleration layer
  with credential redaction.
- Expand the command bus into the main backend interface: Obsidian commands,
  Cancip tools, plugin/skill tools, GitHub CLI-equivalent commands, and safe
  JS/browser-like commands should all connect to the AI through named,
  reviewable command actions.
- Continue expanding lightweight local versioning: restore/diff UI, retention,
  and GitHub sync from `.cancip/versions/`.
- Support Obsidian plugin building/adaptation: source-first TypeScript/CSS
  changes, build/package/install loops, and built-JS patching only as a
  fallback.

See [docs/VISION.md](docs/VISION.md) for the detailed product boundary and
architecture direction.
See [docs/GITHUB_AND_VERSIONING.md](docs/GITHUB_AND_VERSIONING.md) for the
mobile GitHub and local versioning design.
