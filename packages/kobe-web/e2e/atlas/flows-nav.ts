/**
 * Atlas flows — NAVIGATION and configuration: creating tasks and tabs, moving around the
 * sidebar, settings, worktrees, help, inbox.
 *
 * One entry per journey, one step per screenshot. Types and focus helpers live
 * in `flows-shared.ts`; the traps are in `.scratch/atlas/README.md`.
 */

import { intoSidebar, type Flow, press, typeText } from "./flows-shared.ts"

export const FLOWS_NAV: readonly Flow[] = [
  {
    name: "new-conversation",
    summary: "ctrl+e: the engine picker and its destination/context toggles",
    steps: [
      {
        name: "picker",
        subject: "the engine ring — which engines, which is default, how the ring reads",
        drive: async (page) => {
          await intoSidebar(page)
          await press(page, "ctrl+e")
          await page.waitForTimeout(1_500)
        },
      },
      {
        name: "engine-next",
        subject: "→ moves along the ring; is the new selection obvious",
        drive: async (page) => {
          await press(page, "right")
          await page.waitForTimeout(1_000)
        },
      },
      {
        name: "destination-toggle",
        subject: "tab switches destination: new tab here ⇄ fork a child task",
        drive: async (page) => {
          await press(page, "tab")
          await page.waitForTimeout(1_000)
        },
      },
      {
        name: "context-toggle",
        subject: "ctrl+f switches context: fresh ⇄ continue this chat",
        drive: async (page) => {
          await press(page, "ctrl+f")
          await page.waitForTimeout(1_000)
        },
      },
    ],
  },
  {
    name: "task-intake",
    summary: "Creating a task from the sidebar",
    steps: [
      {
        name: "composer",
        subject: "the quick task composer as it opens",
        drive: async (page) => {
          await intoSidebar(page)
          await press(page, "n")
          await page.waitForTimeout(1_500)
        },
      },
      {
        name: "typed",
        subject: "a prompt typed in — what the user commits to before a worktree exists",
        drive: async (page) => {
          await typeText(page, "Add a retry helper to the HTTP client")
          await page.waitForTimeout(1_000)
        },
      },
    ],
  },
  {
    name: "task-actions",
    summary: "What a task row offers: rename, branch, engine, archive, delete",
    steps: [
      {
        name: "row",
        subject: "the selected task row at rest",
        drive: async (page) => {
          await intoSidebar(page)
          await page.waitForTimeout(800)
        },
      },
      {
        name: "rename",
        subject: "`r` rename dialog — the field and its affordances",
        drive: async (page) => {
          await press(page, "r")
          await page.waitForTimeout(1_200)
        },
      },
      {
        name: "branch-picker",
        subject: "`b` branch picker — how it lists branches and whether it can create one",
        drive: async (page) => {
          // `esc` closes the dialog but leaves focus wherever the dialog left
          // it, and the next bare key then lands in the engine pane — this step
          // photographed a plain workspace twice. Re-assert the sidebar.
          await press(page, "esc")
          await intoSidebar(page)
          await press(page, "b")
          await page.waitForTimeout(1_800)
        },
      },
      {
        name: "engine-change",
        subject: "`v` change engine — the same ring as ctrl+e, or a different affordance",
        drive: async (page) => {
          await press(page, "esc")
          await intoSidebar(page)
          await press(page, "v")
          await page.waitForTimeout(1_500)
        },
      },
    ],
  },
  {
    name: "sidebar-nav",
    summary: "Sidebar mechanics: search, reorder, context actions",
    steps: [
      {
        name: "rest",
        subject: "the tree at rest — hierarchy, engine badges, row density",
        drive: async (page) => {
          await intoSidebar(page)
          await page.waitForTimeout(800)
        },
      },
      {
        name: "search",
        subject: "`/` search — where the query goes and how matches read",
        drive: async (page) => {
          await press(page, "/")
          await typeText(page, "retry")
          await page.waitForTimeout(1_200)
        },
      },
      {
        name: "reorder",
        subject: "shift+m reorder mode — is the movable scope legible",
        drive: async (page) => {
          await press(page, "esc")
          await page.waitForTimeout(400)
          await press(page, "shift+m")
          await page.waitForTimeout(1_200)
        },
      },
    ],
  },
  {
    name: "settings",
    summary: "Settings sections — general, keybindings, feedback, dev (engines/plugins skipped: personal data)",
    steps: [
      {
        name: "general",
        subject: "the section rail and General's rows: theme, language, transparency",
        drive: async (page) => {
          await intoSidebar(page)
          await press(page, "ctrl+a", ",")
          await page.waitForTimeout(1_500)
        },
      },
      {
        name: "general-body",
        subject: "`right` enters General's rows — theme, language, transparency",
        drive: async (page) => {
          // `right`/`l` enters the body, `left`/`h` returns to the section rail
          // (settings-dialog/index.tsx:290-292). NOT `esc`, which closes the
          // whole dialog — a first run photographed the workspace twice.
          await press(page, "right")
          await page.waitForTimeout(800)
          await press(page, "down")
          await page.waitForTimeout(800)
        },
      },
      {
        name: "keys",
        subject: "the Keybindings section: the live keymap as a settings page",
        drive: async (page) => {
          // Back to the rail, then walk UP from General — never DOWN, which
          // crosses Engines and renders the operator's real accounts. The rail
          // WRAPS, so `up` from General lands on Dev (last) and climbs from
          // there: Dev → Feedback → Keybindings. Three presses, not two.
          await press(page, "left")
          await page.waitForTimeout(600)
          await press(page, "up", "up", "up")
          await page.waitForTimeout(1_200)
        },
      },
    ],
  },
  {
    name: "worktrees",
    summary: "The worktree audit page",
    steps: [
      {
        name: "page",
        subject: "worktrees the daemon knows about, adoptable ones flagged",
        drive: async (page) => {
          await intoSidebar(page)
          await press(page, "x")
          await page.waitForTimeout(2_000)
        },
      },
      {
        name: "row-selected",
        subject: "a row under the cursor — what actions the page offers",
        drive: async (page) => {
          await press(page, "down")
          await page.waitForTimeout(1_000)
        },
      },
    ],
  },
  {
    name: "help",
    summary: "F1 — the live keymap overlay",
    steps: [
      {
        name: "overlay",
        subject: "every binding in the current scope; how much fits on one screen",
        drive: async (page) => {
          await intoSidebar(page)
          await press(page, "f1")
          await page.waitForTimeout(1_500)
        },
      },
    ],
  },
  {
    name: "inbox",
    summary: "The attention inbox",
    steps: [
      {
        name: "open",
        subject: "what an empty (or populated) inbox says and offers",
        drive: async (page) => {
          await intoSidebar(page)
          await press(page, "ctrl+a", "i")
          await page.waitForTimeout(1_500)
        },
      },
    ],
  },
]
