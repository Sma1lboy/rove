import { readOnlyGitProcessEnv } from "@/lib/git-env"
import { recordSpawn } from "@/lib/spawn-profile"
import { readFirstNonEmptyRepoFile } from "../../lib/repo-config-file.ts"
import { spawnCapture } from "../lib/background-poll"

export interface PRPromptState {
  readonly branch: string
  readonly targetBranch: string
  readonly hasUpstream: boolean
  readonly dirtyCount: number
}

const GIT_TIMEOUT_MS = 5_000

const DEFAULT_PR_PROMPT_TEMPLATE = `The user likes the current state of the code.

{{dirtyCountSentence}}
The current branch is {{branch}}.
The target branch is {{targetBranch}}.

{{upstreamSentence}}
The user requested a PR.

Follow these steps to create a PR:

- If you have any skills related to creating PRs, invoke them now. Instructions there should take precedence over these instructions.
- Run \`git diff\` to review uncommitted changes.
- Commit them. Follow any instructions the user gave you about writing commit messages.
- Push to origin.
- Use \`gh pr create --base {{targetBranch}}\` to create a PR onto the target branch. Keep the title under 80 characters. If the repository has a pull request template, fill it in. Describe every change since the branch diverged from the target, not only the ones made in this session.

If any of these steps fail, ask the user for help.`

// Async: `git status` is O(repo size) and a spawnSync would block the Ops
// pane's render process until the timeout. Aborted via AbortSignal.
async function git(cwd: string, args: readonly string[]): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), GIT_TIMEOUT_MS)
  try {
    recordSpawn("tui.prPrompt", ["git", ...args], cwd)
    const out = await spawnCapture("git", args, {
      cwd,
      // `git status` would otherwise take `.git/index.lock` to refresh the stat
      // cache, racing the engine's commits. `GIT_OPTIONAL_LOCKS=0` avoids it.
      env: readOnlyGitProcessEnv(),
      signal: controller.signal,
    })
    if (controller.signal.aborted) return null
    if (out.status !== 0) return null
    return out.stdout.trim()
  } finally {
    clearTimeout(timer)
  }
}

async function currentBranch(cwd: string): Promise<string> {
  return (await git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"])) || "HEAD"
}

async function targetBranch(cwd: string): Promise<string> {
  const out = await git(cwd, ["symbolic-ref", "refs/remotes/origin/HEAD", "--short"])
  if (!out) return "main"
  return out.startsWith("origin/") ? out.slice("origin/".length) : out
}

async function hasUpstream(cwd: string): Promise<boolean> {
  const out = await git(cwd, ["rev-parse", "--abbrev-ref", "@{u}"])
  return out !== null && out.length > 0
}

async function dirtyCount(cwd: string): Promise<number> {
  const out = await git(cwd, ["status", "--porcelain"])
  if (!out) return 0
  return out.split("\n").filter((line) => line.length > 0).length
}

export async function gatherPRPromptState(worktree: string): Promise<PRPromptState> {
  const [branch, target, upstream, dirty] = await Promise.all([
    currentBranch(worktree),
    targetBranch(worktree),
    hasUpstream(worktree),
    dirtyCount(worktree),
  ])
  return {
    branch,
    targetBranch: target,
    hasUpstream: upstream,
    dirtyCount: dirty,
  }
}

function dirtyCountSentence(n: number): string {
  if (n <= 0) return "There are no uncommitted changes."
  if (n === 1) return "There is 1 uncommitted change."
  return `There are ${n} uncommitted changes.`
}

function upstreamSentence(hasUpstreamValue: boolean): string {
  return hasUpstreamValue ? "The current branch tracks an upstream." : "There is no upstream branch yet."
}

export function renderPRPrompt(template: string, state: PRPromptState): string {
  const replacements: Record<string, string> = {
    branch: state.branch,
    targetBranch: state.targetBranch,
    dirtyCountSentence: dirtyCountSentence(state.dirtyCount),
    upstreamSentence: upstreamSentence(state.hasUpstream),
  }
  return template.replace(/\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/g, (match, key: string) =>
    Object.hasOwn(replacements, key) ? (replacements[key] as string) : match,
  )
}

/**
 * Per-repo PR prompt override: `.rove/`, then `.kobe/` fallback. First
 * NON-EMPTY file wins; an empty file is a placeholder, not a blank prompt.
 */
const PR_INSTRUCTION_FILENAME = "pr-instructions.md"

function loadTemplate(worktree: string): string {
  return readFirstNonEmptyRepoFile(worktree, PR_INSTRUCTION_FILENAME) ?? DEFAULT_PR_PROMPT_TEMPLATE
}

export async function buildPRPrompt(worktree: string, state?: PRPromptState): Promise<string> {
  const resolved = state ?? (await gatherPRPromptState(worktree))
  return renderPRPrompt(loadTemplate(worktree), resolved)
}
