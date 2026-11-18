/**
 * Staleness guard for product copy that lives OUTSIDE `packages/rove/src`.
 *
 * `no-tmux-runtime.test.ts` scans the shipped source for references to a tmux
 * runtime, but it cannot see the landing page, the marketing metadata, the
 * web dashboard, or the design docs — and those are exactly where a
 * stale-architecture claim survives longest, because nobody re-reads them.
 *
 * NEGATIVE assertions only, deliberately. A `toContain("<exact sentence>")`
 * pin does not guard an invariant; it freezes copy, so every rewording fails
 * a test that caught no regression. If you want to require that a surface
 * SAYS something, assert the absence of the thing it must not say instead —
 * that survives translation, rewording, and layout changes. Do not re-add
 * positive copy pins here.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url))
const read = (path: string) => readFileSync(join(ROOT, path), "utf8")

/** Every surface outside `packages/rove/src`, with the claims it must not make. */
const STALE_CLAIMS: Array<[path: string, phrases: string[]]> = [
  [
    "packages/rove-landing/index.html",
    [
      "persistent tmux sessions",
      "tmux session",
      "Close your laptop",
      "close the laptop",
      "合上笔记本",
      "需要 Bun ≥ 1.3.11、tmux",
    ],
  ],
  ["packages/rove-harness/README.md", ["rove-sandbox tmux socket"]],
  [".claude/skills/release/SKILL.md", ["needs tmux", "apt-installed tmux"]],
  ["marketing/brand.meta.yaml", ["git worktrees, tmux sessions", "persistent tmux sessions"]],
  ["docs/design/tasks.md", ["inside a tmux pane/embedded terminal"]],
  ["docs/design/dispatcher.md", ["send` pastes via tmux"]],
  ["docs/design/daemon.md", ["never tears down tmux sessions"]],
  // Not tmux, but the same failure mode: a status line that outlived its truth.
  ["docs/design/remote-projects.md", ["phases 1–6 done"]],
]

describe("active product copy", () => {
  test.each(STALE_CLAIMS)("%s makes no retired claim", (path, phrases) => {
    const source = read(path)
    expect(phrases.filter((stale) => source.includes(stale))).toEqual([])
  })

  test.each(["README.md", "docs/TUI.md"])("%s does not publish pre-Rove terminal recordings", (page) => {
    // Captures re-shot as Rove through the browser `/harness` path
    // (`packages/rove-harness/e2e/hero-*.ts`, docs/HARNESS.md) are current product
    // renderings and may be published: `demo.*`, `workspace.png`,
    // `diff-review.png`, `narrow-sidebar.png`, `routines.png`, and the kanban
    // set (`kanban.png`, `kanban-story.png`, `kanban.gif`/`.mp4`, shot by
    // `hero-issues.ts` + `films/kanban.ts`). What stays barred is every still
    // nobody has re-shot: those still photograph the rove-era TUI, wordmark
    // and all.
    const source = read(page)
    expect(["inbox.png", "new-session-dialog.png"].filter((asset) => source.includes(`assets/${asset}`))).toEqual([])
  })

  test("the landing page does not publish the pre-Rove quicklook recording", () => {
    const landing = read("packages/rove-landing/index.html")
    expect(landing).not.toContain("assets/quicklook.mp4")
    expect(landing).not.toContain("assets/quicklook-poster.jpg")
  })
})
