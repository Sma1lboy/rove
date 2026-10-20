/** Screen activity rules for shipped contrib engines. Blocked rules precede working rules. */

import type { EngineScreenManifest } from "./screen-state.ts"

export const GEMINI: EngineScreenManifest = {
  rules: [
    { state: "blocked", any: ["│ apply this change", "│ allow execution", "waiting for user confirmation"] },
    { state: "blocked", all: ["do you want to proceed"], any: ["yes"] },
    { state: "working", any: ["esc to cancel"] },
  ],
}

// Verified against opencode 0.6.3: a running turn ends `…working...  esc
// interrupt`, a resting one `enter send`. `esc to interrupt` covers older builds.
export const OPENCODE: EngineScreenManifest = {
  rules: [
    { state: "blocked", any: ["△ permission required"] },
    { state: "blocked", all: ["esc dismiss"], any: ["enter confirm", "enter submit", "enter toggle"] },
    { state: "working", any: ["esc interrupt", "esc to interrupt", "ctrl+c to interrupt", "esc again to interrupt"] },
    // LAST: a running turn draws `enter send` too. Without it the badge never clears.
    { state: "idle", any: ["enter send"] },
  ],
}

export const CURSOR: EngineScreenManifest = {
  rules: [
    // Login wall (cursor-agent 2026.04.17). Without it an unauthenticated task
    // classifies null like a resting one; a task that cannot run is blocked on a human.
    { state: "blocked", any: ["press any key to log in"] },
    { state: "blocked", all: ["proceed (y)"] },
    { state: "blocked", any: ["run this command?", "waiting for approval", "skip (esc or n)", "(y) (enter)"] },
    { state: "working", any: ["esc to cancel", "ctrl+c to stop"] },
  ],
}

export const GROK: EngineScreenManifest = {
  rules: [
    // Dialogs draw a "┃"-guttered option list; the ⚠ also rides the OSC title
    // but the pane copy is the portable signal.
    { state: "blocked", any: ["⚠ action required", "ctrl+o:yolo"] },
    { state: "blocked", all: ["┃"], lineRegex: ["^\\s*┃\\s+\\S+\\s+\\(○\\)"] },
    // Anchor on [stop]: the startup splash draws its logo in braille.
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
// The pane is the ONLY state source for the four below. The rule model lacks:
//   - OR-of-ANDs: each conjunctive disjunct becomes its own same-state rule
//     (first match wins, so N same-state rules ARE an OR).
//   - `not` gates: a rule that needs one is dropped, noted below.
// A whole-screen region collapses to the default bottom 12 non-empty lines, so
// a taller dialog is missed — the safe direction, since a false `blocked`
// keeps the attention inbox lit. `\p{Alphabetic}` becomes `[A-Za-z]`: patterns
// compile without the `u` flag, so a non-Latin word after a spinner won't match.

// Blocked-only: a catch-all "non-empty screen is working" rule would pin the
// badge to running forever, and `null` (keep the previous reading) is honest
// until someone captures cline's real working/resting footer.
export const CLINE: EngineScreenManifest = {
  rules: [
    { state: "blocked", any: ["let cline use this tool"] },
    // The [act mode]/[plan mode] × command/tool cross product.
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
    // "tool approval" is a prefix of "tool approvals", so one substring covers both.
    {
      state: "blocked",
      all: ["pending from subagents", "tool approval"],
      any: ["approve all pending", "configure individually", "exit (cancel subagents)"],
    },
    { state: "working", any: ["kiro is working"] },
    { state: "working", all: ["esc to cancel"], lineRegex: ["^\\s*[◔◑◕●]\\s+[A-Za-z]"] },
  ],
}

// Maki's bottom-row status bar shows `[BUILD]`/`[PLAN]`/`[BASH]`, with a leading
// braille cell while streaming — hence `bottomLines: 1`. DROPPED: the narrow-pane
// `prompt_box_idle` fallback (bare `❯ `) needs two `not` gates; ungated it reads
// a streaming maki as idle, so a narrow pane reports `null` instead.
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

// Antigravity's manifest id is "agy", not its command name.
export const ANTIGRAVITY: EngineScreenManifest = {
  rules: [
    { state: "blocked", all: ["requesting permission for:", "do you want to proceed?"] },
    { state: "blocked", all: ["requesting permission for:", "tab amend", "edit command"] },
    { state: "working", lineRegex: ["^\\s*[\\u2800-\\u28FF]+\\s+[A-Za-z]+\\w*ing\\b"] },
    { state: "working", bottomLines: 5, lineRegex: ["·\\s*[1-9][0-9]*\\s+task"] },
  ],
}

// Order stands in for `not`: the negations working/idle need only exclude the
// rules ABOVE them, and first match wins.
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

// Each conjunctive blocked alternative gets its own rule: its `any` slot holds
// the conjunction's second half.
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
