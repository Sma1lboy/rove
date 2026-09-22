/**
 * What each built-in engine can NAME as a model.
 *
 * Claude and codex have no list verb: static aliases from the CLI docs (dated
 * below; refresh with the CLI; suggestions, never a closed set). Pi and omp's
 * list verbs run under a deadline so a hung binary can't wedge `engine-list`.
 * Failures reject — callers own degradation — because an empty list means
 * "listed, found none".
 *
 * Must stay importable from vitest (node `child_process`, not `Bun.spawn`)
 * and MUST NOT import from `src/tui/`.
 */

import { execFile } from "node:child_process"
import { promisify } from "node:util"
import type { EngineModel } from "./registry.ts"

const run = promisify(execFile)

/** One deadline for every list verb: long enough for a cold `omp` catalog
 *  refresh, short enough that a hung binary reads as a failure, not a stall. */
const LIST_TIMEOUT_MS = 15_000

async function stdoutOf(bin: string, args: readonly string[]): Promise<string> {
  const { stdout } = await run(bin, [...args], { encoding: "utf8", timeout: LIST_TIMEOUT_MS, maxBuffer: 4 << 20 })
  return stdout
}

/** `claude --help` on 2026-09-17: `--model` takes an alias for the latest
 *  model (`fable`, `opus`, `sonnet`) or a model's full name. */
export const CLAUDE_MODELS: readonly EngineModel[] = [{ id: "fable" }, { id: "opus" }, { id: "sonnet" }]

/** codex-cli 0.154.0 on 2026-09-17: `-m` takes a model slug; the CLI lists
 *  none. These are the slugs its own config notices name
 *  (`[tui.model_availability_nux]` + `[notice.model_migrations]`). */
export const CODEX_MODELS: readonly EngineModel[] = [
  { id: "gpt-6-astra" },
  { id: "gpt-5.6-luna" },
  { id: "gpt-5.6-sol" },
  { id: "gpt-5.5" },
]

/**
 * `pi --list-models`: whitespace table, header `provider  model  context …`.
 * Id is `provider/model` (two providers can share a model name), label the bare name.
 */
export function parsePiModelTable(stdout: string): readonly EngineModel[] {
  const out: EngineModel[] = []
  for (const line of stdout.split("\n")) {
    const cols = line.trim().split(/\s+/)
    if (cols.length < 2) continue
    const [provider, model] = cols as [string, string]
    if (provider === "provider" && model === "model") continue
    out.push({ id: `${provider}/${model}`, label: model })
  }
  return out
}

export async function listPiModels(): Promise<readonly EngineModel[]> {
  return parsePiModelTable(await stdoutOf("pi", ["--list-models"]))
}

/** `omp models --json`: `{ models: [{ selector, name }] }`; `--model=` matches `selector` exactly. */
export function parseOmpModelJson(stdout: string): readonly EngineModel[] {
  const parsed: unknown = JSON.parse(stdout)
  const models = (parsed as { models?: unknown }).models
  if (!Array.isArray(models)) throw new Error("omp models --json: no `models` array")
  const out: EngineModel[] = []
  for (const m of models as readonly { selector?: unknown; name?: unknown }[]) {
    if (typeof m.selector !== "string" || !m.selector) continue
    out.push({ id: m.selector, ...(typeof m.name === "string" && m.name ? { label: m.name } : {}) })
  }
  return out
}

export async function listOmpModels(): Promise<readonly EngineModel[]> {
  return parseOmpModelJson(await stdoutOf("omp", ["models", "--json"]))
}
