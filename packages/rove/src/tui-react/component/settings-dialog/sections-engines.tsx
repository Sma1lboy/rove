/** @jsxImportSource @opentui/react */
/**
 * Settings → Engines: one line per engine (name, a plain-language status with
 * a coloured dot, the `available` and `default` marks), the facts of the
 * focused engine below the list, then Rove's engine integrations (the
 * activity hooks) as their own block. Accounts share this section rather than
 * a second list of the same names.
 */

import { type RGBA, TextAttributes } from "@opentui/core"
import { useRef } from "react"
import { type EngineHealthTone, engineHealth, engineLogin } from "../../../engine/engine-health"
import type { EngineStatus } from "../../../engine/engine-status"
import type { EngineIntegration } from "../../../engine/integration-status"
import { displayWidth } from "../../../lib/display-width"
import type { VendorId } from "../../../types/task"
import { useTheme } from "../../context/theme"
import { useT } from "../../i18n"
import type { SectionCursorProps } from "./rows"
import { EngineDetails } from "./sections-engines-details"

/** Cap on the name column so one long custom name doesn't push every status right. */
const NAME_MAX = 22

export function EngineSettingsSection(
  props: SectionCursorProps & {
    vendors: readonly VendorId[]
    /** Detection results, keyed by vendor; `null` while the probe is in flight. */
    statuses: readonly EngineStatus[] | null
    /** Display label for a vendor — custom name override, else VENDOR_LABEL. */
    displayName: (vendor: VendorId) => string
    /** The registry name when the user renamed the engine (muted subtitle). */
    renamedFrom: (vendor: VendorId) => string | undefined
    /** Current launch command shown for a vendor (override or default). */
    commandText: (vendor: VendorId) => string
    /** True when the launch command is the user's own. */
    hasCommandOverride: (vendor: VendorId) => boolean
    /** True for a user-added engine (`x` removes it). */
    isCustom: (vendor: VendorId) => boolean
    /** Built-in adapter a CUSTOM engine borrows; `undefined` = the generic one. */
    engineProtocol: (vendor: VendorId) => VendorId | undefined
    /** False for an engine switched off — kept here, not offered for new tasks. */
    isEnabled: (vendor: VendorId) => boolean
    /** True for the DEFAULT engine for new tasks (set with `d`). */
    isDefaultEngine: (vendor: VendorId) => boolean
    /** Open the editor for a vendor's launch command (`enter`). */
    editEngine: (vendor: VendorId) => void
    /** Switch a vendor on or off (`space`). */
    toggleEngine: (vendor: VendorId) => void
    /** Make a vendor the default engine for new tasks (`d`); enables it first. */
    chooseDefault: (vendor: VendorId) => void
    /** Register a new custom engine — the trailing "+ Add engine" row. */
    onAddEngine: () => void
    /** Which reporting layers each engine has; `null` while the probe runs. */
    integrations: readonly EngineIntegration[] | null
    /** Engines whose hooks a single install would change (drives the label). */
    needsHookInstall: readonly VendorId[]
    /** Engines with Rove hooks on disk — what a single remove would change. */
    hooksInstalled: readonly VendorId[]
    /** Install the missing/outdated hooks for every engine at once. */
    onInstallHooks: () => void
    /** Remove Rove's hooks from every engine config that has them. */
    onUninstallHooks: () => void
  },
) {
  const { theme } = useTheme()
  const t = useT()
  // The "+ Add engine" row sits right after the last engine, at index = count.
  const addRowIndex = props.vendors.length
  const isBodyCursor = (row: number) => props.level === "body" && props.bodyRow === row
  const byVendor = new Map((props.statuses ?? []).map((s) => [s.vendor, s]))
  const integrationByVendor = new Map((props.integrations ?? []).map((row) => [row.vendor, row]))

  // The details follow the cursor; off an engine row (the add/install rows,
  // the sidebar) they keep showing the engine last focused, so stepping down
  // to "Install" still shows what it will fix.
  const lastFocused = useRef<VendorId | undefined>(undefined)
  const cursorVendor = props.level === "body" ? props.vendors[props.bodyRow] : undefined
  if (cursorVendor) lastFocused.current = cursorVendor
  const focused =
    lastFocused.current && props.vendors.includes(lastFocused.current) ? lastFocused.current : props.vendors[0]

  const health = (vendor: VendorId) => {
    const status = byVendor.get(vendor)
    const integration = integrationByVendor.get(vendor)
    return engineHealth({
      binaryFound: props.statuses === null ? undefined : (status?.binary.found ?? null),
      login: engineLogin(status),
      hooks: integration ? (integration.hooksSupported ? integration.hookState : "unsupported") : "unsupported",
      configIssue: integration?.configIssue,
      commandChosen: props.isCustom(vendor) || props.hasCommandOverride(vendor),
    })
  }
  const toneColor = (tone: EngineHealthTone): RGBA =>
    tone === "ready"
      ? theme.success
      : tone === "attention"
        ? theme.warning
        : tone === "error"
          ? theme.error
          : theme.textMuted

  const nameText = (vendor: VendorId): string => props.displayName(vendor)
  const subText = (vendor: VendorId): string => {
    const from = props.renamedFrom(vendor)
    if (from) return ` (${from})`
    return props.isCustom(vendor) ? ` (${t("settings.engines.customTag")})` : ""
  }
  const nameWidth = Math.min(
    NAME_MAX,
    props.vendors.reduce((max, v) => Math.max(max, displayWidth(nameText(v) + subText(v))), 0),
  )
  const rows = props.vendors.map((vendor) => ({ vendor, health: health(vendor) }))
  const statusWidth = rows.reduce((max, r) => Math.max(max, displayWidth(t(r.health.key))), 0)
  const pad = (text: string, width: number): string => text + " ".repeat(Math.max(0, width - displayWidth(text)))
  const availableLabel = t("settings.engines.available")
  const offLabel = t("settings.engines.off")
  const markWidth = Math.max(displayWidth(availableLabel), displayWidth(offLabel))
  const defaultLabel = t("settings.engines.defaultMark")

  // An engine whose CLI is not on this machine has nothing to install into:
  // it neither counts toward the total nor keeps "Install" lit.
  const present = (vendor: VendorId) => byVendor.get(vendor)?.binary.found !== false
  const installCount = props.needsHookInstall.filter(present).length
  const removeCount = props.hooksInstalled.length
  const hookable = (props.integrations ?? []).filter((row) => row.hooksSupported && present(row.vendor))
  const hookTotal = hookable.length
  const hookCurrent = hookable.filter((row) => row.hookState === "installed").length

  return (
    <box flexDirection="column" gap={1}>
      <text fg={theme.text} attributes={TextAttributes.BOLD}>
        {t("settings.engines.title")}
      </text>
      <text fg={theme.textMuted} wrapMode="word">
        {t("settings.engines.hint")}
      </text>
      <box flexDirection="column" gap={0}>
        {rows.map(({ vendor, health: h }, i) => {
          const isCursor = isBodyCursor(i)
          const enabled = props.isEnabled(vendor)
          const isDefault = props.isDefaultEngine(vendor)
          const on = (idle: RGBA): RGBA => (isCursor ? theme.selectedListItemText : idle)
          const name = nameText(vendor)
          const sub = subText(vendor)
          // The name keeps its room; only the subtitle gives way when the column caps.
          const subFits = displayWidth(name + sub) <= nameWidth ? sub : ""
          return (
            <box
              key={vendor}
              ref={props.rowRef(i)}
              flexDirection="row"
              gap={2}
              paddingLeft={1}
              paddingRight={1}
              overflow="hidden"
              backgroundColor={isCursor ? theme.primary : undefined}
              onMouseUp={() => {
                props.setLevel("body")
                props.setBodyRow(i)
                props.editEngine(vendor)
              }}
            >
              <box flexDirection="row" flexShrink={1} overflow="hidden">
                <text fg={on(enabled ? theme.text : theme.textMuted)} attributes={TextAttributes.BOLD} wrapMode="none">
                  {name}
                </text>
                {/* An empty <text> still takes a cell, so it is left out when there is nothing to pad. */}
                {displayWidth(name) < nameWidth || subFits ? (
                  <text fg={on(theme.textMuted)} wrapMode="none">
                    {pad(subFits, nameWidth - displayWidth(name))}
                  </text>
                ) : null}
              </box>
              <box flexDirection="row" gap={1} flexShrink={0}>
                <text fg={on(toneColor(h.tone))} wrapMode="none">
                  ●
                </text>
                <text fg={on(enabled ? theme.text : theme.textMuted)} wrapMode="none">
                  {pad(t(h.key), statusWidth)}
                </text>
              </box>
              {/* Both marks are click targets of a fixed width, so the
                  columns stay put. `stopPropagation`: opentui bubbles to the
                  row, whose own click opens the launch-command editor. */}
              <text
                fg={on(enabled ? theme.text : theme.textMuted)}
                wrapMode="none"
                flexShrink={0}
                onMouseUp={(evt: { stopPropagation(): void }) => {
                  evt.stopPropagation()
                  props.setLevel("body")
                  props.setBodyRow(i)
                  props.toggleEngine(vendor)
                }}
              >
                {pad(enabled ? availableLabel : offLabel, markWidth)}
              </text>
              <text
                fg={on(isDefault ? theme.accent : theme.textMuted)}
                attributes={isDefault ? TextAttributes.BOLD : 0}
                wrapMode="none"
                flexShrink={0}
                onMouseUp={(evt: { stopPropagation(): void }) => {
                  evt.stopPropagation()
                  props.setLevel("body")
                  props.setBodyRow(i)
                  props.chooseDefault(vendor)
                }}
              >
                {pad(isDefault ? defaultLabel : "", displayWidth(defaultLabel))}
              </text>
            </box>
          )
        })}
        {/* Trailing "+ Add engine" row. */}
        <box
          ref={props.rowRef(addRowIndex)}
          flexDirection="row"
          paddingLeft={1}
          paddingRight={1}
          backgroundColor={isBodyCursor(addRowIndex) ? theme.primary : undefined}
          onMouseUp={() => {
            props.setLevel("body")
            props.setBodyRow(addRowIndex)
            props.onAddEngine()
          }}
        >
          <text fg={isBodyCursor(addRowIndex) ? theme.selectedListItemText : theme.primary} wrapMode="none">
            {t("settings.engines.addEngine")}
          </text>
        </box>
      </box>
      {focused ? (
        <EngineDetails
          name={props.displayName(focused)}
          status={byVendor.get(focused) ?? null}
          probing={props.statuses === null}
          integration={integrationByVendor.get(focused) ?? null}
          commandText={props.commandText(focused)}
          commandIsOwn={props.isCustom(focused) || props.hasCommandOverride(focused)}
          protocol={props.isCustom(focused) ? { declared: props.engineProtocol(focused) ?? null } : undefined}
        />
      ) : null}
      {/* Engine integrations: what they are, how many are in, and the two
          actions. Both always present, even with nothing to do: a button
          that appears only when something is broken is one nobody knows
          exists, and both actions are idempotent. Two cursor stops on one
          line — j/k walks them, enter fires the one under the cursor. */}
      <box flexDirection="column" gap={0}>
        <box flexDirection="row" gap={2} paddingLeft={1}>
          <text fg={theme.text} attributes={TextAttributes.BOLD} wrapMode="none">
            {t("settings.engines.integrations.title")}
          </text>
          {props.integrations ? (
            <text fg={theme.textMuted} wrapMode="none">
              {t("settings.engines.integrations.summary", {
                installed: String(hookCurrent),
                total: String(hookTotal),
              })}
            </text>
          ) : null}
        </box>
        <box paddingLeft={1} paddingRight={1}>
          <text fg={theme.textMuted} wrapMode="word">
            {t("settings.engines.integrations.hint")}
          </text>
        </box>
        <box flexDirection="row" gap={2} paddingLeft={1} paddingRight={1}>
          <IntegrationButton
            rowRef={props.rowRef(addRowIndex + 1)}
            cursor={isBodyCursor(addRowIndex + 1)}
            live={installCount > 0}
            label={
              installCount > 0
                ? t("settings.engines.integrations.install", { count: String(installCount) })
                : t("settings.engines.integrations.upToDate")
            }
            onPress={() => {
              props.setLevel("body")
              props.setBodyRow(addRowIndex + 1)
              props.onInstallHooks()
            }}
          />
          <IntegrationButton
            rowRef={props.rowRef(addRowIndex + 2)}
            cursor={isBodyCursor(addRowIndex + 2)}
            live={removeCount > 0}
            label={
              removeCount > 0
                ? t("settings.engines.integrations.remove", { count: String(removeCount) })
                : t("settings.engines.integrations.noneInstalled")
            }
            onPress={() => {
              props.setLevel("body")
              props.setBodyRow(addRowIndex + 2)
              props.onUninstallHooks()
            }}
          />
        </box>
      </box>
      <box paddingLeft={1}>
        <text fg={theme.textMuted} wrapMode="word">
          {t("settings.engines.keys")}
        </text>
      </box>
    </box>
  )
}

function IntegrationButton(props: {
  rowRef: ReturnType<SectionCursorProps["rowRef"]>
  cursor: boolean
  live: boolean
  label: string
  onPress: () => void
}) {
  const { theme } = useTheme()
  return (
    <box
      ref={props.rowRef}
      flexDirection="row"
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={props.cursor ? theme.primary : theme.backgroundElement}
      onMouseUp={props.onPress}
    >
      <text fg={props.cursor ? theme.selectedListItemText : props.live ? theme.text : theme.textMuted} wrapMode="none">
        {props.label}
      </text>
    </box>
  )
}
