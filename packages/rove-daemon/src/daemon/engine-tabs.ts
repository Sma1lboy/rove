/**
 * Which engine tab of a task is its conversation. A task holds one; a viewport
 * tab (`EngineTab.ptyTask`) only shows another task's session and is never
 * counted, so every reader picks the same tab.
 */

interface EngineTabLike {
  readonly id: string
  readonly kind: string
  readonly ptyTask?: unknown
}

/** Engine tabs whose PTY belongs to the task itself, in tab order. */
export function ownEngineTabs<T extends EngineTabLike>(tabs: readonly T[]): T[] {
  return tabs.filter((tab) => tab.kind === "engine" && tab.ptyTask === undefined)
}

/** `tab-1` when it is an own engine tab, else the first own engine tab. */
export function canonicalEngineTab<T extends EngineTabLike>(tabs: readonly T[]): T | undefined {
  const own = ownEngineTabs(tabs)
  return own.find((tab) => tab.id === "tab-1") ?? own[0]
}
