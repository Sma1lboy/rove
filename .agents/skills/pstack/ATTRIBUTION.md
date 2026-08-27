# Attribution and port notes

## Upstream

**pstack** by Lauren Tan ([poteto](https://x.com/poteto)), MIT licensed.

- Source: <https://github.com/cursor/plugins/tree/main/pstack>
- Marketplace: <https://cursor.com/marketplace/cursor/pstack>
- Ported from upstream v0.14.4 on 2026-08-27.

The MIT license text is in [LICENSE](./LICENSE). Copyright stays with the
original author.

## What was ported

36 skills, unchanged in substance:

- **21 `principle-*` skills.** The core of pstack and the reason to port it.
  Pure prose, zero tooling coupling, so they carried over verbatim.
- **15 general skills**: `unslop`, `technical-writing`, `tdd`, `teach`,
  `typescript-best-practices`, `architect`, `swarm`, `arena`, `interrogate`,
  `how`, `why`, `blast-radius`, `figure-it-out`, `no-comments`,
  `show-me-your-work`.

## What was changed, and why

**Frontmatter.** Cursor's `disable-model-invocation: true` has no Claude Code
equivalent. Replaced with this repo's `metadata:` convention (32 files). No
behavior change: these skills were always meant to be invoked explicitly or by
the entry skill, not auto-fired.

**Model configuration.** Five skills read `~/.cursor/rules/pstack-models.mdc`
to pick models, falling back to Cursor-specific model ids. That file never
exists here, and the fallback ids are not Claude Code's. Rewritten to use the
Agent tool's own `model` parameter and to say *why* a panel should vary its
models (independent blind spots) rather than naming a fixed roster that will
go stale.

Affected: `interrogate`, `swarm`, `arena` (×2), `show-me-your-work`.

**`show-me-your-work` transcript path.** Upstream globs
`~/.cursor/projects/*/`. Rewritten to read only the current run's transcript
if the harness exposes one, and never to glob across sessions — on this
machine that would read other people's private chats.

**`why`'s evidence discovery.** Upstream enumerates Cursor's MCP directory and
maps each server to one of seven categories (issue tracker, long-form docs,
chat, observability, error tracking, warehouse). This repo has none of those
MCPs: its decision record is ADRs, `docs/design/`, the daemon issue store,
`CHANGELOG.md`, `HANDOFF.md`, and wisp — all local. Added
`references/sources/rove-local.md` documenting each with the command that
searches it, registered it in the playbook index, and added it to the
investigator roster as category 0, spawned first and always. Every command in
it was run against this repo before it was written down.

The vendor playbooks (Linear, Notion, Slack, Sentry, Datadog, Databricks) were
kept, not deleted: upstream states they are adaptable templates for the same
category, and they are the reference for anyone wiring one of those MCPs up
later. The playbook index now says plainly which one describes tools that
exist here.

Its subagent config also named a Cursor model id and a `readonly` flag that do
not exist in the Agent tool; rewritten to `subagent_type: "general-purpose"`
with the session model inherited.

**Entry skill.** Upstream's `poteto-mode` is 907 lines across 22 playbooks and
carries 125 references to Graphite, bugbot, and `cursor-team-kit`. Rather than
port a file whose majority is unusable here, the entry `SKILL.md` was
rewritten: it keeps the principles index verbatim and the trigger table where
the target skill exists, and adds a section on where this repo's `AGENTS.md`
overrides pstack.

## What was deliberately NOT ported

**The Graphite/bugbot workflows**: `shipping`, `babysit`, `autopilot-stack`,
`autopilot-full`, `orchestrate`, `multi-phase-plan`, `opening-a-pr`. They
assume stacked PRs via Graphite (`gt`) and Cursor's bugbot reviewer. This repo
uses plain `gh` PRs with squash merges. A playbook that instructs an agent to
reach for a tool that is not installed is worse than no playbook — it produces
confident wrong steps. The repo's own `/pr` skill covers opening and landing.

**`setup-pstack`, `automate-me`, `reflect`, `recall`, `grokbot`,
`create-verification-skill`, `maintain-verification-skill`, `why`, `bro`,
`poteto-mode`, `principle-*` duplicates already covered.** These are either
Cursor-environment setup, depend on Cursor's automations directory, or are
large enough (`why` is 1157 lines) to want a separate decision before landing.

**The `agents/` directory and `automations/`.** Cursor agent definitions and
automation manifests have no direct Claude Code equivalent here.

## Re-syncing with upstream

The ported skills are unmodified except where listed above. To pull a newer
upstream version, diff against
`https://github.com/cursor/plugins/tree/main/pstack/skills/<name>` and
re-apply the five model-configuration edits plus the frontmatter conversion.
