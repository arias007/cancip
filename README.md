# Cancip

Obsidian right-side AI chat panel shaped toward a Codex / Claude Code workflow.

Cancip is a lightweight prototype for managing an Obsidian vault from a mobile-friendly AI panel:

- API URL/key/model connection.
- Automatic OpenAI Responses and OpenAI-compatible Chat Completions support.
- `.cancip/config.json` as the authoritative vault-level config.
- `ask-for-approval` and `full-access` modes.
- Current note, selection, `@file` mentions, core memory folder, and lightweight Vault Search context.
- `cancip-action` JSON tool blocks for validated vault-relative actions.

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
```

Then enable `Cancip` in Obsidian.

## Config

Cancip reads and writes:

```text
.cancip/config.json
```

On startup, `.cancip/config.json` wins over plugin `data.json` and the settings UI. Settings changed in the UI are saved back to both places.

Do not commit or share `.cancip/config.json` if it contains an API key.

## Roadmap

- Render assistant replies as Obsidian Markdown, including Obsidian-supported HTML.
- Absorb Smart Composer's Obsidian-native chat UX: file chips, current-file context, vault chat, tool visibility, and compact mobile controls.
- Absorb Codex's frontend interaction model: command bar, access-mode selector, project/session list, plan mode, and action transparency.
- Build the backend toward a local-first agent runtime inspired by Codex, Claude Code-style code actions, OpenClaw-style tool routing, and Hermes-style memory/workflow patterns.
