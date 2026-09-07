/**
 * Codex adapter capabilities: the vendor-owned terminal-presentation
 * policy the workspace applies to Codex's full-screen UI.
 */

import type { EngineCapabilities, EngineIdentity } from "@/types/engine"
import { codexTerminalPresentation } from "./terminal-presentation"

export const codexCapabilities: EngineCapabilities = {
  terminalPresentation: codexTerminalPresentation,
}

export const codexIdentity: EngineIdentity = {
  shortName: "Codex",
}
