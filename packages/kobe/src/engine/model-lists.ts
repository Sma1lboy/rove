/**
 * The `listModels` half of the built-in engine table — what each first-party
 * engine can NAME as a model, in the neutral {@link EngineModel} shape.
 *
 * Two kinds of engine live here. Claude and codex ship no list verb, so their
 * entries are short static alias lists copied from the CLI's own docs (dated
 * below — refresh them when the CLI does; they are suggestions, never a
 * closed set). Pi and omp DO have one, run here with a deadline so a hung
 * binary cannot wedge `engine-list` or a dialog. Any failure rejects; the
 * callers (`engine-list` → `models: null`, the pickers → free text) own the
 * degradation, so nothing here swallows an error into an empty list — an
 * empty list means "listed, found none", which is a different fact.
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
 * Parse `pi --list-models`: a whitespace-aligned table whose header is
 * `provider  model  context  max-out  thinking  images`. Two providers can
 * carry the same model name (a proxy re-exporting `openai`'s), so the id is
 * the unambiguous `provider/model` form pi's `--model` accepts, and the label
 * is the bare model name.
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

/**
 * Parse `omp models --json`: `{ models: [{ selector, name, … }] }`, where
 * `selector` is the `provider/id` string `--model=` matches exactly.
 */
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
