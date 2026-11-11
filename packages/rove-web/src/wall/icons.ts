/** The engines' brand marks, read through Vite so the type checker does not walk the engine package. */
import type { EngineIconData } from "../ui/engine-icon.tsx"

const mod = Object.values(
  (
    import.meta as unknown as {
      glob: (p: string, o: { eager: true }) => Record<string, Record<string, EngineIconData>>
    }
  ).glob("../../../rove/src/engine/engine-icons.ts", { eager: true }),
)[0] as Record<string, EngineIconData>

export const CLAUDE_ICON = mod.CLAUDE_ICON as EngineIconData
export const CODEX_ICON = mod.CODEX_ICON as EngineIconData
export const COPILOT_ICON = mod.COPILOT_ICON as EngineIconData
export const KIMI_ICON = mod.KIMI_ICON as EngineIconData
