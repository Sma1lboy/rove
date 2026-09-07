/**
 * Atlas flows — WORK surfaces: the workspace itself, reviewing what an engine produced,
 * and the paths out of the product.
 *
 * One entry per journey, one step per screenshot. Types and focus helpers live
 * in `flows-shared.ts`; the traps are in `.scratch/atlas/README.md`.
 */

import { ROW, type Flow, click, look, press } from "./flows-shared.ts"

export const FLOWS_WORK: readonly Flow[] = [
  {
    name: "workspace",
    summary: "The default three-pane workspace and its panes",
    steps: [
      {
        name: "boot",
        subject: "first paint: sidebar tree, empty engine pane, changed-files rail",
        drive: async () => {},
      },
      {
        name: "live-session",
        subject: "a seeded task's engine tab — transcript, composer, engine status line",
        drive: async (page) => {
          await click(page, 40, ROW.seededTab)
          await look(page, "Worked for", 30_000)
          await page.waitForTimeout(2_500)
        },
      },
      {
        name: "files-pane",
        subject: "focus moved to the changed-files rail; its own key hints in the footer",
        drive: async (page) => {
          await press(page, "ctrl+a", "l")
          await page.waitForTimeout(1_200)
        },
      },
      {
        name: "zen",
        subject: "zen mode: chrome collapses to the single engine pane",
        drive: async (page) => {
          await press(page, "ctrl+a", "z")
          await page.waitForTimeout(1_200)
        },
      },
      {
        name: "zen-off",
        subject: "and back — the three panes return with focus where it was",
        drive: async (page) => {
          // Leave zen INSIDE the flow that turned it on. `shoot.ts` clears it
          // between flows as a backstop, but a flow that hands the next one a
          // toggled TUI is a bug in the flow, not in the runner.
          await press(page, "ctrl+a", "z")
          await page.waitForTimeout(1_200)
        },
      },
    ],
  },
  {
    name: "review",
    summary: "THE landing question: reviewing an engine's diff before it merges",
    steps: [
      {
        name: "changed-files",
        subject: "the Changes rail after a real engine turn — what the task actually touched",
        drive: async (page) => {
          await click(page, 40, ROW.seededTab)
          await look(page, "Worked for", 30_000)
          // Focus must actually REACH the files pane before any pane-scoped
          // key. `ctrl+u` clears a composer but does not reclaim focus from a
          // split, and the seeded tab carries splits left by earlier takes —
          // two runs filmed `d`/`b` typed as `db` into a stray shell. Click
          // the files rail directly (a click cannot half-happen), then verify
          // the pane's own footer hint is on screen before pressing anything.
          await press(page, "ctrl+u")
          await click(page, 1_140, 300)
          await look(page, "fold", 10_000)
          await page.waitForTimeout(1_200)
        },
      },
      {
        name: "file-selected",
        subject: "cursor on a changed FILE — does the rail say what changed, or only that it did",
        drive: async (page) => {
          // `d` is a no-op on a directory row (FileTree.tsx:389-390), and the
          // tree opens with `src/` and `test/` at the top — one `down` lands on
          // a folder and the diff step photographed nothing opening. Walk past
          // the directories to a real file.
          await press(page, "down", "down", "down")
          await page.waitForTimeout(1_000)
        },
      },
      {
        name: "diff",
        subject: "`d` — the read-only diff in a workspace tab. THE review surface; judge it hard",
        drive: async (page) => {
          await press(page, "d")
          await page.waitForTimeout(3_000)
        },
      },
      {
        name: "branch-scope",
        subject: "`b` — working-tree changes vs branch-vs-base; is the scope legible",
        drive: async (page) => {
          await press(page, "b")
          await page.waitForTimeout(2_500)
        },
      },
    ],
  },
  {
    name: "splits",
    summary: "Splitting a terminal tab",
    steps: [
      {
        name: "single",
        subject: "one pane, before splitting",
        drive: async (page) => {
          await click(page, 40, ROW.seededTab)
          await look(page, "Worked for", 30_000)
          await press(page, "ctrl+u")
          await page.waitForTimeout(2_000)
        },
      },
      {
        name: "split-right",
        subject: "ctrl+\\ — how the two panes divide and which has focus",
        drive: async (page) => {
          await press(page, "ctrl+\\")
          await page.waitForTimeout(2_000)
        },
      },
      {
        name: "split-down",
        subject: "ctrl+= on top of that — a three-region grid",
        drive: async (page) => {
          await press(page, "ctrl+=")
          await page.waitForTimeout(2_000)
        },
      },
    ],
  },
  {
    name: "create-pr",
    summary: "ctrl+a p — the land path out of the product",
    steps: [
      {
        name: "on-task",
        subject: "a seeded task with real commits, before the PR verb",
        drive: async (page) => {
          await click(page, 40, ROW.seededTab)
          await look(page, "Worked for", 30_000)
          await press(page, "ctrl+u")
          await page.waitForTimeout(1_500)
        },
      },
      {
        name: "invoked",
        subject: "what ctrl+a p renders — a dialog, a toast, or silence",
        drive: async (page) => {
          await press(page, "ctrl+a", "p")
          await page.waitForTimeout(3_000)
        },
      },
    ],
  },
]
