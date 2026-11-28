/** One engine's detail, shared by the desktop's open row and the phone's sheet: the row's shape, its health, the detection facts and the rename form. */

import { type EngineHealthTone, engineHealth } from "@sma1lboy/rove/src/engine/engine-health.ts"
import { useState } from "react"
import { t } from "./i18n/index.ts"
import { ts } from "./settings-copy.ts"
import { Button } from "./ui/button.tsx"
import { ENG_ACTIONS, ENG_FACTS, ENG_FACT_TERM, ENG_RENAME_INPUT, type EngTone, engFactClass } from "./ui/settings.ts"
import { INPUT_FRAME } from "./ui/text.ts"

/** `engines.settings` row, trimmed to what the page shows. */
export interface EngineSetting {
  readonly id: string
  readonly name: string
  readonly custom: boolean
  readonly enabled: boolean
  readonly isDefault: boolean
  readonly canBeDefault: boolean
  readonly binary: string
  readonly customized: boolean
  /** The registry's name when the user renamed the engine. */
  readonly renamedFrom?: string | null
  readonly protocol?: string | null
  readonly binaryFound: boolean | null
  readonly binaryPath?: string | null
  readonly login: "yes" | "no" | "unknown"
  readonly hooks: "installed" | "outdated" | "not-installed" | "unsupported"
  readonly markers: boolean
  readonly screen: boolean
  readonly configIssue?: string
  /** The Rove agent skill copy; "unsupported" when the engine isn't set up here or takes none. */
  readonly skill: "installed" | "outdated" | "not-installed" | "unsupported"
}

export type Run = (op: string, args?: Record<string, unknown>) => void

export function health(e: EngineSetting) {
  return engineHealth({
    binaryFound: e.binaryFound,
    login: e.login,
    hooks: e.hooks,
    configIssue: e.configIssue,
    commandChosen: e.custom || e.customized,
  })
}

export const TONE: Record<EngineHealthTone, EngTone> = {
  ready: "ready",
  attention: "attention",
  error: "error",
  absent: "absent",
  unknown: "absent",
}

function hooksSentence(e: EngineSetting): string {
  if (e.configIssue) return ts("engines.detail.hooksBlockedHere", { reason: e.configIssue })
  switch (e.hooks) {
    case "installed":
      return ts("engines.detail.hooksInstalled")
    case "outdated":
      return ts("engines.detail.hooksOutdated")
    case "not-installed":
      return e.binaryFound === false ? ts("engines.detail.hooksAwaitEngine") : ts("engines.detail.hooksMissing")
    default:
      return ts("engines.detail.hooksUnsupported")
  }
}

/** What Rove found for an engine: its program, sign-in, reporting, skill and adapter. */
export function EngineFacts({ engine: e }: { engine: EngineSetting }) {
  const program =
    e.binaryFound === true
      ? ts("engines.detail.programFound", { binary: e.binary, path: e.binaryPath ?? e.binary })
      : e.binaryFound === false
        ? ts("engines.detail.programMissing", { binary: e.binary })
        : ts("engines.detail.programUnknown", { binary: e.binary })
  const signIn =
    e.login === "yes"
      ? ts("engines.detail.signedIn")
      : e.login === "no"
        ? ts("engines.detail.signedOut")
        : ts("engines.detail.signInUnknown")
  const reporting = [
    hooksSentence(e),
    ts(e.markers ? "engines.detail.markersYes" : "engines.detail.markersNo"),
    ts(
      e.screen
        ? "engines.detail.screenYes"
        : e.hooks === "installed"
          ? "engines.detail.screenNotNeeded"
          : "engines.detail.screenNo",
    ),
  ]
  return (
    <dl className={ENG_FACTS}>
      <dt className={ENG_FACT_TERM}>{ts("engines.detail.program")}</dt>
      <dd className={engFactClass(e.binaryFound === false)}>{program}</dd>
      <dt className={ENG_FACT_TERM}>{ts("engines.detail.signIn")}</dt>
      <dd className={engFactClass(e.login === "no")}>{signIn}</dd>
      <dt className={ENG_FACT_TERM}>{ts("engines.detail.reporting")}</dt>
      <dd className={engFactClass(false)}>
        {reporting.map((line) => (
          <span key={line} className="block">
            {line}
          </span>
        ))}
      </dd>
      {e.skill !== "unsupported" ? (
        <>
          <dt className={ENG_FACT_TERM}>{ts("engines.detail.skill")}</dt>
          <dd className={engFactClass(e.skill !== "installed")}>
            {ts(
              e.skill === "installed"
                ? "engines.detail.skillInstalledHere"
                : e.skill === "outdated"
                  ? "engines.detail.skillOutdated"
                  : "engines.detail.skillMissing",
            )}
          </dd>
        </>
      ) : null}
      {e.custom ? (
        <>
          <dt className={ENG_FACT_TERM}>{ts("engines.detail.adapter")}</dt>
          <dd className={engFactClass(false)}>
            {e.protocol
              ? ts("engines.detail.adapterDeclared", { protocol: e.protocol })
              : ts("engines.detail.adapterGeneric")}
          </dd>
        </>
      ) : null}
    </dl>
  )
}

/** The rename field with Save and Cancel; Esc cancels it alone. */
export function EngineRename(props: { name: string; onSave: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState(props.name)
  return (
    <form
      className={ENG_ACTIONS}
      onSubmit={(ev) => {
        ev.preventDefault()
        props.onSave(name)
      }}
    >
      <input
        className={`${INPUT_FRAME} w-full ${ENG_RENAME_INPUT}`}
        // biome-ignore lint/a11y/noAutofocus: the rename field just opened
        autoFocus
        value={name}
        aria-label={t("settings.engines.rename")}
        placeholder={t("settings.engines.namePlaceholder")}
        onChange={(ev) => setName(ev.target.value)}
        onKeyDown={(ev) => {
          if (ev.key === "Escape") {
            ev.stopPropagation()
            props.onCancel()
          }
        }}
      />
      <Button variant="filled" type="submit">
        {t("settings.engines.save")}
      </Button>
      <Button variant="action" onClick={props.onCancel}>
        {t("settings.engines.cancel")}
      </Button>
    </form>
  )
}
