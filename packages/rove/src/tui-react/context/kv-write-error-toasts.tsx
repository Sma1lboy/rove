/** @jsxImportSource @opentui/react */
/**
 * Toast for a failed `state.json` flush (read-only dir, foreign lock, full
 * disk), which would otherwise look saved all session and revert next launch.
 *
 * Not in `kv.tsx`: `notifications.tsx` imports `useOptionalKV` from there, so
 * that would be an import cycle. Mounted by `lib/host-boot.tsx` inside the
 * notifications provider, which sits below KV.
 */

import { useEffect } from "react"
import { tildify } from "../../lib/path-home"
import { t } from "../i18n"
import { useOptionalKV } from "./kv"
import { useOptionalNotifications } from "./notifications"

export function KvWriteErrorToasts() {
  const kv = useOptionalKV()
  const notifications = useOptionalNotifications()
  useEffect(() => {
    if (!kv || !notifications) return
    return kv.onWriteError((failure) => {
      notifications.notify({
        taskId: "",
        tabId: "",
        kind: "error",
        title: t("settings.stateWrite.failedTitle"),
        // One truncated line, file first; `tildify` saves ~15 cells of home prefix.
        body: t("settings.stateWrite.failedBody", {
          file: tildify(failure.file),
          keys: failure.keys.join(", "),
        }),
      })
    })
  }, [kv, notifications])
  return null
}
