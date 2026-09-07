/** @jsxImportSource @opentui/react */
/**
 * The on-screen half of a failed `state.json` write.
 *
 * `kv.set` updates the snapshot immediately and schedules a 250ms debounced
 * flush that nobody awaits. When that flush throws (a read-only state dir, a
 * lock path something else owns, a full disk) the only trace used to be a
 * `console.error` the alternate screen swallows — so a theme change, a
 * settings toggle or a sidebar resize looked saved for the whole session and
 * silently reverted at the next launch, `seen` marks included.
 *
 * Lives in its own file rather than in `kv.tsx` because `notifications.tsx`
 * imports `useOptionalKV` from there; wiring the toast inside `kv.tsx` would
 * close that import cycle. Mounted by `lib/host-boot.tsx` inside the
 * notifications provider — KV sits ABOVE it in the fixed nesting order, so
 * the provider itself cannot raise a toast.
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
        // A toast body is one truncated line, so the file leads: `tildify`
        // buys back the ~15 cells the home prefix costs, which is the
        // difference between reading the filename and reading "/Users/…".
        body: t("settings.stateWrite.failedBody", {
          file: tildify(failure.file),
          keys: failure.keys.join(", "),
        }),
      })
    })
  }, [kv, notifications])
  return null
}
