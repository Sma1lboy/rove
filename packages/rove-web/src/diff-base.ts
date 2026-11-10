/** The ref a task's diff is compared against when the reviewer picked one, kept per task in this browser. */

import { useState } from "react"
import { openDiff } from "./panel-state.ts"
import type { Preview } from "./ui.ts"

const KEY = "rove.diffBase"

function loadAll(): Record<string, string> {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}")
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return {}
    return Object.fromEntries(Object.entries(saved).filter((e): e is [string, string] => typeof e[1] === "string"))
  } catch {
    return {}
  }
}

/** The task's chosen ref; null = its own base. */
export function loadBase(taskId: string): string | null {
  return loadAll()[taskId] ?? null
}

export function saveBase(taskId: string, ref: string | null): void {
  const all = loadAll()
  if (ref === null) delete all[taskId]
  else all[taskId] = ref
  try {
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch {
    // Storage off: the choice lasts this page only.
  }
}

/** The task's chosen ref and its setter; choosing one moves the view to the scope that uses it. */
export function useDiffBase(view: Preview): [string | null, (ref: string | null) => void] {
  const [picked, setPicked] = useState(() => loadBase(view.taskId))
  const pick = (ref: string | null) => {
    saveBase(view.taskId, ref)
    setPicked(ref)
    if (ref !== null && view.scope !== "task") openDiff({ taskId: view.taskId, path: view.path, scope: "task" })
  }
  return [picked, pick]
}
