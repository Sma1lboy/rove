/**
 * A plugin's input dialog (`rove api prompt`) on the web, the TUI's host dialog's twin: the bridge
 * pushes the question as `prompt`, and the answer (or the cancel, when the dialog closes without
 * one) goes back over `ui.promptReply`. The first client to answer wins; a later one is told so.
 */

import { en as commonEn, zh as commonZh } from "@sma1lboy/rove/src/tui/i18n/messages/common.ts"
import { useEffect, useRef, useState } from "react"
import type { BridgeClient } from "./bridge.ts"
import { DialogActions, DialogShell, useSubmit } from "./dialogs.tsx"
import { useLocale } from "./i18n/index.ts"
import { dialog } from "./ui.ts"
import { DIALOG_BODY } from "./ui/overlay.ts"

export interface PromptPush {
  readonly promptId: string
  readonly title: string
  readonly placeholder?: string
  readonly initial?: string
}

export function isPromptPush(data: unknown): data is PromptPush {
  const p = data as Partial<PromptPush> | null
  return !!p && typeof p.promptId === "string" && typeof p.title === "string"
}

function PromptDialog({ client, prompt }: { client: BridgeClient; prompt: PromptPush }) {
  const copy = (useLocale() === "zh" ? commonZh : commonEn).prompt
  const [value, setValue] = useState(prompt.initial ?? "")
  const answered = useRef(false)
  const { busy, error, submit } = useSubmit()
  // Esc, a click outside or Cancel unmounts the dialog: that is the plugin's cancel.
  useEffect(
    () => () => {
      if (!answered.current) void client.request("ui.promptReply", { promptId: prompt.promptId }).catch(() => {})
    },
    [client, prompt.promptId],
  )
  return (
    <DialogShell title={prompt.title}>
      <form
        className={DIALOG_BODY}
        onSubmit={(e) => {
          e.preventDefault()
          void submit(async () => {
            await client.request("ui.promptReply", { promptId: prompt.promptId, value })
            answered.current = true
          })
        }}
      >
        <input
          className="input"
          aria-label={copy.fieldLabel}
          // biome-ignore lint/a11y/noAutofocus: a dialog's only field
          autoFocus
          spellCheck={false}
          value={value}
          placeholder={prompt.placeholder}
          onChange={(e) => setValue(e.target.value)}
        />
        {error && <p className="error">{error}</p>}
        <DialogActions busy={busy} submitLabel={copy.submitLabel} />
      </form>
    </DialogShell>
  )
}

/** Show a pushed question, unless the user is already in another dialog (then it waits for its timeout). */
export function openPrompt(client: BridgeClient, prompt: PromptPush): void {
  if (dialog.get()) return
  dialog.set(<PromptDialog key={prompt.promptId} client={client} prompt={prompt} />)
}
