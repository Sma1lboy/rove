/**
 * Codex adapter capabilities: the vendor-owned terminal-presentation
 * policy the workspace applies to Codex's full-screen UI.
 */

import type { EngineCapabilities, EngineIdentity } from "@/types/engine"
import { codexTerminalPresentation } from "./terminal-presentation"

export const codexCapabilities: EngineCapabilities = {
  terminalPresentation: codexTerminalPresentation,
  // Esc, same as claude — and for the same reason it is written down per
  // engine rather than assumed: codex reads ctrl-C as quit.
  interruptSequence: "\u001b",
}

export const codexIdentity: EngineIdentity = {
  shortName: "Codex",
}
