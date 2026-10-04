/**
 * Claude-code adapter capabilities.
 *
 * The single object kobe's neutral layers (orchestrator, TUI) consult
 * for anything vendor-specific about claude. See {@link EngineCapabilities}
 * for the contract. Claude needs no terminal-presentation adjustments.
 */

import type { EngineCapabilities, EngineIdentity } from "@/types/engine"

export const claudeCapabilities: EngineCapabilities = {
  // Claude Code's own "esc to interrupt" hint, sent as the byte the terminal
  // would deliver. ctrl-C is deliberately NOT it: claude reads that as quit.
  interruptSequence: "\u001b",
}

export const claudeIdentity: EngineIdentity = {
  shortName: "Claude",
}
