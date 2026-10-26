import { useEffect } from "react"
import { type AppModel, selectedRow } from "./model.ts"
import { rowTitle } from "./rail.ts"
import { useStore } from "./store.ts"

/** The browser tab says which task is open and how much waits in the Inbox, like claude.ai's conversation titles. */
export function DocumentTitle({ model }: { model: AppModel }) {
  const selection = useStore(model.selection)
  const payload = useStore(model.tasks)
  const allTabs = useStore(model.tabs)
  const remote = useStore(model.remote)
  const task = selectedRow(payload, selection.taskId) ?? remote.find((row) => row.id === selection.taskId)
  const unread = payload?.attention.filter((row) => row.unread).length ?? 0
  const title = `${unread > 0 ? `(${unread}) ` : ""}${task ? `${rowTitle(task, allTabs[task.id])} · ` : ""}rove`
  useEffect(() => {
    document.title = title
  }, [title])
  return null
}
