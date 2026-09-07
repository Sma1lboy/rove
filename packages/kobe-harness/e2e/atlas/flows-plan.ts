/**
 * Atlas flows — PLANNING surfaces: the story board, scheduled routines, and the
 * external-tracker page.
 *
 * One entry per journey, one step per screenshot. Types and focus helpers live
 * in `flows-shared.ts`; the traps are in `.scratch/atlas/README.md`.
 */

import { ROW, type Flow, click, intoSidebar, look, press, typeText } from "./flows-shared.ts"

export const FLOWS_PLAN: readonly Flow[] = [
  {
    name: "kanban",
    summary: "Story board → card → detail drawer → intake",
    steps: [
      {
        name: "board",
        subject: "Backlog / In progress / Done columns with no selection",
        drive: async (page) => {
          await intoSidebar(page)
          await click(page, 40, ROW.kanban)
          await look(page, "In progress", 20_000)
          await page.waitForTimeout(1_200)
        },
      },
      {
        name: "card-selected",
        subject: "cursor on the first Backlog card — selection chrome",
        drive: async (page) => {
          await press(page, "down")
          await page.waitForTimeout(800)
        },
      },
      {
        name: "column-moved",
        subject: "cursor moved right into In progress",
        drive: async (page) => {
          await press(page, "right")
          await page.waitForTimeout(1_000)
        },
      },
      {
        name: "detail",
        subject: "story drawer: editable fields above engine/workspace choices",
        drive: async (page) => {
          await press(page, "enter")
          await look(page, "WORKSPACE", 20_000)
          await page.waitForTimeout(1_500)
        },
      },
      {
        name: "detail-closed",
        subject: "esc returns to the board with selection intact",
        drive: async (page) => {
          await press(page, "esc")
          await page.waitForTimeout(1_000)
        },
      },
    ],
  },
  {
    name: "kanban-intake",
    summary: "Filing a new story from the board",
    steps: [
      {
        name: "board",
        subject: "the board, before intake",
        drive: async (page) => {
          await intoSidebar(page)
          await click(page, 40, ROW.kanban)
          await look(page, "In progress", 20_000)
          await page.waitForTimeout(1_000)
        },
      },
      {
        name: "composer-empty",
        subject: "New Story drawer as it opens — all placeholders",
        drive: async (page) => {
          await press(page, "n")
          await page.waitForTimeout(1_200)
        },
      },
      {
        name: "composer-typed",
        subject: "a title typed in — does the field echo and size correctly",
        drive: async (page) => {
          await typeText(page, "Retry 5xx with backoff")
          await page.waitForTimeout(800)
        },
      },
      {
        name: "composer-body",
        subject: "tabbed to the description field with a body typed",
        drive: async (page) => {
          await press(page, "tab")
          await typeText(page, "Client should retry 502/503 twice before surfacing.")
          await page.waitForTimeout(800)
        },
      },
    ],
  },
  {
    name: "routines",
    summary: "Scheduled prompts: list → composer → schedule editor",
    height: 560,
    steps: [
      {
        name: "list",
        subject: "three routines with next-run times and the selected one's detail",
        drive: async (page) => {
          await intoSidebar(page)
          await click(page, 40, ROW.routines)
          await look(page, "Nightly dependency audit", 20_000)
          await page.waitForTimeout(1_500)
        },
      },
      {
        name: "composer",
        subject: "New routine composer, empty",
        drive: async (page) => {
          await press(page, "n")
          await look(page, "New routine", 15_000)
          await page.waitForTimeout(800)
        },
      },
      {
        name: "composer-named",
        subject: "name typed; repo field next",
        drive: async (page) => {
          await typeText(page, "Weekday dependency audit")
          await page.waitForTimeout(600)
        },
      },
      {
        name: "composer-prompt",
        subject: "prompt filled — the routine's actual instruction",
        drive: async (page) => {
          await press(page, "tab", "tab")
          await typeText(page, "Audit dependencies and summarize risky changes.")
          await page.waitForTimeout(600)
        },
      },
      {
        name: "schedule",
        subject: "the cron cells with the hour selected and the schedule restated in words",
        drive: async (page) => {
          await press(page, "tab")
          await page.waitForTimeout(600)
          await press(page, "right")
          await page.waitForTimeout(1_500)
        },
      },
    ],
  },
  {
    name: "work-items",
    summary: "GitHub issues page (ctrl+a 3)",
    steps: [
      {
        name: "page",
        subject: "how the page reads with no gh auth / no issues — the empty state",
        drive: async (page) => {
          await intoSidebar(page)
          await press(page, "ctrl+a", "3")
          await page.waitForTimeout(2_500)
        },
      },
    ],
  },
]
