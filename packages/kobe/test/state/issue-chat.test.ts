/**
 * Pins the issue-chat prompt contract — the shared builders in
 * `kobe-daemon/prompts/issue-prompts.ts` that BOTH the TUI
 * (state/issue-chat.ts) and the web board (kobe-web/src/lib/issues.ts) send.
 * Both prompts frame the story (#id + title + body) and
 * end with the daemon-owned `issue-set-status … done` instruction; the
 * worktree prompt carries the worktree/merge discipline, the project prompt
 * replaces it with the stay-on-checkout note. A drift here changes what
 * every story-spawned agent is told to do.
 */

import type { Issue } from "@sma1lboy/kobe-daemon/daemon/issues-store"
import {
  issueMergePrompt,
  issueProjectPrompt as sharedProjectPrompt,
  issueWorktreePrompt as sharedWorktreePrompt,
} from "@sma1lboy/kobe-daemon/prompts/issue-prompts"
import { describe, expect, test } from "vitest"
import {
  ISSUE_CHAT_PLACEMENTS,
  issueChatTaskTitle,
  issueProjectPrompt,
  issueWorktreePrompt,
  nextPlaceholderIndex,
  withImagePlaceholders,
} from "../../src/state/issue-chat"

const story: Issue = {
  id: 7,
  title: "Fix the flake",
  status: "open",
  created: "2026-07-10",
  body: "repro steps here",
}

describe("issue-chat prompts", () => {
  test("task title is the web `#id title` shape", () => {
    expect(issueChatTaskTitle(story)).toBe("#7 Fix the flake")
  })

  test("worktree prompt: story + worktree/merge discipline + done instruction", () => {
    const prompt = issueWorktreePrompt(story, "bun kobe api")
    expect(prompt).toContain("Work on user story #7: Fix the flake")
    expect(prompt).toContain("repro steps here")
    expect(prompt).toContain("task worktree")
    expect(prompt).toContain("merge the task branch")
    expect(prompt).toContain("bun kobe api issue-set-status --repo . --id 7 --status done")
  })

  test("project prompt: stay on the checkout, no worktree/merge lines", () => {
    const prompt = issueProjectPrompt(story)
    expect(prompt).toContain("Work on user story #7: Fix the flake")
    expect(prompt).toContain("directly in the project checkout")
    expect(prompt).not.toContain("task worktree")
    expect(prompt).not.toContain("merge the task branch")
    expect(prompt).toContain("rove api issue-set-status --repo . --id 7 --status done")
  })

  test("the TUI wrapper is the shared builder verbatim — one implementation, two surfaces", () => {
    // Before the dedup the TUI and the web board each kept their own copy of
    // this wording and they had already drifted (the web copy interpolated
    // the product name, the TUI copy hard-coded it). This fails the moment a
    // second implementation reappears on either side.
    expect(issueWorktreePrompt(story, "rove api")).toBe(sharedWorktreePrompt(story, "rove api", "Rove"))
    expect(issueProjectPrompt(story, "rove api")).toBe(sharedProjectPrompt(story, "rove api"))
  })

  test("the product name is interpolated, not hard-coded", () => {
    // The drift the dedup fixed: a caller passing its own display name must
    // see it, which a hard-coded "Rove" would silently swallow.
    expect(sharedWorktreePrompt(story, "rove api", "Kobe")).toContain("dedicated Kobe task session")
  })

  test("merge prompt: finish framing, merge to project main, done instruction", () => {
    const prompt = issueMergePrompt({ ...story, id: 9, title: "Ship it" }, "rove api")
    expect(prompt).toContain("Finish user story #9: Ship it")
    expect(prompt).toContain("Verify the acceptance criteria")
    expect(prompt).toContain("merge this task branch back into the current project's main branch")
    expect(prompt).toContain("rove api issue-set-status --repo . --id 9 --status done")
  })

  test("a blank body leaves no dangling blank section", () => {
    const prompt = issueWorktreePrompt({ ...story, body: "   " })
    expect(prompt).not.toContain("\n\n\n")
  })

  test("placement cycle order is worktree → projectWorktree → project (jump is a separate toggle)", () => {
    expect(ISSUE_CHAT_PLACEMENTS).toEqual(["worktree", "projectWorktree", "project"])
  })
})

describe("image placeholders in the body", () => {
  test("appends numbered placeholder lines, continuing the existing count", () => {
    const body = "story text\n\nimages[0]: /a.png"
    expect(nextPlaceholderIndex(body)).toBe(1)
    expect(withImagePlaceholders(body, ["/b.png"])).toBe("story text\n\nimages[0]: /a.png\nimages[1]: /b.png")
  })

  test("an empty body starts at images[0] with no leading newline", () => {
    expect(withImagePlaceholders("", ["/shot.png"])).toBe("images[0]: /shot.png")
  })

  test("pdfs get the pdf label; multiple pastes number sequentially", () => {
    expect(withImagePlaceholders("x", ["/a.pdf", "/b.png"])).toBe("x\npdf[0]: /a.pdf\nimages[1]: /b.png")
  })
})
