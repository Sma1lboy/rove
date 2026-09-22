<!--
≤150 words outside screenshots and code blocks. Delete what doesn't apply.
No AI/Anthropic/Claude/Codex attribution anywhere (AGENTS.md).
-->

## What changed

<!-- 1–3 sentences, from a Rove user's point of view. Not a file list. -->

## Evidence

<!-- One of:
  - Bug fix: the repro command, its failure before, the same probe passing after. Name the root cause.
  - Feature / refactor: the test that pins it, or how you know behaviour is unchanged.
  - Split file: the seam (this half owns X, that half owns Y). -->

## UI evidence

<!-- Required when packages/kobe/src/tui*/ or kobe-harness/src/ changes.
     Harness only: /harness → xterm.js → PTY sidecar → real OpenTUI (docs/HARNESS.md).
     If no frame can change (dropped import, moved type), replace this section
     with one line: `ui-evidence: none — <reason>`.
     New or moved keybinding? Mark it PROPOSED — placement is the owner's call. -->

| Before | After |
| --- | --- |
| ![Before](https://...) | ![After](https://...) |

Capture:
Viewport:
Fixture:
Theme:

<!-- Exemption lines, if any, go here:
file-size-exemption: <path> — <reason>   (only when this PR grows a file past ~500 lines) -->
