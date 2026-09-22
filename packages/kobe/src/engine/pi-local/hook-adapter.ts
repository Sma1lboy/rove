/**
 * pi-family hook adapter for `pi` and `omp`: where the extension lives and
 * what its payload means (`./extension-source.ts` owns what it reports).
 *
 * One class for both: omp is Stencil Labs' fork of pi, sharing the extension
 * API, `PI_CODING_AGENT_DIR` and session layout. Only the default agent dir
 * and `--engine <id>` tag differ, so the vendor is a constructor argument.
 */

import { existsSync } from "node:fs"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { kobeHookInvocation } from "../../cli/invocation.ts"
import type { VendorId } from "../../types/vendor.ts"
import type { EngineHookAdapter, EngineSessionRef } from "../hook-adapter.ts"
import type { EngineActivityDetail, EngineActivityKind } from "../hook-events.ts"
import type { HookEditOutcome } from "../json-hooks.ts"
import { type VendorHomeDeps, vendorAgentDir } from "../vendor-home.ts"
import { renderPiExtensionSource } from "./extension-source.ts"

/** The pi-family vendors this adapter serves. */
export type PiFamilyVendor = "pi" | "omp"

/** The one file Rove manages inside the agent dir. */
export const ACTIVITY_EXTENSION_FILE = "rove-activity.ts"

/** `<agentDir>/extensions` — where both CLIs discover extension modules. */
export function piExtensionsDir(vendor: PiFamilyVendor, deps?: VendorHomeDeps): string {
  return path.join(vendorAgentDir(vendor, deps), "extensions")
}

/** The Rove-managed extension module for `vendor`, at its install path. */
export function piActivityExtensionPath(vendor: PiFamilyVendor, deps?: VendorHomeDeps): string {
  return path.join(piExtensionsDir(vendor, deps), ACTIVITY_EXTENSION_FILE)
}

/**
 * Provider failure text → neutral failure class. Heuristic because neither
 * CLI gives a stable error CODE, only the provider's message.
 *
 * `rate_limit` (429) arms the daemon's auto-resume timer; `billing` (402,
 * "insufficient credits") does NOT, since an exhausted balance needs a human.
 */
function piFailureDetail(payload: Record<string, unknown>): EngineActivityDetail {
  const raw = typeof payload.error_message === "string" ? payload.error_message : ""
  const message = raw.toLowerCase()
  const note = raw ? raw.slice(0, 200) : undefined
  const failure: NonNullable<EngineActivityDetail["failure"]> = (() => {
    if (/insufficient|credit|billing|payment required|\b402\b|quota exceeded|out of credits/.test(message)) {
      return "billing"
    }
    if (/rate.?limit|too many requests|\b429\b|overloaded|capacity/.test(message)) return "rate_limit"
    return "other"
  })()
  return { failure, ...(note ? { note } : {}) }
}

export class PiFamilyHookAdapter implements EngineHookAdapter {
  readonly vendor: VendorId

  constructor(private readonly family: PiFamilyVendor) {
    this.vendor = family
  }

  supportsHooks(): boolean {
    return true
  }

  /** Not a settings file: the extension module the CLI loads. */
  globalSettingsPath(): string {
    return piActivityExtensionPath(this.family)
  }

  /**
   * The payload vocabulary is the extension's, not the CLI's, except
   * `error_message`, copied straight from the engine.
   */
  activityDetailFromPayload(
    kind: EngineActivityKind,
    payload: Record<string, unknown>,
  ): EngineActivityDetail | undefined {
    if (kind === "turn-failed") return piFailureDetail(payload)
    // Approval (decision) vs question tool (answer); subscribers get different events.
    if (kind === "awaiting-input") return { waiting: payload.waiting === "input" ? "input" : "permission" }
    if (kind === "tool-pre" || kind === "tool-post" || kind === "tool-failed") {
      const name = typeof payload.tool_name === "string" ? payload.tool_name : undefined
      return { tool: { ...(name ? { name } : {}) } }
    }
    return undefined
  }

  /** The extension reports the CLI's own `sessionManager` identity. */
  sessionFromPayload(payload: Record<string, unknown>): EngineSessionRef | undefined {
    const sessionId = typeof payload.session_id === "string" ? payload.session_id : undefined
    if (!sessionId) return undefined
    const transcriptPath = typeof payload.transcript_path === "string" ? payload.transcript_path : undefined
    return { sessionId, ...(transcriptPath ? { transcriptPath } : {}) }
  }

  async installActivityHooks(settingsFilePath: string, opts: { toolEvents?: boolean } = {}): Promise<HookEditOutcome> {
    // No agent dir = CLI not installed: don't materialize it, and not a
    // refusal. Derived from the given path, not `vendorAgentDir`, so the check
    // describes the tree the write would land in.
    const agentDir = path.dirname(path.dirname(settingsFilePath))
    if (!existsSync(agentDir)) return { ok: true }
    const source = renderPiExtensionSource({
      vendor: this.family,
      invocation: kobeHookInvocation(),
      toolEvents: opts.toolEvents ?? false,
    })
    await writeIfChanged(settingsFilePath, source)
    return { ok: true }
  }

  async removeActivityHooks(settingsFilePath: string): Promise<void> {
    try {
      await rm(settingsFilePath, { force: true })
    } catch {
      /* best-effort — never block launch */
    }
  }

  supportsWorktreeSync(): boolean {
    return false
  }

  async removeWorktreeSyncHook(): Promise<void> {
    /* The pi family never had a WorktreeCreate hook. */
  }

  async removeWorktreeWatchHook(): Promise<void> {
    /* ...nor the PostToolUse(Bash) watch hook. */
  }
}

/** Write only when different, so a per-launch reinstall leaves the mtime alone. */
async function writeIfChanged(file: string, content: string): Promise<void> {
  try {
    const current = await readFile(file, "utf8").catch(() => undefined)
    if (current === content) return
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, content)
  } catch {
    /* best-effort — never block launch */
  }
}
