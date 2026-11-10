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
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs"
import { delimiter, dirname, isAbsolute, join } from "node:path"
import { promisify } from "node:util"
import { roveStateDir } from "../env.ts"
import type { EngineModel } from "./registry.ts"

const run = promisify(execFile)

/** One deadline for every list verb: long enough for a cold `omp` catalog
 *  refresh, short enough that a hung binary reads as a failure, not a stall. */
const LIST_TIMEOUT_MS = 15_000

async function stdoutOf(bin: string, args: readonly string[]): Promise<string> {
  const { stdout } = await run(bin, [...args], { encoding: "utf8", timeout: LIST_TIMEOUT_MS, maxBuffer: 4 << 20 })
  return stdout
}

/** A catalog is a suggestion list, and probing `pi`/`omp` costs seconds. */
const CACHE_TTL_MS = 15 * 60_000

/** Identity of the binary a cached catalog came from: an engine upgrade is an
 *  install, so a changed mtime or size must not answer from the old list.
 *  `unknown` (not found on PATH, or an extension it did not guess) keeps the
 *  plain TTL. */
function binaryKey(bin: string): string {
  const dirs = isAbsolute(bin) ? [""] : (process.env.PATH ?? "").split(delimiter)
  for (const dir of dirs) {
    const candidate = dir ? join(dir, bin) : bin
    try {
      const s = statSync(candidate)
      if (s.isFile()) return `${candidate}:${s.mtimeMs}:${s.size}`
    } catch {
      /* not in this PATH entry */
    }
  }
  return `${bin}:unknown`
}

function readCache(key: string): readonly EngineModel[] | null {
  try {
    const parsed = JSON.parse(readFileSync(join(roveStateDir(), "model-lists.json"), "utf8")) as Record<
      string,
      { at?: unknown; models?: unknown } | undefined
    >
    const hit = parsed[key]
    if (!hit || typeof hit.at !== "number" || Date.now() - hit.at > CACHE_TTL_MS) return null
    return Array.isArray(hit.models) ? (hit.models as readonly EngineModel[]) : null
  } catch {
    return null
  }
}

function writeCache(key: string, models: readonly EngineModel[]): void {
  const path = join(roveStateDir(), "model-lists.json")
  try {
    mkdirSync(dirname(path), { recursive: true })
    let all: Record<string, unknown> = {}
    try {
      const parsed: unknown = JSON.parse(readFileSync(path, "utf8"))
      if (parsed && typeof parsed === "object") all = parsed as Record<string, unknown>
    } catch {
      /* a missing or unreadable cache is simply rebuilt */
    }
    all[key] = { at: Date.now(), models }
    const tmp = `${path}.tmp-${process.pid}`
    writeFileSync(tmp, JSON.stringify(all))
    renameSync(tmp, path)
  } catch {
    /* the cache is an optimization; a read-only home must not fail the verb */
  }
}

/** Probe once per binary version, then answer from the cache. Failures reject
 *  uncached: "listed, found none" and "could not list" must stay distinct. */
async function cachedModelList(
  bin: string,
  args: readonly string[],
  parse: (stdout: string) => readonly EngineModel[],
): Promise<readonly EngineModel[]> {
  const key = `${bin} ${args.join(" ")} ${binaryKey(bin)}`
  const hit = readCache(key)
  if (hit) return hit
  const models = parse(await stdoutOf(bin, args))
  writeCache(key, models)
  return models
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

/** Anthropic model spellings: full ids and the claude CLI's aliases. */
export function isClaudeFamilyModel(model: string): boolean {
  return /^(claude-|anthropic\/)|^(fable|opus|sonnet|haiku)(\[|$)/i.test(model.trim())
}

/** OpenAI model spellings codex takes: `gpt-*`, the `o<N>` line, `codex-*`. */
export function isOpenAiFamilyModel(model: string): boolean {
  return /^(gpt-|o\d|codex-|openai\/)/i.test(model.trim())
}

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
  return cachedModelList("pi", ["--list-models"], parsePiModelTable)
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
  return cachedModelList("omp", ["models", "--json"], parseOmpModelJson)
}
