/**
 * Settings → Auto effort, the classifier half: who PICKS a tier.
 *
 * Its own hook beside `use-auto-effort-settings.ts` because the two answer
 * different questions on the same screen — that file owns what a tier RUNS
 * (the table, the gate, the engine picker), this one owns who CHOOSES one
 * (the mode, the endpoint, the confidence floor). They share no state.
 *
 * The stored key stays exactly what `engine/auto-effort-classifier.ts`
 * reads — `off` / `jev` / a URL — so this hook adds no second spelling of
 * the setting for the CLI to disagree with. `custom` is a mode in the UI, a
 * URL on disk. The endpoint a user typed is remembered separately so that
 * cycling off and back does not lose it, the way `worktreeBaseCustom`
 * remembers a path the base cycle is not currently pointing at.
 */

import { readClassifierConfig } from "../../../engine/auto-effort-classifier"
import type { KVContext } from "../../context/kv"
import { useT } from "../../i18n"
import type { DialogContext } from "../../ui/dialog"
import { DialogConfirm } from "../../ui/dialog-confirm"
import { RenameTaskDialog } from "../rename-task-dialog"

const MODE_KEY = "autoEffort.classifier"
/** The last endpoint typed, kept while the mode points elsewhere. */
const ENDPOINT_KEY = "autoEffort.classifierEndpoint"
const THRESHOLD_KEY = "autoEffort.classifierThreshold"

export type ClassifierMode = "off" | "jev" | "custom"

export interface ClassifierSettings {
  readonly mode: ClassifierMode
  /** The custom endpoint — the live one in custom mode, else the remembered one. */
  readonly endpoint: string
  readonly threshold: number
  /** Name of the env var the bearer token comes from. */
  readonly keyEnv: string
  /**
   * Whether that variable is set in THIS process. The commonest way for the
   * classifier to do nothing at all is a missing key, and a setting that is
   * on while the key is absent looks identical to one that is working — so
   * the section says which it is rather than leaving the user to guess from
   * tiers that never pre-fill.
   */
  readonly keyPresent: boolean
  /** off → jev → custom → off. Custom is skipped when nothing is remembered. */
  readonly cycle: () => void
  readonly editEndpoint: () => Promise<void>
  readonly editThreshold: () => Promise<void>
}

function stringAt(kv: KVContext, key: string): string {
  const v = kv.get(key, "")
  return typeof v === "string" ? v.trim() : ""
}

export function useClassifierSettings(
  kv: KVContext,
  dialog: DialogContext,
  env: NodeJS.ProcessEnv = process.env,
): ClassifierSettings {
  const t = useT()
  // Read through the SAME parser the CLI uses, so a value this screen calls
  // `off` is one the classifier also treats as off — including the typo case
  // (anything unrecognised is off), which a second `=== "jev"` here would
  // quietly disagree about.
  const config = readClassifierConfig((key) => kv.get(key))
  const mode: ClassifierMode = config.mode.kind === "url" ? "custom" : config.mode.kind
  const remembered = stringAt(kv, ENDPOINT_KEY)
  const endpoint = config.mode.kind === "url" ? config.mode.url : remembered

  function cycle(): void {
    if (mode === "off") {
      kv.set(MODE_KEY, "jev")
      return
    }
    if (mode === "jev") {
      // Nothing remembered means there is no custom mode to land on — going
      // to `off` is the honest stop, and the endpoint row is how you get to
      // custom the first time.
      kv.set(MODE_KEY, remembered || "off")
      return
    }
    // Leaving custom: keep the URL so the next pass through finds it.
    if (endpoint) kv.set(ENDPOINT_KEY, endpoint)
    kv.set(MODE_KEY, "off")
  }

  async function editEndpoint(): Promise<void> {
    const next = await RenameTaskDialog.show(dialog, endpoint, {
      dialogTitle: t("settings.autoEffort.endpointTitle"),
      fieldLabel: t("settings.autoEffort.endpointField"),
      submitLabel: t("settings.action.save"),
      placeholder: "https://tiers.internal/pick",
      allowEmpty: true,
    })
    if (next === undefined) return
    const url = next.trim()
    if (!url) {
      // Cleared: forget it, and fall back to off rather than leaving the mode
      // pointing at an empty string the classifier would read as off anyway.
      kv.set(ENDPOINT_KEY, "")
      if (mode === "custom") kv.set(MODE_KEY, "off")
      return
    }
    if (!/^https?:\/\/\S+$/.test(url)) {
      await DialogConfirm.show(
        dialog,
        t("settings.autoEffort.endpointInvalidTitle"),
        t("settings.autoEffort.endpointInvalidBody"),
        "cancel",
      )
      return
    }
    kv.set(ENDPOINT_KEY, url)
    // An endpoint typed here should take effect — the same rule the custom
    // editor command follows.
    kv.set(MODE_KEY, url)
  }

  async function editThreshold(): Promise<void> {
    const next = await RenameTaskDialog.show(dialog, config.threshold.toFixed(2), {
      dialogTitle: t("settings.autoEffort.thresholdTitle"),
      fieldLabel: t("settings.autoEffort.thresholdField"),
      submitLabel: t("settings.action.save"),
      placeholder: "0.50",
    })
    if (next === undefined) return
    const n = Number.parseFloat(next.trim())
    if (!Number.isFinite(n) || n < 0 || n > 1) {
      await DialogConfirm.show(
        dialog,
        t("settings.autoEffort.thresholdInvalidTitle"),
        t("settings.autoEffort.thresholdInvalidBody"),
        "cancel",
      )
      return
    }
    kv.set(THRESHOLD_KEY, n)
  }

  return {
    mode,
    endpoint,
    threshold: config.threshold,
    keyEnv: config.keyEnv,
    keyPresent: Boolean(env[config.keyEnv]?.trim()),
    cycle,
    editEndpoint,
    editThreshold,
  }
}
