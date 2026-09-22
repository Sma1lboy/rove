/**
 * Screen-state manifests for the shipped contrib catalog — DATA, one block per
 * CLI, kept apart from the catalog table in `./contrib-engines.ts`.
 *
 * Two different jobs live on either side of this split. A manifest is an
 * OBSERVATION of a third-party CLI's terminal UI: the literal hint strings its
 * bottom bar draws, which go stale when that CLI redesigns its footer and are
 * checked by looking at the CLI, not at Rove. The table next door is
 * registration mechanics — ids, launch commands, which entry declares a hook
 * adapter — which change for Rove's own reasons.
 *
 * Rules are evaluated in order and the FIRST MATCH WINS, so blocked rules are
 * declared before working rules: a dialog drawn over a running turn has to read
 * as blocked. Where a rule could not be expressed in the classifier's
 * vocabulary (`all` / `any` / `lineRegex` + `bottomLines`, no negation, and
 * patterns compiled without the `u` flag) the comment above it says what was
 * dropped. Missing is the safe direction — a false `blocked` lights the
 * attention inbox and keeps it lit, where reading nothing leaves the badge
 * where it was.
 */

import type { EngineScreenManifest } from "./screen-state.ts"

export const GEMINI: EngineScreenManifest = {
  rules: [
    { state: "blocked", any: ["│ apply this change", "│ allow execution", "waiting for user confirmation"] },
    { state: "blocked", all: ["do you want to proceed"], any: ["yes"] },
    { state: "working", any: ["esc to cancel"] },
  ],
}

// Footer vocabulary verified against opencode 0.6.3 on 2026-09-04: a running
// turn ends `…working...  esc interrupt` and a resting one `enter send`.
// `esc interrupt` is the string copilot's manifest already carries; the
// `esc to interrupt` spellings are kept so an older opencode still matches.
export const OPENCODE: EngineScreenManifest = {
  rules: [
    { state: "blocked", any: ["△ permission required"] },
    { state: "blocked", all: ["esc dismiss"], any: ["enter confirm", "enter submit", "enter toggle"] },
    { state: "working", any: ["esc interrupt", "esc to interrupt", "ctrl+c to interrupt", "esc again to interrupt"] },
    // The rest footer, LAST so a running turn (which draws `enter send` too)
    // still reads working. Without an idle rule the badge that finally lights
    // up on the rule above could never come back down.
    { state: "idle", any: ["enter send"] },
  ],
}

export const CURSOR: EngineScreenManifest = {
  rules: [
    // The login wall, captured from cursor-agent 2026.04.17 in a fresh git
    // directory. Without this rule an unauthenticated cursor task classifies
    // exactly like a healthy resting one — no rule matches either, the
    // classifier answers null, and the badge stays wherever it was. A task
    // that CANNOT RUN AT ALL is blocked on a human, which is what this state
    // means everywhere else, so it gets the same "go look at it" badge rather
    // than a new vocabulary.
    { state: "blocked", any: ["press any key to log in"] },
    { state: "blocked", all: ["proceed (y)"] },
    { state: "blocked", any: ["run this command?", "waiting for approval", "skip (esc or n)", "(y) (enter)"] },
    { state: "working", any: ["esc to cancel", "ctrl+c to stop"] },
  ],
}

export const GROK: EngineScreenManifest = {
  rules: [
    // Permission / question dialogs draw a "┃"-guttered option list with a
    // select footer; the ⚠ prefix rides the OSC title too but the pane copy
    // is the portable signal.
    { state: "blocked", any: ["⚠ action required", "ctrl+o:yolo"] },
    { state: "blocked", all: ["┃"], lineRegex: ["^\\s*┃\\s+\\S+\\s+\\(○\\)"] },
    // A working turn anchors on the [stop] chip (the startup splash draws
    // its logo in braille, so a bare spinner glyph is not usable).
    { state: "working", any: ["[stop]"], lineRegex: ["^\\s*[\\u2800-\\u28FF]"] },
  ],
}

export const DROID: EngineScreenManifest = {
  rules: [
    { state: "blocked", all: ["enter to select", "esc to cancel"], any: ["> yes, allow", "> no, cancel"] },
    { state: "blocked", all: ["enter select", "esc cancel"] },
    { state: "working", any: ["esc to stop"] },
  ],
}

export const AMP: EngineScreenManifest = {
  rules: [
    {
      state: "blocked",
      any: [
        "waiting for approval",
        "run this command?",
        "allow editing file:",
        "allow creating file:",
        "confirm tool call",
      ],
    },
    { state: "working", lineRegex: ["^\\s*╰\\s+\\S+\\s+(thinking|streaming|running tools|waiting)\\s+─"] },
  ],
}

// ── Screen-only engines (no hook, no history) ──────────────────────────────
// The four below have no hook integration at all, so reading the pane is the
// ONLY way Rove learns their state.
//
// The classifier's rule model is deliberately small, and two shapes these
// screens want have no equivalent here:
//   - OR-of-ANDs (`any = [{ contains = [a, b] }, …]`). A rule here takes at
//     most one `any`, so each conjunctive disjunct becomes its own rule with
//     the same state — first match wins, so N same-state rules ARE an OR.
//   - `not` gates. No negation at all; a rule that needs one is dropped, and
//     said so below.
// A whole-screen region collapses to the classifier's default bottom
// region (12 non-empty lines), the same reduction the six entries above made:
// a dialog taller than that is missed. Missing is the safe direction — a
// false `blocked` lights the attention inbox and keeps it lit.
// `\p{Alphabetic}` becomes `[A-Za-z]` wherever it appears: the classifier
// compiles patterns without the `u` flag, so a non-Latin word after a spinner
// glyph no longer matches.

// Only the permission rule survives. A catch-all "any non-empty cline screen
// is working" rule was considered and dropped: classifyScreen's answer IS the
// badge, so it would pin cline to running for the tab's whole life with
// nothing able to bring it down.
// `null` (keep the previous reading) is the honest answer for a cline screen
// with no dialog on it, so cline ships blocked-only until someone with the
// CLI installed captures its real working/resting footer.
export const CLINE: EngineScreenManifest = {
  rules: [
    { state: "blocked", any: ["let cline use this tool"] },
    // The remaining four disjuncts are the [act mode]/[plan mode] ×
    // execute-a-command/use-a-tool cross product; two rules cover it exactly.
    { state: "blocked", all: ["execute command?", "yes"], any: ["[act mode]", "[plan mode]"] },
    { state: "blocked", all: ["use this tool?", "yes"], any: ["[act mode]", "[plan mode]"] },
  ],
}

export const KIRO: EngineScreenManifest = {
  rules: [
    {
      state: "blocked",
      all: ["requires approval"],
      any: ["yes, single permission", "trust, always allow", "no (tab to edit)", "esc to close"],
    },
    // The screen carries one of "tool approval"/"tool approvals"; the
    // singular is a prefix of the plural, so one substring covers both and
    // the rule's single `any` slot stays free for the action list.
    {
      state: "blocked",
      all: ["pending from subagents", "tool approval"],
      any: ["approve all pending", "configure individually", "exit (cancel subagents)"],
    },
    { state: "working", any: ["kiro is working"] },
    { state: "working", all: ["esc to cancel"], lineRegex: ["^\\s*[◔◑◕●]\\s+[A-Za-z]"] },
  ],
}

// Maki keeps a
// one-line status bar on the bottom row — `[BUILD]`/`[PLAN]`/`[BASH]` at rest,
// with a leading braille cell while it streams — hence the `bottomLines: 1`.
// DROPPED: a `prompt_box_idle` fallback (a bare `❯ ` on a pane narrow
// enough that the status bar's right half has overwritten the mode label). It
// is only correct behind two `not` gates; ungated it reads a streaming maki as
// idle, so on a narrow pane maki reports `null` instead of `idle`.
export const MAKI: EngineScreenManifest = {
  rules: [
    // Maki's permission screen has four alternatives, two of them
    // conjunctions — one rule each.
    { state: "blocked", all: ["permission required", "y allow", "n deny"] },
    { state: "blocked", all: ["permission required"], any: ["confirm allow", "confirm deny"] },
    { state: "blocked", all: ["permission required", "enter deny", "esc cancel"] },
    { state: "blocked", all: ["plan complete", "enter confirm"], any: ["space toggle parallel", "edit plan"] },
    { state: "working", bottomLines: 1, lineRegex: ["^( [\\u2800-\\u28FF]){1,2} \\[(BUILD|PLAN|BASH)\\]"] },
    { state: "idle", bottomLines: 1, lineRegex: ["^ \\[(BUILD|PLAN|BASH)\\]"] },
  ],
}

// Antigravity's manifest id is "agy", not its command name. OSC-title and
// OSC-progress regions have no counterpart in the classifier, but this
// manifest declares none.
export const ANTIGRAVITY: EngineScreenManifest = {
  rules: [
    { state: "blocked", all: ["requesting permission for:", "do you want to proceed?"] },
    { state: "blocked", all: ["requesting permission for:", "tab amend", "edit command"] },
    { state: "working", lineRegex: ["^\\s*[\\u2800-\\u28FF]+\\s+[A-Za-z]+\\w*ing\\b"] },
    { state: "working", bottomLines: 5, lineRegex: ["·\\s*[1-9][0-9]*\\s+task"] },
  ],
}

// Rove's rule vocabulary has no `not` gate; the negations the working and
// idle rules would need only exclude the blocked/working conditions that
// already sit ABOVE them here, and first match wins, so the ordering does
// that job.
export const DEVIN: EngineScreenManifest = {
  rules: [
    { state: "blocked", bottomLines: 8, all: ["do you trust the authors of this directory?", "yes, trust "] },
    { state: "blocked", bottomLines: 8, all: ["approve once", "select", "confirm", "esc cancel"] },
    { state: "working", bottomLines: 8, all: ["running tools", "esc to interrupt"] },
    { state: "working", bottomLines: 6, all: ["guide devin while it works"] },
    { state: "working", bottomLines: 8, all: ["reading shell ", "timeout:"] },
    {
      state: "idle",
      bottomLines: 8,
      all: ["ask devin to build", "features, fix bugs", "your code"],
      lineRegex: ["^\\s*\u276d Ask Devin to build"],
    },
    { state: "idle", bottomLines: 6, all: ["context:"], lineRegex: ["^\\s*\u276d"] },
  ],
}

// Qodercli's blocked screen has eight alternatives, two of them conjunctions
// — one rule each here, since a Rove rule's `any` slot is already spoken for
// by the conjunction's second half. Its whole-screen region is this
// classifier's default window.
export const QODERCLI: EngineScreenManifest = {
  rules: [
    { state: "blocked", all: ["waiting for user confirmation"], any: ["yes", "no", "allow", "reject"] },
    { state: "blocked", all: ["awaiting approval"], any: ["allow", "reject"] },
    {
      state: "blocked",
      any: [
        "permission required",
        "allow once or always?",
        "asking user",
        "enter your response",
        "review your answers:",
        "shell awaiting input",
      ],
    },
    { state: "working", any: ["(esc to cancel,"] },
    { state: "working", lineRegex: ["^\\s*[\\u2800-\\u28FF]\\s+.*[A-Za-z]"] },
  ],
}

// Hermes Agent's dialog vocabulary — the trigger words and the key hints its
// prompts draw along the bottom of the pane.
//
// Each blocked rule is a CONJUNCTION: a trigger word plus a key hint only a
// dialog footer draws. That is what keeps them off a streaming turn, which
// draws its interrupt hint and no option list — so the working rules can sit
// below them in the usual order without a running turn ever reading blocked.
//
// DROPPED: Hermes also states its phase in the terminal TITLE (a ⚠ / ⏳ / ✓
// prefix), which is the crispest signal it has. This classifier only sees pane
// text, so the resting ✓ has no counterpart here and hermes has no idle rule —
// `null` (keep the previous reading) rather than a guess.
export const HERMES: EngineScreenManifest = {
  rules: [
    {
      state: "blocked",
      bottomLines: 14,
      any: [
        "dangerous",
        "approval",
        "allow once",
        "hermes needs your",
        "type your answer",
        "approve once",
        "start a new session",
        "keep going",
      ],
      lineRegex: [
        "enter\\s+(?:to\\s+)?(?:confirm|send)",
        "press enter",
        "↑/↓\\s+(?:to\\s+)?select",
        "show full command",
        "type 1/2/3",
        "y/n quick",
        "other \\(type",
      ],
    },
    // A credential prompt has no option list to gate on; the ask itself is the
    // signal. The key glyph is paired with "for " so a stray 🔑 in output does
    // not read as a prompt.
    { state: "blocked", bottomLines: 14, any: ["sudo password", "skill setup"] },
    { state: "blocked", bottomLines: 14, all: ["\u{1F511}", "for "] },
    { state: "working", bottomLines: 5, any: ["msg=interrupt", "ctrl+c to interrupt", "ctrl+c cancel"] },
  ],
}

// Kilo's footer vocabulary. It is an OpenCode fork and draws the same kind of
// bottom bar, which is why these strings resemble the OpenCode manifest above;
// the selection-dialog rule is the stricter of the two, requiring the row-
// navigation hint as well as the confirm hint.
//
// No idle rule: kilo's resting footer is not pinned down here, so a screen with
// no dialog and no interrupt hint answers `null` and the badge keeps whatever
// it last read.
export const KILO: EngineScreenManifest = {
  rules: [
    { state: "blocked", any: ["△ permission required"] },
    {
      state: "blocked",
      all: ["esc dismiss"],
      any: ["enter confirm", "enter submit", "enter toggle"],
      lineRegex: ["↑↓\\s*select", "⇆\\s*tab"],
    },
    { state: "working", any: ["esc interrupt"] },
  ],
}

// MastraCode has NO screen rules, and that is the entry, not an omission: its
// hooks (`./mastracode-local/hook-adapter.ts`) report the full turn lifecycle —
// start, permission wait, resume, interrupt, end — so the A layer answers
// every question a manifest would, and no bottom-bar vocabulary was pinned down
// to translate. `classifyScreen` returns `null` for an empty rule list, which
// is exactly right: the poll says nothing and the hook says everything.
export const MASTRACODE: EngineScreenManifest = { rules: [] }
