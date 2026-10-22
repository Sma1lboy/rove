/** @jsxImportSource @opentui/react */
/**
 * The detail block under the engine list in Settings → Engines: the focused
 * engine's facts as labelled sentences — where its program is, its launch
 * command, whether it is signed in, how Rove learns its live status (the
 * hooks Rove installs, the completion markers it reads, the screen rules it
 * falls back to), and for a custom engine which adapter it borrows.
 *
 * A missing reporting layer is normal (claude's hooks report everything, so
 * screen rules would be dead code), so only a layer meant to be installed and
 * missing reads as a warning.
 */

import { type RGBA, TextAttributes } from "@opentui/core"
import type { ReactNode } from "react"
import type { EngineAccount, EngineStatus } from "../../../engine/engine-status"
import type { EngineIntegration } from "../../../engine/integration-status"
import { displayWidth } from "../../../lib/display-width"
import { tildify } from "../../../lib/path-home"
import { useTheme } from "../../context/theme"
import { useT } from "../../i18n"

type T = ReturnType<typeof useT>

interface Fact {
  readonly label: string
  readonly lines: readonly { readonly text: string; readonly fg?: RGBA }[]
}

export function EngineDetails(props: {
  name: string
  status: EngineStatus | null
  /** The detection probe has not landed yet. */
  probing: boolean
  integration: EngineIntegration | null
  commandText: string
  /** The command is the user's own (an override, or a custom engine). */
  commandIsOwn: boolean
  /** Custom engines only: the adapter they borrow (`null` = generic). */
  protocol?: { declared: string | null }
}): ReactNode {
  const { theme } = useTheme()
  const t = useT()
  const binary = props.commandText.split(/\s+/)[0] ?? props.commandText
  const facts: Fact[] = [
    { label: t("settings.engines.detail.program"), lines: [programLine(props, binary, t, theme)] },
    {
      label: t("settings.engines.detail.command"),
      lines: [
        {
          text: t(
            props.commandIsOwn ? "settings.engines.detail.commandCustom" : "settings.engines.detail.commandDefault",
            {
              command: props.commandText,
            },
          ),
        },
      ],
    },
    { label: t("settings.engines.detail.signIn"), lines: [signInLine(props, t, theme)] },
  ]
  if (props.integration)
    facts.push({ label: t("settings.engines.detail.reporting"), lines: reportingLines(props, t, theme) })
  if (props.protocol)
    facts.push({
      label: t("settings.engines.detail.adapter"),
      lines: [
        {
          text: props.protocol.declared
            ? t("settings.engines.detail.adapterDeclared", { protocol: props.protocol.declared })
            : t("settings.engines.detail.adapterGeneric"),
          fg: props.protocol.declared ? undefined : theme.textMuted,
        },
      ],
    })
  const labelWidth = facts.reduce((max, f) => Math.max(max, displayWidth(f.label)), 0)
  return (
    <box flexDirection="column" gap={0} paddingLeft={1} paddingRight={1}>
      <text fg={theme.text} attributes={TextAttributes.BOLD} wrapMode="none">
        {props.name}
      </text>
      {facts.map((fact) => (
        <box key={fact.label} flexDirection="row" gap={2}>
          <text fg={theme.textMuted} wrapMode="none" flexShrink={0}>
            {fact.label + " ".repeat(Math.max(0, labelWidth - displayWidth(fact.label)))}
          </text>
          <box flexDirection="column" flexShrink={1} flexGrow={1}>
            {fact.lines.map((line) => (
              <text key={line.text} fg={line.fg ?? theme.text} wrapMode="word">
                {line.text}
              </text>
            ))}
          </box>
        </box>
      ))}
    </box>
  )
}

type Theme = ReturnType<typeof useTheme>["theme"]

function programLine(
  props: { status: EngineStatus | null; probing: boolean },
  binary: string,
  t: T,
  theme: Theme,
): { text: string; fg?: RGBA } {
  const s = props.status
  if (!s)
    return props.probing
      ? { text: t("settings.accounts.checking"), fg: theme.textMuted }
      : { text: t("settings.engines.detail.programUnknown", { binary }), fg: theme.textMuted }
  if (s.binary.found)
    return {
      text: t("settings.engines.detail.programFound", { binary, path: tildify((s.binary as { path: string }).path) }),
    }
  return { text: t("settings.engines.detail.programMissing", { binary }), fg: theme.warning }
}

function signInLine(
  props: { status: EngineStatus | null; probing: boolean },
  t: T,
  theme: Theme,
): { text: string; fg?: RGBA } {
  const s = props.status
  if (!s)
    return {
      text: props.probing ? t("settings.accounts.checking") : t("settings.engines.detail.signInUnknown"),
      fg: theme.textMuted,
    }
  if (s.accountError)
    return { text: t("settings.engines.detail.signInFailed", { error: s.accountError }), fg: theme.warning }
  if (s.account === null) return { text: t("settings.engines.detail.signInUnknown"), fg: theme.textMuted }
  return accountLine(s.account, t, theme)
}

function accountLine(account: EngineAccount, t: T, theme: Theme): { text: string; fg?: RGBA } {
  if (account.kind === "oauth") {
    // Claude's oauth carries an identity; copilot's and kimi's don't.
    if (!("email" in account)) return { text: t("settings.engines.detail.signedIn") }
    const who = account.email + (account.billingType ? ` (${account.billingType})` : "")
    return { text: t("settings.engines.detail.signedInAs", { who }) }
  }
  if (account.kind === "chatgpt") {
    const who = account.email + (account.plan ? ` (${account.plan})` : "")
    return { text: t("settings.engines.detail.signedInAs", { who }) }
  }
  if (account.kind === "apikey") return { text: t("settings.engines.detail.apiKey") }
  if (account.kind === "token") return { text: t("settings.engines.detail.token", { source: account.source }) }
  return { text: t("settings.engines.detail.signedOut"), fg: theme.warning }
}

function reportingLines(
  props: { status: EngineStatus | null; integration: EngineIntegration | null },
  t: T,
  theme: Theme,
): { text: string; fg?: RGBA }[] {
  const row = props.integration
  if (!row) return []
  const lines: { text: string; fg?: RGBA }[] = []
  if (row.configIssue) {
    lines.push({
      text: t("settings.engines.detail.hooksBlocked", { file: tildify(row.hookFile), reason: row.configIssue }),
      fg: theme.error,
    })
  } else if (!row.hooksSupported) {
    lines.push({ text: t("settings.engines.detail.hooksUnsupported"), fg: theme.textMuted })
  } else if (row.hookState === "installed") {
    lines.push({ text: t("settings.engines.detail.hooksInstalled") })
  } else if (row.hookState === "outdated") {
    lines.push({ text: t("settings.engines.detail.hooksOutdated"), fg: theme.warning })
  } else if (props.status?.binary.found === false) {
    // Nothing to fix while the engine itself is absent.
    lines.push({ text: t("settings.engines.detail.hooksAwaitEngine"), fg: theme.textMuted })
  } else {
    lines.push({ text: t("settings.engines.detail.hooksMissing"), fg: theme.warning })
  }
  lines.push({ text: t(row.markers ? "settings.engines.detail.markersYes" : "settings.engines.detail.markersNo") })
  lines.push({
    text: t(
      row.screen
        ? "settings.engines.detail.screenYes"
        : row.hooksSupported && row.hookState === "installed"
          ? "settings.engines.detail.screenNotNeeded"
          : "settings.engines.detail.screenNo",
    ),
  })
  if (row.setupCommand) {
    lines.push({ text: t("settings.engines.hookTrustHint", { command: row.setupCommand }), fg: theme.warning })
  }
  return lines
}
