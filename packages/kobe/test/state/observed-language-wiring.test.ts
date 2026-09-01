/**
 * The observation reaches the text that needs it.
 *
 * Two consumers, two different mechanisms, and the difference is the point:
 *
 *  - The missing-dependencies coda is built one line after the user's own
 *    prompt, so it reads the language straight out of that text — no stored
 *    state involved.
 *  - The quota-resume continuation fires from a TIMER, minutes-to-hours
 *    after any human turn, with no user message in hand. It can only read
 *    what was observed and persisted at task creation.
 *
 * A task with no observation reads English, which is what every record
 * predating the field does.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { quotaResumeContinuePrompt } from "@sma1lboy/kobe-daemon/daemon/quota-resume"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { missingDependenciesCoda } from "../../src/state/repo-init.ts"

describe("quota resume (no user text in hand — reads the stored observation)", () => {
  test("a task whose user writes Chinese resumes in Chinese", () => {
    expect(quotaResumeContinuePrompt("zh")).toContain("继续这个任务")
  })

  test("English, and no observation at all, both read English", () => {
    expect(quotaResumeContinuePrompt("en")).toContain("Continue the task")
    // Records created before the field exists — must not become Chinese.
    expect(quotaResumeContinuePrompt(undefined)).toContain("Continue the task")
  })
})

describe("missing-dependencies coda (user text one line away)", () => {
  let worktree: string

  beforeEach(() => {
    // A committed lockfile with no install output — the exact shape the coda
    // fires on, so this exercises the real detection, not a stub of it.
    worktree = mkdtempSync(join(tmpdir(), "rove-deps-"))
    writeFileSync(join(worktree, "bun.lock"), "")
  })

  afterEach(() => rmSync(worktree, { recursive: true, force: true }))

  test("follows the language of the prompt it rides behind", () => {
    expect(missingDependenciesCoda(worktree, "zh")).toContain("没有装依赖")
    expect(missingDependenciesCoda(worktree, "en")).toContain("no installed dependencies")
    expect(missingDependenciesCoda(worktree, undefined)).toContain("no installed dependencies")
  })

  test("names the missing directory in either language", () => {
    // The payload is the fact, not the prose: it must survive translation.
    expect(missingDependenciesCoda(worktree, "zh")).toContain("node_modules")
    expect(missingDependenciesCoda(worktree, "en")).toContain("node_modules")
  })

  test("stays silent when the dependencies are installed", () => {
    // No lockfile-without-install means no warning, in any language.
    const clean = mkdtempSync(join(tmpdir(), "rove-clean-"))
    try {
      expect(missingDependenciesCoda(clean, "zh")).toBeUndefined()
    } finally {
      rmSync(clean, { recursive: true, force: true })
    }
  })
})
