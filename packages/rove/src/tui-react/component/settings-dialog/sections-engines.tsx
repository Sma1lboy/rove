/** @jsxImportSource @opentui/react */
/**
 * Settings → Engines: configure AND inspect each engine in one two-line card.
 * The navigable line has the switch, ● default marker, name and launch
 * command; the muted line has detection results (binary, and login for
 * built-ins). Accounts deliberately share this section rather than a second
 * list of the same names.
 */

import { TextAttributes } from "@opentui/core"
import type { ReactNode } from "react"
import type { EngineAccount, EngineStatus } from "../../../engine/engine-status"
import type { EngineIntegration } from "../../../engine/integration-status"
import { displayWidth } from "../../../lib/display-width"
import { tildify } from "../../../lib/path-home"
import type { VendorId } from "../../../types/task"
import { useTheme } from "../../context/theme"
import { useT } from "../../i18n"
import type { SectionCursorProps } from "./rows"
import { EngineIntegrationLine } from "./sections-engines-integration"

export function EngineSettingsSection(
  props: SectionCursorProps & {
    vendors: readonly VendorId[]
    /** Detection results, keyed by vendor; `null` while the probe is in flight. */
    statuses: readonly EngineStatus[] | null
    /** Display label for a vendor — custom name override, else VENDOR_LABEL. */
    displayName: (vendor: VendorId) => string
    /** Current launch command shown for a vendor (override or default). */
    commandText: (vendor: VendorId) => string
    /** Whether the engine is fully at its built-in default (dims it). */
    isDefault: (vendor: VendorId) => boolean
    /** True for a user-added engine (shown with a `(custom)` tag; `x` removes it). */
    isCustom: (vendor: VendorId) => boolean
    /** Built-in adapter a CUSTOM engine borrows; `undefined` = the generic one. */
    engineProtocol: (vendor: VendorId) => VendorId | undefined
    /** False for an engine switched off — kept here, not offered for new tasks. */
    isEnabled: (vendor: VendorId) => boolean
    /** True for the DEFAULT engine for new tasks (the ● marker; set with `d`). */
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
  // Shared name column so commands line up; capped so one long custom name
  // doesn't push every command right.
  const nameWidth = Math.min(
    16,
    props.vendors.reduce((max, v) => Math.max(max, displayWidth(props.displayName(v))), 0),
  )
  const padName = (name: string): string => name + " ".repeat(Math.max(0, nameWidth - displayWidth(name)))
  /**
   * Protocol chip, CUSTOM engines only (built-in/contrib engines ARE their
   * protocol). An undeclared custom engine silently gets the generic adapter:
   * no transcript reader, account detection or resume.
   */
  const protocolChip = (vendor: VendorId): { label: string; declared: boolean } | undefined => {
    if (!props.isCustom(vendor)) return undefined
    const declared = props.engineProtocol(vendor)
    return {
      label: t("settings.engines.protocolRow", { protocol: declared ?? t("settings.engines.protocolGeneric") }),
      declared: declared !== undefined,
    }
  }
  return (
    <box flexDirection="column" gap={1}>
      <text fg={theme.text} attributes={TextAttributes.BOLD}>
        {t("settings.engines.title")}
      </text>
      <text fg={theme.textMuted} wrapMode="word">
        {t("settings.engines.hint")}
      </text>
      <box flexDirection="column" gap={0}>
        {props.vendors.map((vendor, i) => {
          const isCursor = isBodyCursor(i)
          const enabled = props.isEnabled(vendor)
          // A switched-off engine reads as inert: no accent anywhere, name and
          // command dimmed to the same muted tone as its detection line.
          const nameFg = isCursor ? theme.selectedListItemText : enabled ? theme.text : theme.textMuted
          const commandFg = isCursor
            ? theme.selectedListItemText
            : !enabled || props.isDefault(vendor)
              ? theme.textMuted
              : theme.accent
          return (
            // Cursor-follow registers the whole two-line card, so the detection
            // line scrolls into view with the cursor line.
            <box key={vendor} flexDirection="column" gap={0} ref={props.rowRef(i)}>
              <box
                flexDirection="row"
                gap={1}
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
                {/* Two 3-cell hit zones, different shapes on purpose: `[x]` is
                    a checkbox (this engine is offered at all), `(●)` is a radio
                    (exactly one engine is the default for new tasks). Both wide
                    enough to click; a bare glyph is a one-cell target sitting
                    next to another one-cell target.

                    `stopPropagation` on both: opentui bubbles to the parent,
                    and the row's own handler opens the launch-command editor —
                    without it a click on either control fires two actions. */}
                <text
                  fg={isCursor ? theme.selectedListItemText : enabled ? theme.text : theme.textMuted}
                  wrapMode="none"
                  onMouseUp={(evt: { stopPropagation(): void }) => {
                    evt.stopPropagation()
                    props.setLevel("body")
                    props.setBodyRow(i)
                    props.toggleEngine(vendor)
                  }}
                >
                  {enabled ? "[x]" : "[ ]"}
                </text>
                <text
                  fg={
                    isCursor
                      ? theme.selectedListItemText
                      : props.isDefaultEngine(vendor)
                        ? theme.accent
                        : theme.textMuted
                  }
                  attributes={TextAttributes.BOLD}
                  wrapMode="none"
                  onMouseUp={(evt: { stopPropagation(): void }) => {
                    evt.stopPropagation()
                    props.setLevel("body")
                    props.setBodyRow(i)
                    props.chooseDefault(vendor)
                  }}
                >
                  {props.isDefaultEngine(vendor) ? "(●)" : "( )"}
                </text>
                <text fg={nameFg} attributes={TextAttributes.BOLD} wrapMode="none">
                  {padName(props.displayName(vendor))}
                </text>
                {/* No "(default)" tag on an untouched command: the ● column
                    already spends the word "default" on the engine choice, and
                    two of them in one row read as one claim. Dimming says it. */}
                <text fg={commandFg} wrapMode="none" flexShrink={1}>
                  {props.commandText(vendor) + (props.isCustom(vendor) ? t("settings.engines.customTag") : "")}
                </text>
              </box>
              <EngineStatusLine
                status={byVendor.get(vendor) ?? null}
                probing={props.statuses === null}
                protocol={protocolChip(vendor)}
              />
              <EngineIntegrationLine
                integration={integrationByVendor.get(vendor) ?? null}
                binaryFound={byVendor.get(vendor)?.binary.found}
              />
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
        {/* Install and remove, side by side. Always both present, even with
            nothing to do: a button that appears only when something is broken
            is a button nobody knows exists, and both actions are idempotent by
            contract. Two cursor stops on one line — j/k walks them, enter
            fires the one under the cursor, so neither needs a chord. */}
        <box flexDirection="row" gap={2} paddingLeft={1} paddingRight={1}>
          <box
            ref={props.rowRef(addRowIndex + 1)}
            flexDirection="row"
            backgroundColor={isBodyCursor(addRowIndex + 1) ? theme.primary : undefined}
            onMouseUp={() => {
              props.setLevel("body")
              props.setBodyRow(addRowIndex + 1)
              props.onInstallHooks()
            }}
          >
            <text
              fg={
                isBodyCursor(addRowIndex + 1)
                  ? theme.selectedListItemText
                  : props.needsHookInstall.length > 0
                    ? theme.primary
                    : theme.textMuted
              }
              wrapMode="none"
            >
              {props.needsHookInstall.length > 0
                ? t("settings.engines.installHooks", { count: String(props.needsHookInstall.length) })
                : t("settings.engines.installHooksDone")}
            </text>
          </box>
          <box
            ref={props.rowRef(addRowIndex + 2)}
            flexDirection="row"
            backgroundColor={isBodyCursor(addRowIndex + 2) ? theme.primary : undefined}
            onMouseUp={() => {
              props.setLevel("body")
              props.setBodyRow(addRowIndex + 2)
              props.onUninstallHooks()
            }}
          >
            <text
              fg={
                isBodyCursor(addRowIndex + 2)
                  ? theme.selectedListItemText
                  : props.hooksInstalled.length > 0
                    ? theme.text
                    : theme.textMuted
              }
              wrapMode="none"
            >
              {props.hooksInstalled.length > 0
                ? t("settings.engines.uninstallHooks", { count: String(props.hooksInstalled.length) })
                : t("settings.engines.uninstallHooksDone")}
            </text>
          </box>
        </box>
      </box>
    </box>
  )
}

/**
 * Muted second line of an engine card: binary path, plus login state only for
 * engines with an account detector ("not logged in" elsewhere would be a guess).
 */
function EngineStatusLine(props: {
  status: EngineStatus | null
  probing: boolean
  /** Custom engines only — which adapter this preset borrows. */
  protocol?: { label: string; declared: boolean }
}) {
  const { theme } = useTheme()
  const t = useT()
  const s = props.status
  // In BOTH branches: the protocol needs no probe, so it must not blink in later.
  const protocol = props.protocol ? (
    <text fg={props.protocol.declared ? theme.accent : theme.textMuted} wrapMode="none">
      {props.protocol.label}
    </text>
  ) : null
  if (!s)
    return (
      <box flexDirection="row" gap={1} paddingLeft={6} overflow="hidden">
        {protocol}
        <text fg={theme.textMuted}>{props.probing ? t("settings.accounts.checking") : " "}</text>
      </box>
    )
  return (
    // Login first: when the line doesn't fit, the path is what shrinks.
    // `overflow="hidden"` + `wrapMode="none"` clip instead of overdrawing.
    <box flexDirection="row" gap={1} paddingLeft={6} overflow="hidden">
      {protocol}
      {s.account === null ? null : <AccountLine account={s.account} />}
      {s.accountError ? (
        <text fg={theme.warning} wrapMode="none">
          {`! ${s.accountError}`}
        </text>
      ) : null}
      <text fg={s.binary.found ? theme.textMuted : theme.warning} wrapMode="none" flexShrink={1}>
        {(s.account === null ? "" : "· ") +
          (s.binary.found ? tildify((s.binary as { path: string }).path) : (s.binary as { error: string }).error)}
      </text>
    </box>
  )
}

/** The resolved login line for any built-in engine's account shape. */
function AccountLine({ account }: { account: EngineAccount }): ReactNode {
  const { theme } = useTheme()
  const t = useT()
  if (account.kind === "oauth") {
    // Claude's oauth carries an identity; copilot's and kimi's don't.
    if (!("email" in account))
      return (
        <text fg={theme.success} wrapMode="none">
          {t("settings.accounts.detected")}
        </text>
      )
    // Billing type only: a personal account's org name is derived from the
    // email already shown, and the row is shared with the binary path.
    const tail = account.billingType
    return (
      <text fg={theme.success} wrapMode="none" flexShrink={1}>
        {t("settings.accounts.loggedIn", { email: account.email }) + (tail ? ` (${tail})` : "")}
      </text>
    )
  }
  if (account.kind === "chatgpt") {
    return (
      <text fg={theme.success} wrapMode="none" flexShrink={1}>
        {t("settings.accounts.chatgptLogin", { email: account.email }) + (account.plan ? ` (${account.plan})` : "")}
      </text>
    )
  }
  if (account.kind === "apikey") return <text fg={theme.success}>{t("settings.accounts.apiKeyConfigured")}</text>
  if (account.kind === "token")
    return <text fg={theme.success}>{t("settings.accounts.tokenConfigured", { source: account.source })}</text>
  return <text fg={theme.textMuted}>{t("settings.accounts.notLoggedIn")}</text>
}
