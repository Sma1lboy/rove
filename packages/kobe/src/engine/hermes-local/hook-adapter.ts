/**
 * Hermes Agent hook adapter.
 *
 * Two writes, not one, and BOTH are needed for a single report to arrive:
 * the plugin package under `~/.hermes/plugins/rove-agent-state/` (see
 * `./plugin-source.ts`), and this plugin's name in `plugins.enabled` inside
 * `~/.hermes/config.yaml` (see `./config-yaml.ts`) — Hermes loads only what
 * that list names, so the files alone are inert.
 *
 * The config edit is the part that can REFUSE. It is line-based and handles
 * the two block shapes it can edit without reformatting a hand-written
 * config; any other shape is reported rather than rewritten, exactly as the
 * JSON adapters treat a settings document they cannot merge into. The plugin
 * files are still written in that case — they are Rove's own directory and
 * cost nothing while dormant — so enabling the plugin by hand is all that is
 * left to do.
 *
 * {@link globalSettingsPath} names `config.yaml` rather than the plugin
 * package: it is the file `rove doctor` needs to talk about, and the one whose
 * contents decide whether a hook ever fires.
 */

import { existsSync } from "node:fs"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { kobeHookInvocation } from "../../cli/invocation.ts"
import type { EngineHookAdapter, EngineSessionRef } from "../hook-adapter.ts"
import type { EngineActivityDetail } from "../hook-events.ts"
import type { HookEditOutcome } from "../json-hooks.ts"
import { updateSharedJson } from "../shared-config-write.ts"
import { HERMES_PLUGIN_NAME, setHermesPluginEnabled } from "./config-yaml.ts"
import { HERMES_PLUGIN_MANIFEST, renderHermesPluginSource } from "./plugin-source.ts"

/** Hermes' config directory is `~/.hermes`, with no env override. */
function hermesConfigDir(home: string = homedir()): string {
  return path.join(home, ".hermes")
}

/** The file that decides whether the plugin loads. */
export function hermesConfigPath(home: string = homedir()): string {
  return path.join(hermesConfigDir(home), "config.yaml")
}

/** The Rove-managed plugin package. */
export function hermesPluginDir(home: string = homedir()): string {
  return path.join(hermesConfigDir(home), "plugins", HERMES_PLUGIN_NAME)
}

export class HermesHookAdapter implements EngineHookAdapter {
  readonly vendor = "hermes" as const

  supportsHooks(): boolean {
    return true
  }

  globalSettingsPath(): string {
    return hermesConfigPath()
  }

  /** The session hooks carry no failure or permission detail — the screen
   *  manifest is what answers "what is it doing" for hermes. */
  activityDetailFromPayload(): EngineActivityDetail | undefined {
    return undefined
  }

  /** The payload is Rove's own (see `./plugin-source.ts`). */
  sessionFromPayload(payload: Record<string, unknown>): EngineSessionRef | undefined {
    const sessionId = typeof payload.session_id === "string" ? payload.session_id : undefined
    return sessionId ? { sessionId } : undefined
  }

  async installActivityHooks(settingsFilePath: string, opts: { quiet?: boolean } = {}): Promise<HookEditOutcome> {
    // No `~/.hermes` means the CLI was never installed here; creating it would
    // leave a config tree nothing will ever read.
    const configDir = path.dirname(settingsFilePath)
    if (!existsSync(configDir)) return { ok: true }

    const pluginDir = path.join(configDir, "plugins", HERMES_PLUGIN_NAME)
    await writeIfChanged(path.join(pluginDir, "plugin.yaml"), HERMES_PLUGIN_MANIFEST)
    await writeIfChanged(
      path.join(pluginDir, "__init__.py"),
      renderHermesPluginSource({ vendor: this.vendor, invocation: kobeHookInvocation() }),
    )

    const outcome = await this.editConfig(settingsFilePath, true)
    if (!outcome.ok && !opts.quiet) {
      process.stderr.write(`[rove hooks] hermes: skipped ${outcome.file}: ${outcome.reason}\n`)
    }
    return outcome
  }

  async removeActivityHooks(settingsFilePath: string): Promise<void> {
    if (existsSync(settingsFilePath)) await this.editConfig(settingsFilePath, false)
    try {
      await rm(path.join(path.dirname(settingsFilePath), "plugins", HERMES_PLUGIN_NAME), {
        recursive: true,
        force: true,
      })
    } catch {
      /* best-effort — never block launch */
    }
  }

  hookConfigRefusal(raw: string): string | undefined {
    const edit = setHermesPluginEnabled(raw, true)
    return edit.ok ? undefined : edit.reason
  }

  supportsWorktreeSync(): boolean {
    return false
  }

  async removeWorktreeSyncHook(): Promise<void> {
    /* Hermes never had a WorktreeCreate hook. */
  }

  async removeWorktreeWatchHook(): Promise<void> {
    /* ...nor the PostToolUse(Bash) watch hook. */
  }

  /**
   * Read → edit → write `config.yaml` under the shared-file lock, skipping the
   * write when the edit is a no-op. The file belongs to the CLI, so it takes
   * the same care the JSON settings files do.
   */
  private async editConfig(file: string, enabled: boolean): Promise<HookEditOutcome> {
    let rejected: string | undefined
    try {
      // `updateSharedJson` is named for its callers, but its load→build pair is
      // raw text in, raw text out; carrying the YAML through as a one-field doc
      // reuses its lock, CAS and tmp+rename rather than a second copy of them.
      await updateSharedJson(
        file,
        (raw) => ({ raw: raw ?? "" }),
        (doc) => {
          const raw = String(doc.raw ?? "")
          const edit = setHermesPluginEnabled(raw, enabled)
          if (!edit.ok) {
            rejected = edit.reason
            return undefined
          }
          return edit.content === raw ? undefined : edit.content
        },
      )
    } catch (err) {
      return { ok: false, file, reason: err instanceof Error ? err.message : String(err) }
    }
    if (rejected !== undefined) return { ok: false, file, reason: rejected }
    return { ok: true }
  }
}

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
