# Cancip GitHub and Versioning Design

Cancip should make GitHub and vault versioning usable from a phone without
requiring native `git` or `gh` binaries.

## Decision

Use an API-first design:

- GitHub management is implemented through GitHub REST and GraphQL APIs.
- Local versioning is implemented as lightweight vault snapshots under
  `.cancip/versions/`.
- Optional GitHub acceleration is a configurable request layer, not a public
  proxy that receives secrets by default.

Obsidian mobile plugins cannot depend on native command-line tools. Treat the
GitHub CLI as a feature map, not as a runtime dependency.

## GitHub Acceleration

The safe mobile approach:

1. Default to official GitHub endpoints.
2. Add retry, timeout, pagination, rate-limit display, and offline queueing.
3. Allow a user-controlled accelerator endpoint for GitHub API requests.
4. Never send tokens through public proxy mirrors.
5. Allow public unauthenticated asset downloads to use a mirror only when no
   credential is attached.

Recommended configuration:

```json
{
  "github": {
    "apiBaseUrl": "https://api.github.com",
    "graphqlUrl": "https://api.github.com/graphql",
    "webBaseUrl": "https://github.com",
    "acceleratorBaseUrl": "",
    "allowAcceleratorWithToken": false
  }
}
```

If acceleration is needed on mobile, the best route is a small user-owned relay
such as Cloudflare Worker, Vercel Edge Function, or a personal server. Cancip
should support it by letting the user set `acceleratorBaseUrl`. The relay must
be transparent and private: no logging of `Authorization`, no token rewriting,
and no shared public endpoint.

## GitHub CLI Feature Map

Cancip should provide a command palette and chat actions shaped like `gh`, but
implemented through API calls:

- `gh repo`: list/view/create/fork/archive settings where API permits.
- `gh issue`: list/view/create/comment/close/reopen/edit.
- `gh pr`: list/view/create/comment/review/merge/close.
- `gh release`: list/view/create/upload/delete assets.
- `gh workflow/run`: list workflows, dispatch runs, view logs/status.
- `gh api`: raw REST/GraphQL request mode for advanced users.
- `gh gist`, `gh search`, `gh label`, `gh milestone`: later modules.

The raw `gh api` equivalent is important because it gives near-full GitHub CLI
coverage without duplicating every command first.

## Git Commits Without Local Git

For remote GitHub commits, use GitHub Git database APIs:

1. Read branch ref.
2. Read current commit and tree.
3. Create blobs for changed text files.
4. Create a new tree from the base tree.
5. Create a commit with the previous commit as parent.
6. Update the branch ref.

This gives real Git commits from mobile without a local `.git` checkout.

## Local Versioning

Local versioning should not record every keystroke. It should be deliberate and
cheap:

- Manual commit: user taps a button or uses `@commit`.
- Daily auto commit: once per day, after Obsidian is open and idle.
- No per-edit history watcher.
- Text-first: Markdown, JSON, YAML, Canvas, source files.
- Default exclusions: `.cancip/config.json`, `.cancip/versions/**`,
  `.obsidian/**`, large binaries, cache folders.

Suggested layout:

```text
.cancip/
  versions/
    index.json
    commits/
      2026-06-15T04-30-00Z/
        commit.json
        files/
          <encoded vault path>.txt
```

`commit.json`:

```json
{
  "id": "2026-06-15T04-30-00Z",
  "kind": "daily",
  "message": "daily snapshot",
  "createdAt": "2026-06-15T04:30:00Z",
  "fileCount": 12,
  "files": [
    {
      "path": "Notes/example.md",
      "size": 1234,
      "mtime": 1781500000000,
      "hash": "sha256..."
    }
  ]
}
```

Only changed files since the previous local commit should be copied. Large files
should be listed in the manifest but not copied unless the user explicitly
allows it.

## UX

Add a Version/GitHub area to Cancip:

- Status: dirty count, last local commit, last GitHub sync, rate-limit status.
- Manual commit button.
- Daily auto commit toggle and time window.
- GitHub repo selector.
- GitHub actions list shaped like `gh`.
- Raw `gh api` equivalent for advanced operations.

Mention picker entries:

- `@commit`: manual local commit.
- `@daily`: daily commit settings/status.
- `@github`: GitHub dashboard.
- `@gh api`: raw API mode.
- `@issue`, `@pr`, `@release`, `@workflow`: GitHub modules.

## Safety

- `ask-for-approval`: show changed file list and commit message before local
  commit, GitHub commit, push, release, PR merge, issue close, or workflow
  dispatch.
- `full-access`: daily local commits may run automatically; GitHub writes still
  need an audit record and should default to confirmation until the user
  explicitly enables trusted repo automation.
- Never display token values in chat.
- Prefer fine-grained GitHub tokens or GitHub App tokens with minimum required
  scopes.

## Implementation Slices

1. Local version manager: manual commit, daily commit, status, exclusions. Implemented in `0.1.10` for manual commits and daily snapshots under `.cancip/versions/`; `0.1.11` excludes sensitive token/password/credential/recovery/config-like paths from version snapshots. Restore/diff UI is still pending.
2. GitHub read-only dashboard: repo/status/issues/PRs/releases/workflows.
3. GitHub raw API action: `gh api` equivalent with safe redaction.
4. Remote commit through Git database API.
5. Pull request/release/workflow write actions.
6. Optional user-owned accelerator relay template.
