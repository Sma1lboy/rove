/**
 * Settings → Auto routing: what each depth tier launches (engine · model · effort, with the
 * gate's verdict) and who picks a tier. The tier editor is the TUI's change-engine picker as an
 * inline form. The classifier endpoint, threshold and key are shown, never edited here: they are
 * a destination and a secret the Mac would use.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import type { BridgeClient } from "./bridge.ts"
import { errorText } from "./dialogs.tsx"
import { t } from "./i18n/index.ts"
import { lastReply, requestRemembered } from "./remembered.ts"
import { ts, tt } from "./settings-copy.ts"
import { Group, ReadOnlyRow } from "./settings-rows.tsx"
import { toast } from "./ui.ts"
import { buttonClass } from "./ui/button.tsx"
import { CHIPS_ROW, chipClass } from "./ui/form.ts"
import {
  PREF_CYCLE,
  PREF_CYCLE_LABEL,
  PREF_HINT,
  SETTINGS_ROWS,
  TIER_EDITOR,
  TIER_HEAD,
  TIER_ROW,
  engineDetailClass,
} from "./ui/settings.ts"
import { ACTIONS, INPUT, LINK, PLACEHOLDER_LINE } from "./ui/text.ts"

interface Tier {
  readonly tier: "swift" | "standard" | "deep"
  readonly engine: string
  readonly engineName: string
  readonly model: string | null
  readonly effort: string | null
  readonly block: string | null
}
interface PickableEngine {
  readonly id: string
  readonly name: string
  readonly effortLevels: readonly string[]
  readonly takesModel: boolean
}
interface Classifier {
  readonly mode: "off" | "jev" | "custom"
  readonly endpointHost: string
  readonly canCustom: boolean
  readonly threshold: number
  readonly keyConfigured: boolean
  readonly keySource: "env" | "file" | "none"
  readonly keyEnv?: string
}
interface Routing {
  readonly configured: boolean
  readonly tiers: readonly Tier[]
  readonly engines: readonly PickableEngine[]
  readonly classifier: Classifier
}

function TierEditor(props: {
  tier: Tier
  engines: readonly PickableEngine[]
  onSave: (engine: string, model: string, effort: string) => void
  onCancel: () => void
}) {
  const [engine, setEngine] = useState(props.tier.engine)
  const [model, setModel] = useState(props.tier.model ?? "")
  const [effort, setEffort] = useState(props.tier.effort ?? "")
  const picked = props.engines.find((e) => e.id === engine)
  return (
    <form
      className={TIER_EDITOR}
      onSubmit={(e) => {
        e.preventDefault()
        props.onSave(engine, picked?.takesModel ? model.trim() : "", effort)
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation()
          props.onCancel()
        }
      }}
    >
      <div className={CHIPS_ROW}>
        {props.engines.map((e) => (
          <button
            type="button"
            key={e.id}
            aria-pressed={e.id === engine}
            className={chipClass(e.id === engine)}
            onClick={() => {
              setEngine(e.id)
              if (!e.effortLevels.includes(effort)) setEffort("")
              if (!e.takesModel) setModel("")
            }}
          >
            {e.name}
          </button>
        ))}
      </div>
      {picked && picked.effortLevels.length > 0 && (
        <div className={CHIPS_ROW}>
          {["", ...picked.effortLevels].map((level) => (
            <button
              type="button"
              key={level || "default"}
              aria-pressed={level === effort}
              className={chipClass(level === effort)}
              onClick={() => setEffort(level)}
            >
              {level || ts("autoRouting.engineDefault")}
            </button>
          ))}
        </div>
      )}
      {picked?.takesModel && (
        <input
          className={INPUT}
          value={model}
          spellCheck={false}
          placeholder={ts("autoRouting.engineDefault")}
          aria-label={t("prefs.tierModel")}
          onChange={(e) => setModel(e.target.value)}
        />
      )}
      <div className={ACTIONS}>
        <button type="button" className={LINK} onClick={props.onCancel}>
          {t("dialog.cancel")}
        </button>
        <button type="submit" className={buttonClass()}>
          {ts("action.save")}
        </button>
      </div>
    </form>
  )
}

/** The classifier's own cycle, as the TUI's: off → jev → custom (only when remembered) → off. */
function nextMode(c: Classifier): Classifier["mode"] {
  return c.mode === "off" ? "jev" : c.mode === "jev" && c.canCustom ? "custom" : "off"
}

export function RoutingSection({ client }: { client: BridgeClient }) {
  const [routing, setRouting] = useState<Routing | null>(() => lastReply<Routing>(client, "autoRouting.get") ?? null)
  const [editing, setEditing] = useState<Tier["tier"] | null>(null)
  const load = useCallback(
    () => requestRemembered<Routing>(client, "autoRouting.get").then(setRouting, (e) => toast(errorText(e), "error")),
    [client],
  )
  useEffect(() => {
    void load()
  }, [load])
  // The mode the next press advances from: the last one requested, not the last one rendered.
  const mode = useRef<{ next: Classifier["mode"]; inFlight: number } | null>(null)
  const write = (op: string, args: Record<string, unknown>) =>
    client
      .request(op, args)
      .then(load)
      .catch((e) => toast(errorText(e), "error"))
  if (!routing) return <p className={PLACEHOLDER_LINE}>{t("preview.loading")}</p>
  const c = routing.classifier
  const modeLabel =
    c.mode === "off"
      ? ts("autoRouting.classifierOff")
      : c.mode === "jev"
        ? "jev"
        : ts("autoRouting.classifierCustomLabel")
  const modeHint =
    c.mode === "off"
      ? ts("autoRouting.classifierOffHint")
      : c.mode === "jev"
        ? ts("autoRouting.classifierJevHint")
        : ts("autoRouting.classifierCustomHint")
  const keyLine =
    c.keySource === "env"
      ? ts("autoRouting.keyPresentEnv", { env: c.keyEnv ?? "" })
      : c.keySource === "file"
        ? ts("autoRouting.keySaved")
        : c.keyConfigured
          ? ts("autoRouting.keyMissing")
          : ts("autoRouting.keyCustomUnused")
  return (
    <>
      <Group title={ts("autoRouting.title")} hint={ts("autoRouting.hint")}>
        {!routing.configured && <p className="text-warning">{ts("autoRouting.unconfigured")}</p>}
        <div className={SETTINGS_ROWS}>
          {routing.tiers.map((row) => (
            <div key={row.tier} className={TIER_ROW}>
              <div className={TIER_HEAD}>
                <span className="engine-name">{tt(`tier.${row.tier}`)}</span>
                <span className="mono text-muted">
                  {[
                    row.engineName,
                    row.model ?? ts("autoRouting.engineDefault"),
                    row.effort ?? ts("autoRouting.engineDefault"),
                  ].join(", ")}
                </span>
                <button
                  type="button"
                  className={`${LINK} ml-auto`}
                  onClick={() => setEditing(editing === row.tier ? null : row.tier)}
                >
                  {t("prefs.tierEdit")}
                </button>
              </div>
              <span className={`text-muted ${engineDetailClass()}`}>{tt(`tierDesc.${row.tier}`)}</span>
              <span className={`${engineDetailClass()} ${row.block ? "text-warning" : "text-success"}`}>
                {row.block ? ts("autoRouting.unavailable", { reason: row.block }) : ts("autoRouting.ready")}
              </span>
              {editing === row.tier && (
                <TierEditor
                  tier={row}
                  engines={routing.engines}
                  onCancel={() => setEditing(null)}
                  onSave={(engine, model, effort) => {
                    setEditing(null)
                    void write("autoRouting.setTier", { tier: row.tier, engine, model, effort })
                  }}
                />
              )}
            </div>
          ))}
        </div>
      </Group>
      <Group title={ts("autoRouting.classifierTitle")} hint={ts("autoRouting.classifierHint")}>
        <p className={c.mode === "off" ? "text-muted" : "text-warning"}>{ts("autoRouting.classifierDataFlow")}</p>
        <button
          type="button"
          className={PREF_CYCLE}
          onClick={() => {
            const next = nextMode({ ...c, mode: mode.current?.next ?? c.mode })
            const pending = { next, inFlight: (mode.current?.inFlight ?? 0) + 1 }
            mode.current = pending
            void write("autoRouting.setClassifier", { mode: next }).then(() => {
              if (mode.current && --mode.current.inFlight === 0) mode.current = null
            })
          }}
        >
          <span className={PREF_CYCLE_LABEL}>
            {ts("autoRouting.classifierLabel")}: {modeLabel}
          </span>
          <span className={`${PREF_HINT} text-muted`}>{modeHint}</span>
        </button>
        <ReadOnlyRow
          label={`${ts("autoRouting.endpointLabel")}: ${c.endpointHost || t("prefs.unset")}`}
          note={t("prefs.editInTui")}
        />
        <ReadOnlyRow
          label={`${ts("autoRouting.thresholdLabel")}: ${c.threshold.toFixed(2)}`}
          note={t("prefs.editInTui")}
        />
        <ReadOnlyRow label={`${ts("autoRouting.keyLabel")}: ${keyLine}`} note={t("prefs.editInTui")} />
      </Group>
    </>
  )
}
