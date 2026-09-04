/**
 * `adoptablePaths` excluded the repository's main checkout by comparing each
 * porcelain entry to the path the CALLER passed. Called with a linked
 * worktree that excluded the caller instead, leaving the user's own primary
 * checkout in the adoptable list — `rove api discover-adoptable --repo <linked
 * worktree>` offered it, and `adopt` (which validates through this same
 * function) recorded it as a disposable managed task on the default branch.
 * `rove add <linked worktree>` did that unprompted.
 *
 * Stubbed porcelain over the real decision logic, following
 * `worktree-unreadable.test.ts`: git always lists the main worktree first, so
 * the fix reads the primary checkout out of the listing instead of trusting
 * `ctx.dir`. The end-to-end CLI reproduction is in the PR.
 */

import { expect, it } from "vitest"
import type { ExecCtx } from "../../src/orchestrator/worktree/exec-deps.ts"
import { type ListDeps, adoptablePaths } from "../../src/orchestrator/worktree/manager-list.ts"

const MAIN = "/repos/beta"
const LINKED = "/repos/beta-feature"

/** Git lists the main worktree first; branch names follow the path. */
const PORCELAIN = [
  `worktree ${MAIN}\nHEAD aaa\nbranch refs/heads/main\n`,
  `worktree ${LINKED}\nHEAD bbb\nbranch refs/heads/feature\n`,
].join("\n")

function deps(): ListDeps {
  return {
    ctxFor: () => ({ dir: MAIN, remote: false }) as unknown as ExecCtx,
    async runGitStdout(_ctx, args) {
      if (args[0] === "worktree") return PORCELAIN
      throw new Error(`unexpected git ${args.join(" ")}`)
    },
    runGitStdoutAt: async () => "",
    isDirty: async () => false,
  }
}

const ctx = (dir: string): ExecCtx => ({ dir, remote: false }) as unknown as ExecCtx

it("never offers the repository's primary checkout, even when asked from a linked worktree", async () => {
  expect(await adoptablePaths(deps(), ctx(LINKED))).toEqual([])
})

it("still offers a sibling linked worktree when asked from the primary checkout", async () => {
  expect(await adoptablePaths(deps(), ctx(MAIN))).toEqual([{ path: LINKED, branch: "feature", head: "bbb" }])
})
