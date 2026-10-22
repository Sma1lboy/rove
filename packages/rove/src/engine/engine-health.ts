/**
 * One plain-language status per engine, for Settings → Engines in the TUI and
 * the web client alike: "Ready", "Not installed", "Sign in needed", … with a
 * tone for the dot beside it. The facts behind it (binary, login, hooks) are
 * spelled out in the engine's detail area; this is the one-glance summary.
 *
 * Pure and import-free on purpose: the web client imports it straight from here,
 * so the two surfaces cannot disagree on what "ready" means.
 */

/** `integration-status.ts`'s HookInstallState, plus "unsupported" for an engine with no hook adapter.
 *  Spelled out here, not imported: the web client typechecks this file without rove's `@/` paths. */
export type EngineHooks = "installed" | "outdated" | "not-installed" | "unsupported"

/** The part of `engine-status.ts`'s EngineStatus the login reading needs. */
interface StatusLike {
  readonly account: { readonly kind: string } | null
  readonly accountError?: string
}

/** Dot colour: green, amber, red, grey (nothing to fix here), grey (not known yet). */
export type EngineHealthTone = "ready" | "attention" | "error" | "absent" | "unknown"

export type EngineLogin = "yes" | "no" | "unknown"

export interface EngineHealthFacts {
  /** `undefined` = the probe has not landed; `null` = it failed. */
  readonly binaryFound: boolean | null | undefined
  readonly login: EngineLogin
  readonly hooks: EngineHooks
  /** Why Rove's hook merge into the engine's config is refused, when it is. */
  readonly configIssue?: string
  /**
   * A custom engine, or a launch-command override: a missing binary is then
   * "not on PATH" (the command points somewhere wrong), not "not installed".
   */
  readonly commandChosen: boolean
}

export interface EngineHealth {
  /** `settings.engines.status.*` key. */
  readonly key: string
  readonly tone: EngineHealthTone
}

/** The first thing wrong, in the order a person would fix them; "Ready" when nothing is. */
export function engineHealth(facts: EngineHealthFacts): EngineHealth {
  if (facts.binaryFound === undefined) return { key: "settings.engines.status.checking", tone: "unknown" }
  if (facts.binaryFound === null) return { key: "settings.engines.status.unknown", tone: "unknown" }
  if (!facts.binaryFound)
    return facts.commandChosen
      ? { key: "settings.engines.status.notOnPath", tone: "attention" }
      : { key: "settings.engines.status.notInstalled", tone: "absent" }
  if (facts.configIssue) return { key: "settings.engines.status.integrationBlocked", tone: "error" }
  if (facts.login === "no") return { key: "settings.engines.status.signIn", tone: "attention" }
  if (facts.hooks === "outdated") return { key: "settings.engines.status.integrationOutdated", tone: "attention" }
  if (facts.hooks === "not-installed") return { key: "settings.engines.status.integrationMissing", tone: "attention" }
  return { key: "settings.engines.status.ready", tone: "ready" }
}

/** Login as the status reads it: no detector (or a failed one) is "unknown", never "signed out". */
export function engineLogin(status: StatusLike | null | undefined): EngineLogin {
  if (!status || status.account === null || status.accountError) return "unknown"
  return status.account.kind === "none" ? "no" : "yes"
}
