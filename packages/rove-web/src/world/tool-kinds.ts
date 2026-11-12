/**
 * What a tool call looks like in the world: one of five works, so the scene can colour and pace a
 * call without knowing any engine's spelling. Names arrive as the engine wrote them (claude's
 * `Read`, codex's `shell`, an MCP tool's `mcp__server__tool`); the match is by keyword, and an
 * unknown name is `other`, never a guess at a vendor.
 */

export const TOOL_KINDS = ["scan", "build", "run", "plan", "other"] as const
export type ToolKind = (typeof TOOL_KINDS)[number]

const RULES: readonly (readonly [RegExp, ToolKind])[] = [
  [/read|view|cat\b|grep|glob|list|find|search|fetch|web|http|query|look/i, "scan"],
  [/edit|write|patch|create|apply|notebook|insert|replace|delete|remove|move|rename/i, "build"],
  [/bash|shell|exec|run\b|command|python|node|sh\b|terminal|test/i, "run"],
  [/task|agent|todo|plan|think|subagent|delegate/i, "plan"],
]

/** The kind of work a call did; `other` when nothing matches. */
export function toolKind(name: string): ToolKind {
  const bare = name.replace(/^mcp__[^_]*__/i, "")
  for (const [pattern, kind] of RULES) if (pattern.test(bare)) return kind
  return "other"
}

/** The scene's colour per kind (sRGB hex). `other` is the neutral ink, so a stray call never looks special. */
export const KIND_COLOR: Readonly<Record<ToolKind, number>> = {
  scan: 0x6ee7ff,
  build: 0xffb454,
  run: 0x7ee787,
  plan: 0xc792ea,
  other: 0x9aa4b2,
}

/** The name a floating label shows: the vendor prefix gone, upper-cased, and short enough to read at a glance. */
export function shortToolName(name: string, max = 9): string {
  const bare = name
    .replace(/^mcp__[^_]*__/i, "")
    .replace(/[_\s]+/g, "-")
    .toUpperCase()
  return bare.length > max ? `${bare.slice(0, max - 1)}…` : bare || "TOOL"
}
