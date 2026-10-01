# Rove (repository/package compatibility name: kobe)

Rove is a local-first terminal UI for running many AI coding sessions at once — Conductor's multi-task shape made terminal-native with git worktrees and local engine processes. A managed Task = git worktree + branch + terminal tabs; project-main and directory Tasks reuse an existing checkout or directory and own no worktree or branch. The TUI is the product; engine adapters (Claude Code default, Codex behind the same engine-owned contract) are execution backends.

This file is boundaries and orientation only. Read what the task needs:
- [`HANDOFF.md`](./HANDOFF.md) — last local handoff (gitignored, may be absent). Check its date: an old one describes shipped work.
- [`docs/DESIGN.md`](./docs/DESIGN.md) decisions + stack lock-in · [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) source map, ownership, `refs/` (§7) · [`docs/HARNESS.md`](./docs/HARNESS.md) self-test contract (**load-bearing**) · [`docs/KEYBINDINGS.md`](./docs/KEYBINDINGS.md) before any chord · [`docs/agents/dev-loop.md`](./docs/agents/dev-loop.md) test runners, dev scripts, daemon, engine-data, layout, file-size mechanics.
- Version and shipped behavior: [`packages/kobe/package.json`](./packages/kobe/package.json), [`packages/kobe/CHANGELOG.md`](./packages/kobe/CHANGELOG.md) (over 1 MB: grep it or read the newest entries).

Docs are the source of truth. **If docs and implementation disagree, surface the mismatch before widening scope.**

## Orientation

- Bun-workspace monorepo under `packages/`: `kobe/` (TUI/CLI, published `@sma1lboy/rove`), `kobe-daemon/`, `kobe-harness/` (`/harness` + PTY sidecar), `branding/` (Remotion), `kobe-docs/` (docs site). Unqualified `src/…`/`test/…` paths mean `packages/kobe/`.
- **Three test runners; the wrong one looks like a broken environment:** `test/render/**` → `bun test`, `test/daemon/**` → `bun run test:socket` (plain vitest *silently* finds no files), everything else → vitest. `vi.hoisted is not a function` = wrong runner. Details: [`docs/agents/dev-loop.md`](./docs/agents/dev-loop.md).
- Develop with `dev:sandbox` (throwaway Rove state), never `dev`, so you don't touch the real `~/.rove/tasks.json`.
- **Tech stack is locked:** TypeScript + `@opentui/core` + `@opentui/react` + React 19 + Bun. Do not re-litigate. React is the only UI; orchestrator/client reactivity is framework-free observable state.
- **One visual ground truth:** fixed-viewport browser `/harness` → xterm.js → PTY sidecar → real OpenTUI. Not Terminal screenshots, render-test output, or mocks. Live-state bugs: drive a REAL engine through the browser's xterm and read `rove api inspect`. Every PR touching UI source keeps the template's **UI evidence** section with before/after harness screenshots (bugs and refactors too), or `ui-evidence: none — <reason>` when no frame can change. See [`docs/HARNESS.md`](./docs/HARNESS.md).
- **After editing daemon/orchestrator/engine code, `rove daemon restart`** — Bun doesn't hot-reload. Debug from `<ROVE_HOME>/.rove/daemon.log` first.
- `refs/` is gitignored and **read-only**; clone list and use in [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) §7.
- Changing config keys, CLI or `rove api` verbs, engine support, worktree safety, or session/persistence behavior → update the matching `docs/` page in the same PR. A new user-facing page must be added to `SECTIONS` in [`packages/kobe-docs/scripts/sync-docs.mjs`](./packages/kobe-docs/scripts/sync-docs.mjs) or it never reaches docs.rove.run.
- Respond in the user's language. Don't assume their name.

## Work tracking — local only

No Linear. Backlog: daemon issue store (`rove api issue-*`, [`docs/WORK-TRACKING.md`](./docs/WORK-TRACKING.md)). Shipped: CHANGELOG, one Changeset per change ([`docs/RELEASING.md`](./docs/RELEASING.md)). Risks: `HANDOFF.md`. Decisions: `docs/`. Surface before filing anything externally.

## Hard rules

### How work lands on `main`
- **Default: PR → merge → release, none of it needs fresh approval.** Feature branch → commits → `gh pr create` → CI green (typecheck/test, behavior, file-size-cap, coverage-cap) → `gh pr merge --squash --delete-branch`. Green CI IS the gate. Cut the release the same turn unless the change is mid-stack or the owner is still deciding — a fix nobody can install isn't fixed. (Standing authorization, owner 2026-09-01.)
- **Skipping the PR** (local merge/cherry-pick into `main`, or a direct push) needs the owner to say so **in that turn** — never inferred, never carried over. Same quality gates either way.
- `scripts/release.sh` pushes its own `chore: release — X.Y.Z` commit + tag.
- `git fetch` before pushing. Force-push ONLY your own unmerged PR branch, with `--force-with-lease`; never `main`, a shared branch, or reviewed commits.

### Commits and releases
- Commit at the end of each green stream (pre-authorized). Message: `<type>: <summary>` + a 2-3 sentence body.
- **NEVER** add `Co-Authored-By: Claude` / any AI/Anthropic/Claude/Codex/tool attribution or "Generated with" footers — commits, tags, release notes. Thanking human contributors is fine.
- **NEVER** use `--no-verify` / `--no-gpg-sign` or skip hooks. Fix the underlying issue.
- **Changeset bump is `patch` by default.** Only an EXPLICIT instruction that turn promotes it to `minor`/`major`. A pending changeset with a bigger bump overrides you: check before tagging and surface it.

### Deletion
- **NEVER** delete files, branches, worktrees, or run `rm -rf` unless the user explicitly says "delete"/"remove" *in the same turn* — including stale-worktree cleanup. Surface and ask first.

### Scope
- Edit only files within the declared slice; surface cross-slice changes.
- 3-strike rule: same root cause fails 3× → stop and surface. 3+ levels of sub-investigation → surface first.
- Fixing one subcommand/file? Confirm whether every similar case needs it before calling it done.
- A file over ~500 lines is a refactor prompt: growing one means you own splitting it along a named seam (or saying in the PR there is none). Mechanics: [`docs/agents/dev-loop.md`](./docs/agents/dev-loop.md).

### Don't touch
`refs/` (read-only forever), other agents' worktree slices (coordinate via the orchestrator), workspace-level config (`/Users/jacksonc/i/CLAUDE.md`, global git config).

### Keybindings: every NEW or MOVED chord needs owner sign-off
Ship a new chord only as PROPOSED and surface it. Record each decision and reason in `docs/design/keybinding-decisions.md`; update the tables in `docs/KEYBINDINGS.md` when defaults change.

### Layout: flex-first, hardcode last
Yoga flexbox: panes share width by ratio (`flexGrow`), not pixels. Fixed `width={N}`/`height={N}` only for a documented convention, a fixed terminal glyph, or a modal. Avoid `height="100%"`.

### Engine-owned UI data
The engine adapter owns agent/product identity, capabilities, history, and telemetry. Neutral layers (TUI, web, orchestrator) never hard-code Claude/Codex strings or derive vendor metrics. A new pane needing engine-specific data → extend the engine contract first. Specifics: [`docs/agents/dev-loop.md`](./docs/agents/dev-loop.md).

### Diagrams in `docs/`: Mermaid
` ```mermaid ` fences; ASCII only for ≤3 nodes with no states.

### Tests: pin behavior, not implementation
Test a bug that happened, a boundary users hit, or a contract other code relies on — one test per behavior, at the highest level that can see it. Don't test constants against copies, re-exports, shapes `tsc` checks, mock-was-called with no observable outcome, or the same behavior twice.

### Comments and PR text: short
- A comment says what the code can't: an invariant, an ordering constraint, a non-obvious why. One line by default.
- Never in code: history (`used to`, `pre-fix`), PR/issue numbers, dates, tours of sibling files, the code restated.
- PR body: what changed + the evidence, ≤150 words outside screenshots and code blocks.

## Agent skills

Skill flows (`to-issues`/`triage`/`to-prd`/`qa`) write scratch to gitignored `.scratch/<feature>/`. The daemon issue store is the backlog; GitHub Issues are inbound user reports only. Mechanics: [`docs/agents/`](./docs/agents/).

## Maintaining this file

Loaded whole into every session and subagent: **budget 2.5k tokens** (~9KB, `wc -c AGENTS.md`). Zero-sum — a new rule names what it replaces or moves mechanics to `docs/agents/dev-loop.md`. Broad (>1 session in 5) or safety-critical → here; narrow with a trigger → `.claude/skills/`; mechanics → `docs/`. Add a rule only after the same mistake shows up in two sessions. No archaeology.
