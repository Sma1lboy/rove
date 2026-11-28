/** Import-free on purpose: the web client imports it straight from here, so both clients word a refused land alike. */

type Translate = (key: string, params?: Record<string, string | number>) => string

/**
 * What a land preflight that refused says, in the reader's words (`worktrees.land.refusal.*`). `t` answers a
 * missing key with the key itself; then the raw refusal stays behind `land.failed`.
 */
export function landRefusalText(
  t: Translate,
  pf: {
    readonly refusal: string
    readonly branch?: string
    readonly landedOn?: string
    readonly dirtyFiles?: readonly string[]
    readonly message?: string
  },
  branchLabel: string,
): string {
  const key = `worktrees.land.refusal.${pf.refusal}`
  const text = t(key, {
    branch: pf.branch ?? branchLabel,
    landedOn: pf.landedOn ?? "",
    files: (pf.dirtyFiles ?? []).join(", "),
  })
  return text === key ? t("worktrees.land.failed", { error: pf.message ?? pf.refusal }) : text
}
