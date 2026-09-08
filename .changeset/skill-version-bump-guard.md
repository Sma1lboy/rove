---
"@sma1lboy/rove": patch
---

Bump the agent skill to v43, and make a missed bump a red build.

Staleness compares marker numbers only, never content, so four PRs in a row (#868, #869, #959, #970) edited `SKILL.md` while it stayed stamped v42. Every machine that installed the skill kept the older text and `rove skill status` still reported `✓ v42` — Claude and Codex both read that copy, so both were following instructions for a `send` deferred-inbox flow that had already been deleted, and neither had the "Communicate at handoffs" guidance.

`test/architecture/skill-version-bump.test.ts` now records a sha256 of each skill file alongside the version it belongs to. Editing the skill without bumping fails the build and prints the exact edit to make, including the replacement fingerprint. `rove skill status` also gained a second opinion for copies already in the field: when the installed text differs from the bundled one at the same version it says so, instead of a bare `✓`.

If you installed the skill before this release, refresh it: `rove skill install`, or `rove --skill > ~/.agents/skills/rove/SKILL.md`.
