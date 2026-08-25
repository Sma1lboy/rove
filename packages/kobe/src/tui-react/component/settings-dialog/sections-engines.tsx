/** @jsxImportSource @opentui/react */
/**
 * Settings → Engines (React): the one place an engine is configured AND
 * inspected. Each engine is a two-line card — the navigable line carries its
 * on/off switch, the ● default marker, its display name and launch command;
 * the muted line under it carries what detection found (the binary, and for
 * the built-ins whether an account is logged in). Accounts used to be its own
 * read-only section; splitting "which engines exist" from "do they work" only
 * made you hop between two lists of the same names.
 */

import { homedir } from "node:os"
import { TextAttributes } from "@opentui/core"
import type { ReactNode } from "react"
import type { EngineAccount, EngineStatus } from "../../../engine/engine-status"
import { displayWidth } from "../../../lib/display-width"
import type { VendorId } from "../../../types/task"
import { useTheme } from "../../context/theme"
import { useT } from "../../i18n"
import type { SectionCursorProps } from "./rows"

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
  },
) {
  const { theme } = useTheme()
  const t = useT()
  // The "+ Add engine" row sits right after the last engine, at index = count.
  const addRowIndex = props.vendors.length
  const isBodyCursor = (row: number) => props.level === "body" && props.bodyRow === row
  const byVendor = new Map((props.statuses ?? []).map((s) => [s.vendor, s]))
  // Names get a shared column so the commands line up under each other —
  // "Claude claude" is two words the eye has to separate on every row. Capped,
  // because one long custom name must not push every command off to the right.
  const nameWidth = Math.min(
    16,
    props.vendors.reduce((max, v) => Math.max(max, displayWidth(props.displayName(v))), 0),
  )
  const padName = (name: string): string => name + " ".repeat(Math.max(0, nameWidth - displayWidth(name)))
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
            <box key={vendor} flexDirection="column" gap={0}>
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
              <EngineStatusLine status={byVendor.get(vendor) ?? null} probing={props.statuses === null} />
            </box>
          )
        })}
        {/* Trailing "+ Add engine" row. */}
        <box
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
    </box>
  )
}

/**
 * The muted second line of an engine card: where its binary was found and —
 * only for the engines that have an account detector — whether it is logged
 * in. An engine without one shows the binary alone; claiming "not logged in"
 * for it would be a guess.
 */
function EngineStatusLine(props: { status: EngineStatus | null; probing: boolean }) {
  const { theme } = useTheme()
  const t = useT()
  const s = props.status
  if (!s)
    return (
      <box paddingLeft={6}>
        <text fg={theme.textMuted}>{props.probing ? t("settings.accounts.checking") : " "}</text>
      </box>
    )
  return (
    // Login state first, path second: when the line doesn't fit, the PATH is
    // the part worth losing, so it is the one that shrinks. `overflow="hidden"`
    // + `wrapMode="none"` clips at the pane edge instead of overdrawing.
    <box flexDirection="row" gap={1} paddingLeft={6} overflow="hidden">
      {s.account === null ? null : <AccountLine account={s.account} />}
      {s.accountError ? (
        <text fg={theme.warning} wrapMode="none">
          {`! ${s.accountError}`}
        </text>
      ) : null}
      <text fg={s.binary.found ? theme.textMuted : theme.warning} wrapMode="none" flexShrink={1}>
        {(s.account === null ? "" : "· ") +
          (s.binary.found ? tildePath((s.binary as { path: string }).path) : (s.binary as { error: string }).error)}
      </text>
    </box>
  )
}

/** `/Users/me/.kimi-code/bin/kimi` → `~/.kimi-code/bin/kimi`; the home prefix
 *  is the same on every row, so it is pure width. */
function tildePath(p: string): string {
  const home = homedir()
  return home && p.startsWith(`${home}/`) ? `~${p.slice(home.length)}` : p
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
    // Billing type only: a personal Anthropic account's org name is generated
    // from the very email printed two words earlier, and this line now shares
    // its row with the binary path.
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
