/** What every Settings section is built from: a group of rows, each a name and note beside its control. */

import { type ReactNode, useCallback, useEffect, useId, useState } from "react"
import type { BridgeClient } from "./bridge.ts"
import { errorText } from "./dialogs.tsx"
import { t } from "./i18n/index.ts"
import { lastReply, requestRemembered } from "./remembered.ts"
import { Button } from "./ui/button.tsx"
import { Segmented } from "./ui/segmented.tsx"
import { Select } from "./ui/select.tsx"
import {
  SETTINGS_CONTROL,
  SETTINGS_GROUP,
  SETTINGS_GROUP_HINT,
  SETTINGS_GROUP_LABEL,
  SETTINGS_NAME,
  SETTINGS_NOTE,
  SETTINGS_ROW,
  SETTINGS_ROWS,
  SETTINGS_ROW_INLINE,
  SETTINGS_ROW_STACK,
  SETTINGS_SAMPLE,
  SETTINGS_STATUS,
  SETTINGS_TEXT,
  SETTINGS_VALUE,
} from "./ui/settings.ts"
import { Switch } from "./ui/switch.tsx"

export function Group(props: { title?: string; hint?: string; children: ReactNode }) {
  return (
    <section className={SETTINGS_GROUP}>
      {props.title && <h2 className={SETTINGS_GROUP_LABEL}>{props.title}</h2>}
      {props.hint && <p className={SETTINGS_GROUP_HINT}>{props.hint}</p>}
      <div className={SETTINGS_ROWS}>{props.children}</div>
    </section>
  )
}

/**
 * One setting. `inline` keeps a small control (a switch) beside the text on a phone; `stack` puts a wide one
 * (a picker, a form) under it. `labelId` ties the text to its control for assistive tech.
 */
export function Row(props: {
  label: ReactNode
  hint?: ReactNode
  /** What the current value looks like, under the note. */
  sample?: ReactNode
  children?: ReactNode
  inline?: boolean
  stack?: boolean
  labelId?: string
}) {
  const text = (
    <div className={SETTINGS_TEXT}>
      <span id={props.labelId} className={SETTINGS_NAME}>
        {props.label}
      </span>
      {props.hint && <span className={SETTINGS_NOTE}>{props.hint}</span>}
      {props.sample && <span className={SETTINGS_SAMPLE}>{props.sample}</span>}
    </div>
  )
  if (props.stack) {
    return (
      <div className={SETTINGS_ROW_STACK}>
        {text}
        {props.children}
      </div>
    )
  }
  return (
    <div className={props.inline ? SETTINGS_ROW_INLINE : SETTINGS_ROW}>
      {text}
      {props.children && <div className={SETTINGS_CONTROL}>{props.children}</div>}
    </div>
  )
}

export function Toggle(props: {
  label: string
  hint?: string
  checked: boolean
  disabled?: boolean
  onChange: (next: boolean) => void
}) {
  const id = useId()
  return (
    <Row label={props.label} hint={props.hint} labelId={id} inline>
      <Switch
        on={props.checked}
        aria-labelledby={id}
        disabled={props.disabled}
        onClick={() => props.onChange(!props.checked)}
      />
    </Row>
  )
}

export interface Pick<T extends string | number> {
  readonly value: T
  readonly label: string
}

/** Up to this many Latin-width characters of option labels fit joined in a row beside the setting's name. */
const SEGMENT_CHARS = 36

/** A CJK or full-width character takes two Latin widths. */
const WIDE = /[\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/

/** Whether the options are few and short enough to show joined instead of in a drop-down. */
export function fitsJoined(picks: readonly { readonly label: string }[]): boolean {
  let width = 0
  for (const pick of picks) for (const ch of pick.label) width += WIDE.test(ch) ? 2 : 1
  return picks.length <= 4 && width <= SEGMENT_CHARS
}

/** One of several: joined options when they are few and short, a drop-down otherwise. */
export function Choice<T extends string | number>(props: {
  label: string
  hint?: string
  sample?: ReactNode
  value: T
  picks: readonly Pick<T>[]
  onPick: (next: T) => void
}) {
  const Control = fitsJoined(props.picks) ? Segmented : Select
  return (
    <Row label={props.label} hint={props.hint} sample={props.sample}>
      <Control label={props.label} value={props.value} picks={props.picks} onPick={props.onPick} />
    </Row>
  )
}

/** Something this page shows but only the Mac may change (a command or path it would run or store). */
export function ReadOnlyRow(props: { label: string; value: string; note?: string }) {
  return (
    <Row label={props.label} hint={props.note}>
      <span className={SETTINGS_VALUE}>{props.value}</span>
    </Row>
  )
}

/** A section's data: the last reply at once, read again on every (re)connect. `failed` says why the latest read failed. */
export function useSectionReply<T>(client: BridgeClient, op: string) {
  const [value, setValue] = useState<T | undefined>(() => lastReply<T>(client, op))
  const [failed, setFailed] = useState<string | null>(null)
  const reload = useCallback(
    () =>
      requestRemembered<T>(client, op).then(
        (reply) => {
          setValue(reply)
          setFailed(null)
        },
        (e) => setFailed(errorText(e)),
      ),
    [client, op],
  )
  useEffect(() => client.onOpen(() => void reload()), [client, reload])
  return { value, failed, reload }
}

/** Where a section's content goes before its first reply: loading, or why it could not load. */
export function SectionPending(props: { failed: string | null; onRetry: () => void }) {
  if (props.failed === null) return <p className={SETTINGS_STATUS}>{t("preview.loading")}</p>
  return (
    <p className={SETTINGS_STATUS}>
      {t("settings.loadFailed", { error: props.failed })} <Button onClick={props.onRetry}>{t("settings.retry")}</Button>
    </p>
  )
}
