/** What the report card says about a task, and the two markdown texts it copies. Pure: the view feeds it. */

export interface ReportFacts {
  readonly title: string
  readonly branch: string
  readonly base: string | null
  readonly files: number
  readonly added: number
  readonly removed: number
  /** The worker's own report, else the last reply; `reported` says which. */
  readonly text: string | null
  readonly reported: boolean
  readonly checks: string | null
  readonly openTodos: readonly string[]
  readonly pr: { readonly number?: number; readonly url?: string } | null
}

const shape = (f: ReportFacts): string =>
  `${f.files} file${f.files === 1 ? "" : "s"}, +${f.added} −${f.removed}${f.base ? ` vs ${f.base}` : ""}`

/** Plain markdown for Slack, Linear or a message to a person. */
export function asNote(f: ReportFacts): string {
  const lines = [`**${f.title}**`, `Branch \`${f.branch}\` · ${shape(f)}`]
  if (f.pr?.url) lines.push(`PR: ${f.pr.url}`)
  if (f.checks) lines.push(`Checks: ${f.checks}`)
  if (f.text) lines.push("", f.reported ? f.text : `Last reply:\n${f.text}`)
  if (f.openTodos.length > 0) lines.push("", "Still open:", ...f.openTodos.map((todo) => `- ${todo}`))
  return lines.join("\n")
}

/** The same facts as a pull request description. */
export function asPrBody(f: ReportFacts): string {
  const lines = ["## Summary", "", f.text ?? f.title, "", "## Changes", "", `- ${shape(f)} on \`${f.branch}\``]
  if (f.checks) lines.push(`- Checks: ${f.checks}`)
  if (f.openTodos.length > 0) lines.push("", "## Not done", "", ...f.openTodos.map((todo) => `- [ ] ${todo}`))
  return lines.join("\n")
}

/** `3 passed · 1 failed` from a checks reply's counts; null when there are none. */
export function checksLine(counts: { pass: number; fail: number; pending: number }): string | null {
  const parts = [
    counts.pass ? `${counts.pass} passed` : "",
    counts.fail ? `${counts.fail} failed` : "",
    counts.pending ? `${counts.pending} pending` : "",
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(" · ") : null
}
