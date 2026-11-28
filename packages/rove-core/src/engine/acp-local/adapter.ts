/**
 * Generic ACP (`agent-client-protocol`) engine adapter entry conforming to Rove's
 * `EngineRegistryEntry` contract. Any custom preset declaring `engineProtocol.<id> = "acp"`
 * or plugin `[[engines]]` entry declaring `protocol = "acp"` inherits this adapter:
 * structured JSONL history, turn completion markers, session resumption, Ctrl+C turn
 * cancellation, and hosted launch wrapping via `rove _acp-bridge` — zero per-CLI screen scraping.
 */

import { roveCliInvocation } from "@sma1lboy/rove-core/lib/invocation.ts"
import type { EngineCapabilities, EngineIdentity } from "@sma1lboy/rove-core/types/engine.ts"
import type { VendorId } from "@sma1lboy/rove-core/types/vendor.ts"
import { NoopHookAdapter } from "../hook-adapter.ts"
import type { EngineRegistryEntry } from "../registry.ts"
import { AcpTurnDetector, acpHistoryReader } from "./history.ts"

export const ACP_PROTOCOL = "acp" as const
export const ACP_BRIDGE_SUBCOMMAND = "_acp-bridge" as const

export const acpIdentity: EngineIdentity = {
  shortName: "ACP",
}

export const acpCapabilities: EngineCapabilities = {
  // Ctrl+C triggers ACP `session/cancel` in `_acp-bridge` without terminating the session.
  interruptSequence: "\x03",
}

/** Resolve the `rove` CLI prefix used to wrap an ACP agent argv (testable seam). */
function bridgePrefix(cli?: readonly string[]): readonly string[] {
  if (cli) return [...cli, ACP_BRIDGE_SUBCOMMAND]
  try {
    return [...roveCliInvocation({ sameInstall: true }), ACP_BRIDGE_SUBCOMMAND]
  } catch {
    return ["rove", ACP_BRIDGE_SUBCOMMAND]
  }
}

/** Find the index of `_acp-bridge` and its `--` separator if `argv` is already wrapped. */
export function findAcpBridgeSeparator(argv: readonly string[]): { bridgeIndex: number; sepIndex: number } | null {
  const bridgeIndex = argv.findIndex((token) => token === ACP_BRIDGE_SUBCOMMAND)
  if (bridgeIndex < 0) return null
  const sepOffset = argv.slice(bridgeIndex + 1).findIndex((token) => token === "--")
  if (sepOffset < 0) return null
  return { bridgeIndex, sepIndex: bridgeIndex + 1 + sepOffset }
}

/** Wrap an ACP agent command with `rove _acp-bridge -- <agent-argv...>` (idempotent). */
export function ensureAcpBridgeWrapped(argv: readonly string[], cli?: readonly string[]): readonly string[] {
  if (argv.length === 0) return argv
  if (findAcpBridgeSeparator(argv)) return argv
  return [...bridgePrefix(cli), "--", ...argv]
}

/**
 * Insert `_acp-bridge` flags immediately before `--`, wrapping first if needed.
 * Keeps bridge flags (`--bypass-permissions`, `--resume`, `--prompt`) strictly
 * separated from the downstream ACP agent's own argv.
 */
export function insertAcpBridgeFlags(
  argv: readonly string[],
  flags: readonly string[],
  cli?: readonly string[],
): readonly string[] {
  const wrapped = ensureAcpBridgeWrapped(argv, cli)
  const loc = findAcpBridgeSeparator(wrapped)
  if (!loc) return wrapped
  return [...wrapped.slice(0, loc.sepIndex), ...flags, ...wrapped.slice(loc.sepIndex)]
}

/** Build an `EngineRegistryEntry` for an ACP-speaking engine. */
export function createAcpEngineEntry(
  vendor: VendorId = ACP_PROTOCOL,
  overrides: Partial<EngineRegistryEntry> = {},
): EngineRegistryEntry {
  return {
    vendor,
    builtin: false,
    displayName: overrides.displayName ?? acpIdentity.shortName,
    defaultCommand: overrides.defaultCommand ?? [vendor],
    history: acpHistoryReader,
    createHookAdapter: () => new NoopHookAdapter(vendor),
    createTurnDetector: () => new AcpTurnDetector(),
    capabilities: acpCapabilities,
    identity: overrides.identity ?? acpIdentity,
    hostedStartArgv: (argv) => ensureAcpBridgeWrapped(argv),
    permissionBypass: {
      argv: (argv) => insertAcpBridgeFlags(argv, ["--bypass-permissions"]),
      present: ["--bypass-permissions"],
    },
    firstMessageArgv: (argv, text) => insertAcpBridgeFlags(argv, ["--prompt", text]),
    sessionIdentity: {
      sessionControlFlags: ["--resume"],
      resumeArgv: (base, sessionId) => insertAcpBridgeFlags(base, ["--resume", sessionId]),
    },
    ...overrides,
  }
}

/** Singleton registry entry for the generic `acp` protocol (`engineEntry("acp")`). */
export const ACP_ENGINE_ENTRY: EngineRegistryEntry = createAcpEngineEntry(ACP_PROTOCOL)
