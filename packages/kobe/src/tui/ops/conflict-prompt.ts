/**
 * The "resolve these merge conflicts" engine prompt.
 *
 * Third sibling of `pr-prompt.ts` and `ci-prompt.ts`, and shaped like them: a
 * default template with `{{token}}` holes, a per-repo override file, and a
 * pure renderer so vitest can pin the wording without a repo or a daemon. The
 * facts arrive from the daemon's `task.syncBase` refusal — the base ref the
 * merge was started from and the paths git left unmerged — so this module
 * reads nothing itself.
 *
 * What the prompt asks for is a MERGE completed in place, never a rebase: the
 * merge that hit the conflict is still in progress in the worktree (see
 * `orchestrator/sync-base.ts` for why it is left there), and finishing it is
 * one `git commit` once the markers are gone. A rebase would throw that state
 * away and replay the branch under an engine that may be mid-edit.
 */

import { readFirstNonEmptyRepoFile } from "../../lib/repo-config-file.ts"

export interface ConflictPromptState {
  readonly branch: string
  /** The ref merged into the branch — `origin/main`, `main`, … */
  readonly baseRef: string
  /** Worktree-relative paths git reports as unmerged. */
  readonly files: readonly string[]
}

const DEFAULT_CONFLICT_PROMPT_TEMPLATE = `Merging the base branch into this branch hit conflicts, and the user wants them resolved.

The current branch is {{branch}}. The base is {{baseRef}}. \`git merge {{baseRef}}\` has already been run in this worktree and stopped on the conflicts below — the merge is still in progress. Do not abort it, and do not rebase.

{{filesSentence}}

{{files}}

Follow these steps:

- Read each conflicted file whole and understand both sides before editing: this branch's side is what this task set out to do, the base's side is what landed on {{baseRef}} in the meantime. Keep both where they do not contradict; where they do, preserve this task's intent and adapt it to the base's new shape.
- Remove every conflict marker. \`git diff --name-only --diff-filter=U\` must come back empty when you are done.
- Run the tests or build that cover the files you touched.
- Stage the resolved files and complete the merge with \`git commit --no-edit\`. Do not squash, and do not touch {{baseRef}} itself.

If a conflict needs a decision only the user can make, name the file and the choice, and ask rather than guessing.`

function filesSentence(files: readonly string[]): string {
  if (files.length === 0) return "Git reported no unmerged paths."
  return files.length === 1 ? "There is 1 conflicted file." : `There are ${files.length} conflicted files.`
}

function fileList(files: readonly string[]): string {
  return files.map((file) => `- \`${file}\``).join("\n")
}

export function renderConflictPrompt(template: string, state: ConflictPromptState): string {
  const replacements: Record<string, string> = {
    branch: state.branch,
    baseRef: state.baseRef,
    filesSentence: filesSentence(state.files),
    files: fileList(state.files),
  }
  return template.replace(/\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/g, (match, key: string) =>
    Object.hasOwn(replacements, key) ? (replacements[key] as string) : match,
  )
}

/**
 * Per-repo override, canonical spelling first — the same `.rove/` → `.kobe/`
 * fallback pair `pr-prompt.ts` and `ci-prompt.ts` read for their templates.
 * First readable NON-EMPTY file wins.
 */
const CONFLICT_INSTRUCTION_FILENAME = "conflict-instructions.md"

function loadTemplate(worktree: string): string {
  return readFirstNonEmptyRepoFile(worktree, CONFLICT_INSTRUCTION_FILENAME) ?? DEFAULT_CONFLICT_PROMPT_TEMPLATE
}

/** Pure entry point (the unit-tested one): default template + state. */
export function buildConflictPrompt(state: ConflictPromptState): string {
  return renderConflictPrompt(DEFAULT_CONFLICT_PROMPT_TEMPLATE, state)
}

/** The repo-aware build the action uses — same shape as `buildCIPromptForWorktree`. */
export async function buildConflictPromptForWorktree(worktree: string, state: ConflictPromptState): Promise<string> {
  return renderConflictPrompt(loadTemplate(worktree), state)
}
