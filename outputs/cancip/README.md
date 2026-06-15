# Cancip

Smart Composer-style right sidebar AI chat for Obsidian, reshaped toward a Codex / Claude Code workflow.

## What it does

- Right-side Obsidian `ItemView` chat panel.
- API connection by URL/key/model with automatic support for OpenAI Responses and OpenAI-compatible Chat Completions.
- Robust text extraction for string, array, and object-shaped model responses.
- Auto mode treats empty Responses output as a failed attempt and falls back to OpenAI-compatible Chat Completions.
- Assistant and user messages render through Obsidian MarkdownRenderer, including Obsidian-supported HTML.
- Codex-style rounded composer with embedded `+`, access mode, model, and send controls.
- UI language setting: Auto, Chinese, English.
- Codex-style access mode: Ask for approval or Full access.
- Vault-level `.cancip/config.json` as the primary configuration file.
- `cancip-action` JSON blocks for tool actions: ask mode reports only, full-access mode can execute validated Vault-relative actions.
- Four icon-first modes: Ask, Search, Plan, Edit.
- Context from current note, selected text, dynamic `@` mentions, core memory folder, and lightweight Vault Search.
- Codex-style `@` picker for files, folders, Skills, and Cancip functions; folder mentions include matching text files under that folder.
- Lightweight local versioning under `.cancip/versions/`: manual commits and one daily auto snapshot, without native git and without per-edit history.
- Mobile-friendly UI with bottom composer and compact source panel.
- Safe default: it reads and suggests. It does not automatically delete, move, merge, or rewrite vault files.

## Install

Copy this folder to:

```text
E:/note/.obsidian/plugins/cancip
```

Then enable `Cancip` in Obsidian community plugins.

## Settings

Core settings:

- `Language`: Auto follows the device language; Chinese and English can be forced.
- `Access mode`: `Ask for approval` reports requested tool actions without executing; `Full access` executes validated tool actions for reading/writing the full vault and `.cancip` config.
- `API URL`: base URL or endpoint, for example `https://api.openai.com/v1`, `https://api.openai.com/v1/responses`, or an OpenAI-compatible `/chat/completions` endpoint.
- `API mode`: `Auto` tries Responses first and falls back to OpenAI-compatible Chat Completions. Use `Responses` or `OpenAI-compatible` to force one protocol.
- `API key`: mirrored to `.cancip/config.json` and this plugin's local `data.json`.
- `Model`: model id sent to the endpoint.

Advanced settings are collapsed by default:

- `Temperature`
- `Max output tokens`: default `2048`; sent as `max_output_tokens` for Responses and `max_tokens` for compatible endpoints.
- `Core memory folder`: default `AI/Memory`; Markdown files under it are included as core memory.
- `Max context files`
- `Include current file`
- `Include core memory`
- `Use Vault Search by default`: simple local keyword search across Markdown notes.
- `System prompt`

## Config file

Cancip writes and reads:

```text
.cancip/config.json
```

On startup, `.cancip/config.json` wins over the Obsidian settings UI and plugin `data.json`, similar to how Codex treats project configuration as authoritative. Settings changed in the UI are saved back to both places.

Do not share `.cancip/config.json` if it contains an API key.

## Tool actions

Cancip only considers actions inside an explicit fenced block:

````text
```cancip-action
{"actions":[{"type":"write","path":"Folder/Note.md","content":"..."}]}
```
````

Supported actions in `Full access` mode:

- `read`
- `write`
- `append`
- `mkdir`
- `rename`
- `copy`

Paths must be Vault-relative. Absolute paths, drive-letter paths, URLs, empty paths, and `..` traversal are rejected. Destructive deletion is intentionally not auto-executed in this prototype.

## API modes

- `Responses`: POSTs to `/responses` with `model`, `instructions`, `input`, and `temperature`.
- `OpenAI-compatible`: POSTs to `/chat/completions` with `model`, `temperature`, and `messages`.
- `Auto`: normalizes the URL, tries Responses, then retries with Chat Completions if needed.

## Smart Composer Reference

This is not a fork. The shape follows Smart Composer's proven pattern:

- Register a right-side `ItemView`.
- Open it from ribbon and commands.
- Treat note references and Vault Search as first-class chat context.
- Keep edit actions reviewable instead of silently rewriting notes.

Smart Composer source: https://github.com/glowingjade/obsidian-smart-composer

## GitHub and Versioning Direction

Cancip should manage GitHub from mobile through GitHub REST/GraphQL APIs rather
than native `git` or `gh` binaries. The GitHub CLI is treated as a feature map:
repo, issue, PR, release, workflow, and raw `gh api`-style operations should be
implemented as API-backed Cancip actions.

Local versioning should be lightweight: manual commits and daily auto commits
under `.cancip/versions/`, not per-edit history recording. GitHub acceleration
should default to official endpoints and only use a user-controlled relay for
authenticated requests.
