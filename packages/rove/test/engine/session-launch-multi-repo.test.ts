/**
 * How a multi-repo task's extra worktrees reach an engine: argv through the
 * engine's own `addDirArgv` where it declares one, env and a first-prompt note
 * for every engine, nothing at all for a one-repo task.
 */

import type { TaskRepoView } from "@sma1lboy/rove-daemon/task-tree"
import { describe, expect, test } from "vitest"
import { repoEnv } from "../../src/engine/multi-repo-launch.ts"
import { buildEngineSessionLaunch } from "../../src/engine/session-launch.ts"
import { shellIdentityInput } from "../../src/tui/workspace/terminal-tab-spawn.ts"
import type { VendorId } from "../../src/types/vendor.ts"

const repos: TaskRepoView[] = [
  { name: "web", repo: "/src/web", branch: "feat/x", worktreePath: "/wt/web-1", primary: true },
  { name: "api-v2", repo: "/src/api-v2", branch: "feat/x", worktreePath: "/wt/api-1", primary: false },
  { name: "docs", repo: "/src/docs", branch: "feat/x-2", worktreePath: "/wt/it's docs", primary: false },
]

function launch(vendor: VendorId, taskRepos: readonly TaskRepoView[] | undefined, prompt = "ship it") {
  return buildEngineSessionLaunch({
    task: { id: "task-1", kind: "task", vendor, repo: "/src/web", repos: taskRepos },
    worktreePath: "/wt/web-1",
    shell: "/bin/zsh",
    argv: [vendor],
    promptIntent: { kind: "explicit", prompt },
    protocolGates: { status: () => false, notes: () => false, dispatcher: () => false },
  })
}

describe("multi-repo engine launch", () => {
  test("an engine with addDirArgv gets each extra as a spaceless --add-dir=, before the prompt", () => {
    const script = launch("claude", repos).command[2] ?? ""

    // `--add-dir <dir>` is variadic in claude and would swallow the positional prompt.
    expect(script).toContain("--add-dir=/wt/api-1")
    expect(script).toContain(`'--add-dir=/wt/it'\\''s docs'`)
    expect(script).not.toContain("--add-dir=/wt/web-1")
    expect(script.indexOf("--add-dir=/wt/api-1")).toBeLessThan(script.indexOf("This task spans repos"))
  })

  test("an engine without addDirArgv relies on env and the note alone", () => {
    const script = launch("kimi", repos).command[2] ?? ""

    expect(script).not.toContain("--add-dir")
    expect(script).toContain("ROVE_TASK_REPOS=")
    expect(script).toContain("ROVE_REPO_API_V2='/wt/api-1'")
  })

  test("exports the list and one variable per repo for engine and shell tabs alike", () => {
    const script = launch("claude", repos).command[2] ?? ""

    expect(script).toContain("ROVE_REPO_WEB='/wt/web-1'")
    expect(script).toContain("ROVE_REPO_API_V2='/wt/api-1'")
    expect(script).toContain("ROVE_REPO_DOCS=")
    const listed = JSON.parse(Object.fromEntries(repoEnv(repos)).ROVE_TASK_REPOS ?? "[]")
    expect(listed).toEqual([
      { name: "web", path: "/wt/web-1", branch: "feat/x", primary: true },
      { name: "api-v2", path: "/wt/api-1", branch: "feat/x", primary: false },
      { name: "docs", path: "/wt/it's docs", branch: "feat/x-2", primary: false },
    ])
    expect(shellIdentityInput("task-1", "tab-2", repoEnv(repos))).toContain("ROVE_REPO_API_V2=/wt/api-1")
  })

  test("the note rides the first prompt only, naming primary and extras", () => {
    const withPrompt = launch("claude", repos).command[2] ?? ""
    const resumed = buildEngineSessionLaunch({
      task: { id: "task-1", kind: "task", vendor: "claude", repo: "/src/web", repos },
      worktreePath: "/wt/web-1",
      shell: "/bin/zsh",
      argv: ["claude"],
      promptIntent: { kind: "none" },
      protocolGates: { status: () => false, notes: () => false, dispatcher: () => false },
    }).command[2]

    expect(withPrompt).toContain("Primary (cwd): web. Also checked out: api-v2 -> /wt/api-1 (branch feat/x)")
    expect(resumed).not.toContain("This task spans repos")
    // Env and argv still apply on a resume: the engine regains its extra directories.
    expect(resumed).toContain("--add-dir=/wt/api-1")
  })

  test("a one-repo task launches exactly as before", () => {
    const single = launch("claude", [repos[0] as TaskRepoView]).command[2] ?? ""
    const none = launch("claude", undefined).command[2] ?? ""

    expect(single).toBe(none)
    expect(none).not.toMatch(/--add-dir|ROVE_TASK_REPOS|ROVE_REPO_|spans repos/)
  })
})

describe("repos that are not all materialised", () => {
  test("a path-less extra is neither an --add-dir nor an env entry nor in the note", () => {
    const pending: TaskRepoView[] = [
      repos[0] as TaskRepoView,
      repos[1] as TaskRepoView,
      { name: "docs", repo: "/src/docs", branch: "", worktreePath: "", primary: false },
    ]
    const script = launch("claude", pending).command[2] ?? ""

    expect(script).not.toMatch(/--add-dir=(\s|'|$)/)
    expect(script).not.toContain("ROVE_REPO_DOCS")
    expect(script).not.toContain("docs ->")
    expect(script).toContain("--add-dir=/wt/api-1")
  })

  test("only one materialised repo left means nothing is exposed, in a shell tab too", () => {
    const lone: TaskRepoView[] = [
      repos[0] as TaskRepoView,
      { name: "api-v2", repo: "/src/api-v2", branch: "", worktreePath: "", primary: false },
    ]

    expect(launch("claude", lone).command[2]).not.toMatch(/--add-dir|ROVE_TASK_REPOS|spans repos/)
    expect(repoEnv([repos[0] as TaskRepoView])).toEqual([])
    expect(shellIdentityInput("task-1", "tab-2", repoEnv(lone))).not.toMatch(/ROVE_REPO|ROVE_TASK_REPOS/)
  })
})
