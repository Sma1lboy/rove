import { t } from "../tui/i18n"

/** Preserve RPC remediation when present; unknown failures start with read-only diagnosis. */
export function failureHint(error: unknown, cliName = "rove"): string {
  const details = typeof error === "object" && error !== null ? error : null
  const hint = details && "hint" in details && typeof details.hint === "string" ? details.hint : null
  const args = details && "nextCommandArgs" in details ? details.nextCommandArgs : null
  const command =
    Array.isArray(args) && args.length > 0 && args.every((arg) => typeof arg === "string")
      ? [cliName, ...args]
          .map((arg) => (/^[\w./:@=-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", "'\\''")}'`))
          .join(" ")
      : null
  return [hint, command].filter(Boolean).join("\n") || t("common.failureHint", { command: `${cliName} doctor` })
}
