/**
 * Settings → Auto routing: what each depth tier launches (engine · model · effort, with the
 * gate's verdict) and who picks a tier. The tier editor is the TUI's change-engine picker as an
 * inline form. The classifier endpoint, threshold and key are shown, never edited here: they are
 * a destination and a secret the Mac would use.
 */

import { useCallback, useEffect, useState } from "react"
import type { BridgeClient } from "./bridge.ts"
import { errorText } from "./dialogs.tsx"
import { t } from "./i18n/index.ts"
import { lastReply, requestRemembered } from "./remembered.ts"
import { ts, tt } from "./settings-copy.ts"
import { Choice, Group, ReadOnlyRow, Row } from "./settings-rows.tsx"
import { toast } from "./ui.ts"
import { Button } from "./ui/button.tsx"
import { Segmented } from "./ui/segmented.tsx"
import {
  SETTINGS_ACTIONS,
  SETTINGS_INPUT,
  SETTINGS_NAME,
  SETTINGS_NOTE,
  SETTINGS_STATUS,
  TIER_EDITOR,
  TIER_HEAD,
  TIER_ROW,
} from "./ui/settings.ts"

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
      <Segmented
        label={ts("sections.engines")}
        value={engine}
        picks={props.engines.map((e) => ({ value: e.id, label: e.name }))}
        onPick={(id) => {
          const next = props.engines.find((e) => e.id === id)
          setEngine(id)
          if (next && !next.effortLevels.includes(effort)) setEffort("")
          if (next && !next.takesModel) setModel("")
        }}
      />
      {picked && picked.effortLevels.length > 0 && (
        <Segmented
          label={t("prefs.tierEffort")}
          value={effort}
          picks={["", ...picked.effortLevels].map((level) => ({
            value: level,
            label: level || ts("autoRouting.engineDefault"),
          }))}
          onPick={setEffort}
        />
      )}
      {picked?.takesModel && (
        <input
          className={SETTINGS_INPUT}
          value={model}
          spellCheck={false}
          placeholder={ts("autoRouting.engineDefault")}
          aria-label={t("prefs.tierModel")}
          onChange={(e) => setModel(e.target.value)}
        />
      )}
      <div className={SETTINGS_ACTIONS}>
        <Button onClick={props.onCancel}>{t("dialog.cancel")}</Button>
        <Button variant="filled" type="submit">
          {ts("action.save")}
        </Button>
      </div>
    </form>
  )
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
  const write = (op: string, args: Record<string, unknown>) =>
    client
      .request(op, args)
      .then(load)
      .catch((e) => toast(errorText(e), "error"))
  if (!routing) return <p className={SETTINGS_STATUS}>{t("preview.loading")}</p>
  const c = routing.classifier
  const modes: { value: Classifier["mode"]; label: string }[] = [
    { value: "off", label: ts("autoRouting.classifierOff") },
    { value: "jev", label: "jev" },
    // `custom` is offered once an endpoint is remembered, as the TUI's cycle skips it until then.
    ...(c.canCustom || c.mode === "custom"
      ? [{ value: "custom" as const, label: ts("autoRouting.classifierCustomLabel") }]
      : []),
  ]
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
      <Group hint={ts("autoRouting.hint")}>
        {!routing.configured && <Row label={<span className="text-warning">{ts("autoRouting.unconfigured")}</span>} />}
        {routing.tiers.map((row) => (
          <div key={row.tier} className={TIER_ROW}>
            <div className={TIER_HEAD}>
              <span className={SETTINGS_NAME}>{tt(`tier.${row.tier}`)}</span>
              <span className={`${SETTINGS_NOTE} min-w-0 truncate`}>
                {[
                  row.engineName,
                  row.model ?? ts("autoRouting.engineDefault"),
                  row.effort ?? ts("autoRouting.engineDefault"),
                ].join(" · ")}
              </span>
              <Button className="ml-auto" onClick={() => setEditing(editing === row.tier ? null : row.tier)}>
                {t("prefs.tierEdit")}
              </Button>
            </div>
            <span className={SETTINGS_NOTE}>{tt(`tierDesc.${row.tier}`)}</span>
            <span className={`text-meta ${row.block ? "text-warning" : "text-success"}`}>
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
      </Group>
      <Group title={ts("autoRouting.classifierTitle")} hint={ts("autoRouting.classifierHint")}>
        <Row
          label={
            <span className={c.mode === "off" ? "text-muted" : "text-warning"}>
              {ts("autoRouting.classifierDataFlow")}
            </span>
          }
        />
        <Choice
          label={ts("autoRouting.classifierLabel")}
          hint={modeHint.replace(/^[—\s]+/, "")}
          value={c.mode}
          picks={modes}
          onPick={(mode) => void write("autoRouting.setClassifier", { mode })}
        />
      </Group>
      <Group title={t("prefs.classifierConnection")} hint={t("prefs.editInTui")}>
        <ReadOnlyRow label={ts("autoRouting.endpointLabel")} value={c.endpointHost || t("prefs.unset")} />
        <ReadOnlyRow label={ts("autoRouting.thresholdLabel")} value={c.threshold.toFixed(2)} />
        <Row label={ts("autoRouting.keyLabel")} hint={keyLine} />
      </Group>
    </>
  )
}
