---
name: pstack
description: Rigorous engineering mode for nontrivial work in this repo — a set of named principles plus the leaf skills that apply them. Use when the user says "pstack", "go deep", "be rigorous", "认真做", or when a task involves architecture, a real bug, a refactor, or anything the user will not be watching. Ported from cursor/plugins pstack by Lauren Tan (MIT); see ATTRIBUTION.md.
metadata:
  internal: true
  upstream: pstack
---

# pstack

Rigor over throughput. The point is to write **less** code, and to be able to
prove the code you wrote works.

Original by Lauren Tan (poteto), MIT, from the Cursor plugin marketplace.
This is a port: the principles and general skills are upstream's, the
orchestration around them is rewritten for Claude Code and this repo. What
changed and why: [ATTRIBUTION.md](./ATTRIBUTION.md).

## How to use it

Read the principles below. **Name the ones that shaped a decision, and say
which choice each one changed.** A citation with no decision behind it means
you did not actually apply it — that is worse than not citing, because it
reads as rigor without being rigor.

For any principle you actually apply, read its leaf skill in full
(`skills/principle-<name>/SKILL.md`). The one-liners here are an index, not
the content.

## Principles

**Core**

- **Laziness Protocol** (`principle-laziness-protocol`). Refactoring, sizing a diff, or tempted to add abstractions, layers, or signal threading. Bias to deletion and the smallest change that solves the problem.
- **Foundational Thinking** (`principle-foundational-thinking`). Before writing logic: core types and data structures, scaffold-vs-feature sequencing, what concurrent actors share.
- **Redesign from First Principles** (`principle-redesign-from-first-principles`). Integrating a new requirement into an existing design. Redesign as if it had been foundational from day one.
- **Subtract Before You Add** (`principle-subtract-before-you-add`). Sequencing an addition, refactor, or rewrite. Remove dead weight first, then build on the simpler base.
- **Minimize Reader Load** (`principle-minimize-reader-load`). Reviewing or shaping code that's hard to trace. Count layers and hidden state, collapse one-caller wrappers, shrink mutable scope.
- **Outcome-Oriented Execution** (`principle-outcome-oriented-execution`). Planned rewrites and migrations with explicit phase boundaries. Converge on the target architecture, don't preserve throwaway compatibility states.
- **Experience First** (`principle-experience-first`). Product, UX, or feature-scope tradeoffs. Choose user delight over implementation convenience.
- **Exhaust the Design Space** (`principle-exhaust-the-design-space`). A novel interaction or architectural decision with no precedent. Build 2-3 competing prototypes and compare before committing.
- **Build the Lever** (`principle-build-the-lever`). Any non-trivial work. Build the tool that does or proves it (codemod, script, generator), not by hand; the tool is the artifact a reviewer reruns.

**Architecture**

- **Model the Domain** (`principle-model-the-domain`). Writing stateful logic, or code that branches a lot or repeats a shape assumption across files. Encode the domain in a structure instead of scattered conditionals.
- **Boundary Discipline** (`principle-boundary-discipline`). Wiring validation, error handling, or framework adapters. Guards at system boundaries, trust internal types, keep business logic pure.
- **Type System Discipline** (`principle-type-system-discipline`). Designing types or a signature. Make illegal states unrepresentable, brand primitives, parse external data at boundaries.
- **Make Operations Idempotent** (`principle-make-operations-idempotent`). Designing commands, lifecycle steps, or loops that run amid crashes and retries. Converge to the same end state.
- **Migrate Callers Then Delete Legacy APIs** (`principle-migrate-callers-then-delete-legacy-apis`). Introducing a new internal API while old callers exist. Migrate and delete in one wave.
- **Separate Before Serializing Shared State** (`principle-separate-before-serializing-shared-state`). Concurrent actors might write the same file, branch, key, or object. Eliminate the sharing first.

**Verification**

- **Prove It Works** (`principle-prove-it-works`). After a task, before declaring done. Verify against the real artifact, not a proxy or "it compiles".
- **Fix Root Causes** (`principle-fix-root-causes`). Debugging. Trace each symptom to its root cause, reproduce first, ask why until you reach it.
- **Sequence Work into Verifiable Units** (`principle-sequence-verifiable-units`). Multi-step work and how you stack commits and PRs. Break work into units that each end in a check.

**Delegation**

- **Guard the Context Window** (`principle-guard-the-context-window`). Context fills up: large outputs, long files, repeated reads, fan-out planning. Route bulk to subagents, keep summaries in the main thread.
- **Never Block on the Human** (`principle-never-block-on-the-human`). Tempted to ask "should I do X?" on reversible work. Proceed, present the result, let the human course-correct.

**Meta**

- **Encode Lessons in Structure** (`principle-encode-lessons-in-structure`). You catch yourself writing the same instruction a second time. Encode it as a lint, metadata flag, runtime check, or script instead of more text.

## Triggers

- Nontrivial change, architecture decision, or "are we sure?" → `how`.
- "Why is it built this way?", a magic number with no comment, or a constraint nobody remembers → `why`. It fans out across this repo's decision record (ADRs, `docs/design/`, the issue store, the changelog, wisp) and git history in parallel, and cites or names the gap. `how` answers what the code does; `why` answers what forced its shape.
- Code crossing a function boundary → `architect` (parallel design exploration before implementing).
- Parallel fan-out → `swarm`. Design or code bakeoff → `arena`.
- Contested design → `interrogate` (adversarial multi-reviewer) before shipping.
- Any user-facing prose → `unslop`. Docs, RFCs, PR descriptions, commit messages → `technical-writing`.
- Before review → `no-comments`.
- Long or unattended work the user will review later → `show-me-your-work`.
- About to ask "which approach?" → first check whether running something answers it. If the answer is observable (behavior, timing, output, perf), it is not the human's to answer. Probe it. Reserve the question for genuine product or preference calls.

## This repo's rules win

`AGENTS.md` (symlinked as `CLAUDE.md`) is authoritative. Where pstack and it
disagree, the repo wins. The conflicts that actually come up:

- **Deletion.** pstack says bias to deletion. This repo requires the user to
  say "delete"/"删" **in the same turn** before you remove files, branches, or
  worktrees. Surface the deletion you want; do not take it.
- **Never Block on the Human.** Scoped to *reversible* work. Releases, direct
  pushes to `main`, and new or moved keybindings need the owner's word in that
  turn regardless of what this principle says.
- **File size cap.** ~500 lines on any file you touch, CI-gated. That is a hard
  rule, not a principle to weigh.
- **Verification.** "Prove It Works" here means the repo's real gates:
  `bun run lint`, `bun run test:fast` (vitest) or `bun test test/render` (bun's
  runner — picking the wrong one looks like a broken environment), and for
  visual work the browser `/harness` path, never a local screenshot.

## Autonomy

Reversible work proceeds without asking. Always pause for irreversible writes:
force-push to shared branches, deploys, data deletion, messages to people.

## What was left behind

Upstream's Graphite/bugbot workflows (`shipping`, `babysit`, `autopilot-*`,
`orchestrate`) were not ported — this repo uses plain `gh` PRs, and a playbook
that reaches for tools you do not have is worse than no playbook. The `/pr`
skill covers that ground. Details in [ATTRIBUTION.md](./ATTRIBUTION.md).
