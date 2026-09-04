/**
 * The "fix my CI" engine prompt, built from a PR's failing checks.
 *
 * Sibling of `pr-prompt.ts` and shaped like it: a default template with
 * `{{token}}` holes, a per-repo override file, and a pure renderer so vitest
 * can pin the wording without a repo, a daemon, or `gh`. The difference is
 * where the facts come from — `pr-prompt.ts` reads git itself, while the
 * failing-check logs arrive already fetched from the daemon's
 * `pr.failingChecks` RPC (the daemon is the only thing in the tree that
 * spawns `gh`).
 *
 * The log tails are pasted VERBATIM inside a fenced block. They are CI output,
 * not instructions, and an engine reading them should treat them as evidence;
 * the surrounding template is what tells it what to do.
 */

import { promises as fs } from "node:fs"
import path from "node:path"

/** One failing check as the daemon's `pr.failingChecks` returns it. */
export interface CIFailingCheck {
  readonly jobName: string
  readonly conclusion: string
  readonly url: string
  readonly tail: string
}

export interface CIPromptState {
  readonly branch: string
  readonly prNumber?: number
  readonly checks: readonly CIFailingCheck[]
  /** Failing checks before the daemon's report cap, when more than were sent. */
  readonly totalFailing?: number
}

const DEFAULT_CI_PROMPT_TEMPLATE = `CI is failing on this branch and the user wants it green.

The current branch is {{branch}}.
{{prSentence}}
{{jobsSentence}}

{{logs}}

Follow these steps:

- Read the log excerpts above and name the actual failure before changing anything — a job can fail for a reason its last line does not state.
- Reproduce it locally where you can. Prefer the same command the job ran.
- Fix the cause, not the symptom, and do not weaken a gate to make it pass.
- Re-run the local equivalent of the failing job before pushing.

If the log excerpt is empty or does not explain the failure, say so and ask the user for help rather than guessing.`

function prSentence(prNumber: number | undefined): string {
  return prNumber === undefined ? "There is no PR number recorded." : `The pull request is #${prNumber}.`
}

function jobsSentence(state: CIPromptState): string {
  const names = state.checks.map((check) => `${check.jobName} (${check.conclusion.toLowerCase()})`)
  if (names.length === 0) return "No failing job was reported."
  const total = state.totalFailing ?? names.length
  const extra = total > names.length ? ` ${total - names.length} further failing check(s) are not shown.` : ""
  const head = names.length === 1 ? `The failing job is ${names[0]}.` : `The failing jobs are ${names.join(", ")}.`
  return `${head}${extra}`
}

/**
 * The per-job log sections. A check whose tail could not be read still gets a
 * section saying so: "the log is unavailable" is a different instruction to
 * the engine than silence, which would read as "this job logged nothing".
 */
function logs(checks: readonly CIFailingCheck[]): string {
  if (checks.length === 0) return ""
  return checks
    .map((check) => {
      const header = check.url ? `### ${check.jobName} — ${check.url}` : `### ${check.jobName}`
      const body =
        check.tail.length > 0
          ? `\`\`\`\n${check.tail}\n\`\`\``
          : "(no log available — open the job in a browser to read it)"
      return `${header}\n\n${body}`
    })
    .join("\n\n")
}

export function renderCIPrompt(template: string, state: CIPromptState): string {
  const replacements: Record<string, string> = {
    branch: state.branch,
    prSentence: prSentence(state.prNumber),
    jobsSentence: jobsSentence(state),
    logs: logs(state.checks),
  }
  return template.replace(/\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/g, (match, key: string) =>
    Object.hasOwn(replacements, key) ? (replacements[key] as string) : match,
  )
}

/**
 * Per-repo CI instruction overrides, canonical spelling first — the same
 * `.rove/` → `.kobe/` fallback pair `pr-prompt.ts` reads for its own template.
 * First readable NON-EMPTY file wins.
 */
const CI_INSTRUCTION_RELS = [
  path.join(".rove", "ci-instructions.md"),
  path.join(".kobe", "ci-instructions.md"),
] as const

async function loadTemplate(worktree: string): Promise<string> {
  for (const relative of CI_INSTRUCTION_RELS) {
    try {
      const text = await fs.readFile(path.join(worktree, relative), "utf8")
      if (text.length > 0) return text
    } catch {
      // An unreadable/absent file does not block the next candidate.
    }
  }
  return DEFAULT_CI_PROMPT_TEMPLATE
}

/** Pure entry point (the unit-tested one): default template + state. */
export function buildCIPrompt(state: CIPromptState): string {
  return renderCIPrompt(DEFAULT_CI_PROMPT_TEMPLATE, state)
}

/** The repo-aware build the action uses — same shape as `buildPRPrompt`. */
export async function buildCIPromptForWorktree(worktree: string, state: CIPromptState): Promise<string> {
  return renderCIPrompt(await loadTemplate(worktree), state)
}
