<!--
Keep UI evidence whenever UI source changes, including bug fixes and refactors.
Then pick the change-type section that fits and omit unused sections.
Everything outside your section can go too — a short PR is a good PR.

The evidence line in each section is not paperwork: it is what lets a
reviewer believe the change without re-running it. A section with its
evidence missing will be sent back.
-->

## What changed

<!-- One or two sentences. What is different for a user of Rove after this
     lands? Not a list of files. -->

---

<!-- ─────────────  UI / UX change  ───────────── -->
## UI evidence

**Before / after screenshots — required.**

| Before | After |
| --- | --- |
| ![Before](https://...) | ![After](https://...) |

Capture: <!-- /harness → xterm.js → PTY sidecar → OpenTUI; exact command/steps -->
Viewport: <!-- e.g. 1280×800, same for both -->
Fixture: <!-- isolated fixture and state shown -->
Theme: <!-- same theme for both -->

- Both shots must come from the harness: browser `/harness` → xterm.js → PTY
  sidecar → real OpenTUI (see `docs/HARNESS.md`). Local terminal screenshots
  and render-test output are not visual evidence.
- Same viewport, same fixture, same theme in both. Only the thing you changed
  should differ between them.
- If the BEFORE state is one Rove repairs at startup, say how you produced it —
  `visual:shot` cannot capture a self-healing state.

New or moved keybinding? List it here and say it is **PROPOSED** — placement is
the owner's call (`docs/KEYBINDINGS.md`, `docs/design/keybinding-decisions.md`).

---

<!-- ─────────────  Bug fix  ───────────── -->
## Bug fix

**A reproducible failure, then the same probe passing — required.**

**Repro** (the exact command / keystrokes, not a description):

```
```

**Before** — the failure itself: log lines, the error, or a screenshot.

```
```

**After** — the same probe, now passing.

```
```

- Name the **root cause**, not the symptom. "It also fails on a clean tree"
  only proves you did not break it.
- Grep every caller of what you touched: a guard in the shared function beats
  a guard in the one path the report named.
- Say which check would have caught this, and whether you added it.

---

<!-- ─────────────  Feature  ───────────── -->
## Feature

**Screenshots of the new surface — required** (same harness rules as UI evidence
above). One per state that behaves differently — empty, populated, failing.

- What is the smallest thing that would have to break for this to be wrong, and
  which test pins it?
- Anything a user can turn on: say what happens when it is off.

---

<!-- ─────────────  Refactor / internal / docs  ───────────── -->
## Refactor, internal or docs-only

UI source changes still require the UI evidence section above, even for refactors.
For changes without UI source:

- **Behaviour is unchanged** — say how you know (tests that already covered it,
  a mutation check, a before/after of the same command).
- If you split a file: name the **seam** (this half owns X, that half owns Y),
  not the line count. No seam is a valid answer — say so.

---

## Checks

- [ ] `bun run typecheck && bun run lint` from the repo root; `bun run test:fast` from `packages/kobe`
- [ ] A changeset (`patch` unless told otherwise — pre-1.0 ships features as patches)
- [ ] Docs updated in the same PR if this changed config keys, CLI verbs,
      `rove api` verbs, engine support, worktree safety, or session behaviour
- [ ] Any exemption line (`file-size-exemption:` / `coverage-exemption:`) is in
      this body **before** the push that triggers CI — a rerun reuses the frozen
      event payload and will not see an edit made afterwards

<!--
Do not add AI/Anthropic/Claude/Codex attribution anywhere — not in commits,
tags, this body, or release notes. See AGENTS.md.
-->
