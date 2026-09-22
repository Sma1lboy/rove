/** @jsxImportSource @opentui/react */
/**
 * Settings → Auto effort: one row per depth tier, each showing the
 * engine · model · effort it launches, with the gate's verdict under it.
 * Enter opens the change-engine picker on that row. The prose above names
 * what the tiers are FOR; the rows name what they RUN — the two never quote
 * each other (see `engine/auto-effort.ts`).
 *
 * Under them, the CLASSIFIER — who picks a tier, as opposed to what a tier
 * runs. Its data-flow sentence is rendered ABOVE its switch rather than
 * under them, and is not folded into the section hint: the design decision
 * this implements
 * (`docs/design/auto-effort-classifier.md`, hard requirement 4) is that
 * sending a task's first message to someone who is not the user's engine
 * vendor must be stated where the switch is, never behind it.
 */

import { TextAttributes } from "@opentui/core"
import { type AutoEffortTier, describeTierBlock } from "../../../engine/auto-effort"
import { engineDisplayName } from "../../../engine/interactive-command"
import { autoEffortRows, rowIndex } from "../../../tui/component/settings-dialog/model"
import { useTheme } from "../../context/theme"
import { useT } from "../../i18n"
import { Row, type SectionCursorProps, SubSection } from "./rows"
import type { AutoEffortSettings } from "./use-auto-effort-settings"
import type { ClassifierSettings } from "./use-classifier-settings"

export function AutoEffortSettingsSection(
  props: SectionCursorProps & { autoEffort: AutoEffortSettings; classifier: ClassifierSettings },
) {
  const { theme } = useTheme()
  const t = useT()
  const rows = autoEffortRows()
  const { table } = props.autoEffort
  const isBodyCursor = (row: number) => props.level === "body" && props.bodyRow === row
  return (
    <box flexDirection="column" gap={1}>
      <text fg={theme.text} attributes={TextAttributes.BOLD}>
        {t("settings.autoEffort.title")}
      </text>
      <text fg={theme.textMuted} wrapMode="word">
        {t("settings.autoEffort.hint")}
      </text>
      {table === null ? (
        <text fg={theme.warning} wrapMode="word">
          {t("settings.autoEffort.unconfigured")}
        </text>
      ) : null}
      <box flexDirection="column" gap={0}>
        {rows.map((row) => {
          if (row.kind !== "autoEffortTier") return null
          const tier: AutoEffortTier = row.tier
          const i = rowIndex(rows, row.id)
          const target = table?.[tier]
          const block = props.autoEffort.block(tier)
          const label = `${t(`tasks.tier.${tier}`)}`.padEnd(10)
          const fields = target
            ? [
                engineDisplayName(target.engine),
                target.model ?? t("settings.autoEffort.engineDefault"),
                target.effort ?? t("settings.autoEffort.engineDefault"),
              ].join(" · ")
            : "—"
          return (
            <box key={row.id} flexDirection="column" gap={0}>
              <Row
                cursor={isBodyCursor(i)}
                rowRef={props.rowRef(i)}
                onMouseUp={() => {
                  props.setLevel("body")
                  props.setBodyRow(i)
                  void props.autoEffort.edit(tier)
                }}
                fg={theme.text}
                bold
                hint={fields}
              >
                {label}
              </Row>
              <box flexDirection="row" gap={1} paddingLeft={3} overflow="hidden">
                <text fg={theme.textMuted} wrapMode="none" flexShrink={1}>
                  {t(`tasks.tierDesc.${tier}`)}
                </text>
              </box>
              <box flexDirection="row" gap={1} paddingLeft={3} overflow="hidden">
                {block === undefined ? (
                  <text fg={theme.textMuted}>{t("settings.accounts.checking")}</text>
                ) : block === null ? (
                  <text fg={theme.success}>{t("settings.autoEffort.ready")}</text>
                ) : (
                  <text fg={theme.warning} wrapMode="none" flexShrink={1}>
                    {t("settings.autoEffort.unavailable", { reason: describeTierBlock(block) })}
                  </text>
                )}
              </box>
            </box>
          )
        })}
      </box>
      <ClassifierRows {...props} />
    </box>
  )
}

/**
 * The classifier: a mode switch, the endpoint it uses in `custom`, and the
 * confidence floor under which nothing is pre-filled.
 *
 * The key line is deliberately loud when the classifier is ON and the
 * variable is absent. That combination looks exactly like a working setup
 * from the outside — tiers simply never fill in — so the one place that can
 * tell the difference says so.
 */
function ClassifierRows(
  props: SectionCursorProps & { autoEffort: AutoEffortSettings; classifier: ClassifierSettings },
) {
  const { theme } = useTheme()
  const t = useT()
  const rows = autoEffortRows()
  const c = props.classifier
  const isBodyCursor = (row: number) => props.level === "body" && props.bodyRow === row
  const on = c.mode !== "off"

  const modeLabel =
    c.mode === "off"
      ? t("settings.autoEffort.classifierOff")
      : c.mode === "jev"
        ? "jev"
        : t("settings.autoEffort.classifierCustomLabel")
  const modeHint =
    c.mode === "off"
      ? t("settings.autoEffort.classifierOffHint")
      : c.mode === "jev"
        ? t("settings.autoEffort.classifierJevHint")
        : t("settings.autoEffort.classifierCustomHint")

  function open(id: string, run: () => void) {
    const i = rowIndex(rows, id)
    return {
      i,
      onMouseUp: () => {
        props.setLevel("body")
        props.setBodyRow(i)
        run()
      },
    }
  }
  /**
   * The line under the rows, and the one place the three modes genuinely
   * differ.
   *
   * `jev` needs a key, so its absence is a warning. A CUSTOM endpoint does
   * not: it is POSTed to with no Authorization header unless the user named
   * the variable themselves, so "no key" there is normal operation and a
   * STORED key is the surprising case — it is not sent. Gating this on "the
   * classifier is on" gave custom jev's semantics and was wrong in both
   * directions: it warned that a working setup was silent, and it reported a
   * key as configured when nothing would carry it.
   */
  const status: { ok: boolean; text: string } | null = (() => {
    if (c.mode === "off") return null
    if (c.mode === "custom" && !c.keyEnvNamed) {
      return { ok: true, text: t("settings.autoEffort.keyCustomUnused") }
    }
    if (c.keySource === "env") return { ok: true, text: t("settings.autoEffort.keyPresentEnv", { env: c.keyEnv }) }
    if (c.keySource === "file") return { ok: true, text: t("settings.autoEffort.keySaved") }
    return { ok: false, text: t("settings.autoEffort.keyMissing") }
  })()

  const mode = open("auto-effort-classifier", () => c.cycle())
  const endpoint = open("auto-effort-endpoint", () => void c.editEndpoint())
  const threshold = open("auto-effort-threshold", () => void c.editThreshold())
  const key = open("auto-effort-key", () => void c.editKey())

  // What the key row says about itself. The env case names the variable
  // because the environment OUTRANKS a stored key — someone who pastes one
  // here while a shell export is live would otherwise watch it have no
  // effect and have nothing to blame.
  const keyValue =
    c.keySource === "env"
      ? t("settings.autoEffort.keyFromEnv", { env: c.keyEnv })
      : c.keySource === "file"
        ? t("settings.autoEffort.keyStored", { hint: c.keyHint })
        : t("settings.autoEffort.keyNone")

  return (
    <SubSection title={t("settings.autoEffort.classifierTitle")} hint={t("settings.autoEffort.classifierHint")}>
      <box paddingTop={1} paddingBottom={1}>
        <text fg={on ? theme.warning : theme.textMuted} wrapMode="word">
          {t("settings.autoEffort.classifierDataFlow")}
        </text>
      </box>
      <Row
        cursor={isBodyCursor(mode.i)}
        rowRef={props.rowRef(mode.i)}
        onMouseUp={mode.onMouseUp}
        fg={theme.text}
        hint={modeHint}
      >
        {`${t("settings.autoEffort.classifierLabel").padEnd(20)}${modeLabel}`}
      </Row>
      <Row
        cursor={isBodyCursor(endpoint.i)}
        rowRef={props.rowRef(endpoint.i)}
        onMouseUp={endpoint.onMouseUp}
        fg={c.mode === "custom" ? theme.text : theme.textMuted}
      >
        {`${t("settings.autoEffort.endpointLabel").padEnd(20)}${c.endpoint || t("settings.autoEffort.endpointUnset")}`}
      </Row>
      <Row
        cursor={isBodyCursor(threshold.i)}
        rowRef={props.rowRef(threshold.i)}
        onMouseUp={threshold.onMouseUp}
        fg={theme.text}
        hint={t("settings.autoEffort.thresholdHint")}
      >
        {`${t("settings.autoEffort.thresholdLabel").padEnd(20)}${c.threshold.toFixed(2)}`}
      </Row>
      <Row cursor={isBodyCursor(key.i)} rowRef={props.rowRef(key.i)} onMouseUp={key.onMouseUp} fg={theme.text}>
        {`${t("settings.autoEffort.keyLabel").padEnd(20)}${keyValue}`}
      </Row>
      {status ? (
        <box paddingTop={1}>
          <text fg={status.ok ? theme.success : theme.warning} wrapMode="word">
            {status.text}
          </text>
        </box>
      ) : null}
    </SubSection>
  )
}
