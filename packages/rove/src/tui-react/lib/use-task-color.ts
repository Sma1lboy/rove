import type { RGBA } from "@opentui/core"
import { DEFAULT_TASK_COLORS, TASK_COLORS_KEY, normalizeTaskColors } from "../../state/task-colors"
import { taskColor } from "../../tui/lib/task-color"
import { useOptionalKV } from "../context/kv"
import { useTheme } from "../context/theme"

/** The task's own colour, or undefined when the setting is off (callers keep their theme ink). */
export function useTaskColor(taskId: string | null | undefined): RGBA | undefined {
  const { theme } = useTheme()
  const kv = useOptionalKV()
  if (!taskId || normalizeTaskColors(kv?.get(TASK_COLORS_KEY, DEFAULT_TASK_COLORS)) === "off") return undefined
  return taskColor(taskId, theme)
}
