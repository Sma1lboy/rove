/**
 * Claude-code adapter capabilities.
 *
 * The single object kobe's neutral layers (orchestrator, TUI) consult
 * for anything vendor-specific about claude. See {@link EngineCapabilities}
 * for the contract. Claude needs no terminal-presentation adjustments, so
 * the object is empty today.
 */

import type { EngineCapabilities, EngineIdentity } from "@/types/engine"

export const claudeCapabilities: EngineCapabilities = {}

export const claudeIdentity: EngineIdentity = {
  vendorId: "claude",
  shortName: "Claude",
}
