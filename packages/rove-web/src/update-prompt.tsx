/**
 * A new version asks once, with its release notes: Update, Not now, or Skip this version. Not now keeps quiet until the
 * page is loaded again; Skip keeps quiet about that version in this browser, and the next one asks
 * again. Settings' `update.notify` off silences it with the rail chip. The chip and the Update
 * page still show a skipped version.
 */

import type { ReleaseNotesRangeItem } from "@sma1lboy/rove/src/version.ts"
import { DialogShell } from "./dialogs.tsx"
import { t } from "./i18n/index.ts"
import { openPage } from "./layout.ts"
import { prefsStore } from "./prefs.ts"
import { ReleaseNotes } from "./release-notes.tsx"
import { closeDialog, dialog } from "./ui.ts"
import { Button } from "./ui/button.tsx"
import { DIALOG_BODY } from "./ui/overlay.ts"
import { ACTIONS } from "./ui/text.ts"
import { NotesRange, updateAutoRun, updateState } from "./update-view.tsx"

const SKIP_KEY = "rove.web.update.skipped"

/** The version to ask about, or null. `asked` is the one already asked about since the page loaded. */
export function versionToAsk(o: {
  readonly latest: string | null
  readonly notify: boolean
  readonly skipped: string | null
  readonly asked: string | null
}): string | null {
  if (!o.latest || !o.notify) return null
  return o.latest === o.skipped || o.latest === o.asked ? null : o.latest
}

let asked: string | null = null

/** Call after each update check. A dialog already open is left alone; the next check asks. */
export function maybeAskToUpdate(): void {
  const state = updateState.get()
  const latest = versionToAsk({
    latest: state?.info?.hasUpdate ? state.info.latest : null,
    notify: prefsStore.get().prefs.updateNotify,
    skipped: localStorage.getItem(SKIP_KEY),
    asked,
  })
  if (!latest || dialog.get() !== null) return
  asked = latest
  dialog.set(<UpdatePrompt current={state?.current ?? ""} latest={latest} notes={state?.notes ?? []} />)
}

function UpdatePrompt(props: { current: string; latest: string; notes: readonly ReleaseNotesRangeItem[] }) {
  const [only] = props.notes
  return (
    <DialogShell title={t("updatePrompt.title", { version: props.latest })} wide={props.notes.length > 0}>
      <div className={DIALOG_BODY}>
        <p className="text-muted">{t("updatePrompt.body", { current: props.current })}</p>
        {/* One release: the title already names it. */}
        {props.notes.length === 1 && only ? <ReleaseNotes body={only.body} /> : <NotesRange notes={props.notes} />}
        <div className={ACTIONS}>
          <Button
            onClick={() => {
              localStorage.setItem(SKIP_KEY, props.latest)
              closeDialog()
            }}
          >
            {t("updatePrompt.skip")}
          </Button>
          <Button onClick={closeDialog}>{t("updatePrompt.later")}</Button>
          <Button
            variant="filled"
            // biome-ignore lint/a11y/noAutofocus: the dialog's primary action takes Enter, as every dialog here
            autoFocus
            onClick={() => {
              closeDialog()
              updateAutoRun.set(true)
              openPage("update")
            }}
          >
            {t("updatePrompt.yes")}
          </Button>
        </div>
      </div>
    </DialogShell>
  )
}
