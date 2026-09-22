/** Flag parsing, spec-driven validation, and the spec-typed `VerbArgs` accessor. */

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { registeredEngineIds } from "../../engine/plugin-engines.ts"
import { expandTilde } from "../../lib/path-home.ts"
import { isRemoteRepoKey } from "../../state/repos.ts"
import { ALL_VENDORS, type VendorId } from "../../types/vendor.ts"
import { ApiError, type FlagSpec, type Flags, type ParsedArgs, type VerbSpec, helpStep } from "./types.ts"

/** Safety cap on a single `add --count` round so a typo can't spawn a runaway fleet. */
export const FANOUT_CAP = 10

/**
 * Strict positive integer, else `undefined`. Bare `parseInt` would turn
 * `--id 5abc` into 5 (a real, wrong issue) and `--count 1e3` into 1 (dodging
 * the fan-out cap), so the whole trimmed value must be digits.
 */
function parsePositiveInt(raw: string): number | undefined {
  if (!/^\d+$/.test(raw.trim())) return undefined
  const n = Number.parseInt(raw, 10)
  return Number.isSafeInteger(n) && n > 0 ? n : undefined
}

/** {@link parsePositiveInt} admitting zero; the regex already rejects `-`. */
function parseNonNegativeInt(raw: string): number | undefined {
  if (!/^\d+$/.test(raw.trim())) return undefined
  const n = Number.parseInt(raw, 10)
  return Number.isSafeInteger(n) && n >= 0 ? n : undefined
}

/**
 * Shared by the parser (is `--pinned false` a value?) and {@link VerbArgs.bool}
 * so the two can never disagree about what counts as a boolean.
 */
function parseBoolLiteral(raw: string): boolean | undefined {
  if (["true", "1", "yes"].includes(raw)) return true
  if (["false", "0", "no"].includes(raw)) return false
  return undefined
}

/** Both parallel-plan parsers are only reachable from `add`, so their errors point at its help. */
const FANOUT_STEP = helpStep("add")

/** Reusable flag fragments shared across the verb tables (`verbs.ts`, `verbs-issues.ts`). */
export const F = {
  repo: (required = true): FlagSpec => ({
    name: "repo",
    type: "string",
    required,
    placeholder: "PATH",
    description: "Repo root (git toplevel). Relative paths resolve against $PWD.",
  }),
  taskId: (required = true): FlagSpec => ({
    name: "task-id",
    type: "string",
    required,
    placeholder: "ID",
    description: "Target task id (from `list` / `add`).",
  }),
  vendor: (): FlagSpec => ({
    name: "vendor",
    type: "enum",
    values: ALL_VENDORS,
    placeholder: "V",
    description: "Engine vendor for the task.",
  }),
  /**
   * A registered engine id (its `engineCommand.<id>` override applies) or a
   * full command line run verbatim. The protocol is derived from it; flags
   * are deliberately unvalidated.
   */
  command: (): FlagSpec => ({
    name: "command",
    type: "string",
    placeholder: "CMD",
    description:
      "Engine launch command, verbatim — an engine id from `engine-list` (e.g. claude) or a full command line (e.g. 'codex --search'). Unvalidated: probe an unfamiliar engine's flags with `<cmd> --help` first. Omitted = the repo's default engine.",
  }),
  title: (): FlagSpec => ({ name: "title", type: "string", placeholder: "T", description: "Human task title." }),
  prompt: (required: boolean, desc: string): FlagSpec => ({
    name: "prompt",
    type: "string",
    required,
    placeholder: "TEXT",
    description: required ? `${desc} Required unless --prompt-file is given.` : desc,
  }),
  /** Backticks in a double-quoted `--prompt` RUN as command substitution; a file/stdin avoids shell quoting. */
  promptFile: (): FlagSpec => ({
    name: "prompt-file",
    type: "string",
    placeholder: "PATH",
    description:
      "Read the prompt from this file instead of --prompt (`-` = stdin). Use it whenever the text has backticks, $vars, or quotes you don't want the shell to touch. Exactly one of --prompt / --prompt-file.",
  }),
}

/**
 * Parse argv into a flag map + `--pretty` / `--help` booleans. Accepts both
 * `--key=value` and `--key value`. `booleanFlags` (from the verb spec) may be
 * given as standalone presence flags (`--force` ⇒ "true"); without it, only
 * `--pretty` / `--help` are standalone. Unknown forms throw BAD_FLAG.
 */
export function parseFlags(argv: readonly string[], booleanFlags: ReadonlySet<string> = new Set()): ParsedArgs {
  const flags = new Map<string, string>()
  let pretty = false
  let help = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith("--") && arg !== "-h") {
      throw new ApiError(`unexpected positional arg: ${arg}`, "BAD_FLAG")
    }
    if (arg === "-h") {
      help = true
      continue
    }
    const eq = arg.indexOf("=")
    if (eq !== -1) {
      const key = arg.slice(2, eq)
      const value = arg.slice(eq + 1)
      if (key === "pretty") pretty = value !== "false" && value !== "0"
      else if (key === "help") help = value !== "false" && value !== "0"
      else flags.set(key, value)
      continue
    }
    const key = arg.slice(2)
    if (key === "pretty") {
      pretty = true
      continue
    }
    if (key === "help") {
      help = true
      continue
    }
    // A boolean verb flag consumes the next arg only if it IS a boolean
    // literal (`--pinned false`); otherwise it's a presence flag (`--force`).
    if (booleanFlags.has(key)) {
      const next = argv[i + 1]
      if (next !== undefined && parseBoolLiteral(next) !== undefined) {
        flags.set(key, next)
        i += 1
      } else {
        flags.set(key, "true")
      }
      continue
    }
    const next = argv[i + 1]
    if (next === undefined || next.startsWith("--")) {
      throw new ApiError(`flag --${key} requires a value`, "BAD_FLAG")
    }
    flags.set(key, next)
    i += 1
  }
  return { flags, pretty, help }
}

/** Reject flags not declared on the verb spec, and required flags that are missing. */
export function validateAgainstSpec(verb: VerbSpec, flags: Flags): void {
  const known = new Set(verb.flags.map((f) => f.name))
  for (const key of flags.keys()) {
    if (!known.has(key)) {
      throw new ApiError(`unknown flag --${key} for "${verb.name}"`, "BAD_FLAG", helpStep(verb.name))
    }
  }
  for (const f of verb.flags) {
    // --prompt-file stands in for a required --prompt; `promptText` rejects both at once.
    const satisfied = flags.get(f.name) || (f.name === "prompt" && flags.get("prompt-file"))
    if (f.required && !satisfied)
      throw new ApiError(`--${f.name} is required for "${verb.name}"`, "MISSING_FLAG", helpStep(verb.name))
    if (f.type === "enum" && f.values) {
      const raw = flags.get(f.name)
      if (raw !== undefined && !f.values.includes(raw)) {
        // `--vendor` is the one OPEN enum: `values` lists built-ins for `--help`,
        // but any registered engine id (custom preset, plugin) is valid too.
        if (f.name === "vendor" && registeredEngineIds().includes(raw)) continue
        throw new ApiError(`--${f.name} must be one of ${f.values.join(", ")}`, "BAD_FLAG", helpStep(verb.name))
      }
    }
    if (f.type === "int") {
      const raw = flags.get(f.name)
      if (raw !== undefined && parsePositiveInt(raw) === undefined)
        throw new ApiError(`--${f.name} must be a positive integer`, "BAD_FLAG")
    }
    if (f.type === "uint") {
      const raw = flags.get(f.name)
      if (raw !== undefined && parseNonNegativeInt(raw) === undefined)
        throw new ApiError(`--${f.name} must be a non-negative integer`, "BAD_FLAG")
    }
  }
}

/**
 * Built once per invocation after {@link validateAgainstSpec}; coercion comes
 * from the verb's {@link FlagSpec}. Reading an undeclared flag throws.
 */
export class VerbArgs {
  constructor(
    private readonly verb: VerbSpec,
    private readonly flags: Flags,
  ) {}

  private spec(name: string): FlagSpec {
    const f = this.verb.flags.find((s) => s.name === name)
    if (!f) throw new Error(`internal: --${name} is not declared on verb "${this.verb.name}"`)
    return f
  }

  /** Optional string value; an empty string counts as absent. */
  str(name: string): string | undefined {
    this.spec(name)
    const v = this.flags.get(name)
    return v && v.length > 0 ? v : undefined
  }

  /**
   * Present at all, even as `--flag ''` (which {@link str} folds to absent).
   * Lets clear-by-empty flags (`routine-update --precheck`) tell "clear" from
   * "leave alone".
   */
  present(name: string): boolean {
    this.spec(name)
    return this.flags.get(name) !== undefined
  }

  /**
   * `--prompt` or `--prompt-file` (`-` = stdin), never both; `undefined` when
   * neither. Memoized because `-` drains stdin: a second call would read EOF.
   */
  promptText(): string | undefined {
    if (this.promptMemo !== undefined) return this.promptMemo.value
    const value = this.readPromptText()
    this.promptMemo = { value }
    return value
  }

  private promptMemo: { value: string | undefined } | undefined

  private readPromptText(): string | undefined {
    const inline = this.str("prompt")
    const file = this.str("prompt-file")
    if (inline !== undefined && file !== undefined) {
      throw new ApiError("pass --prompt or --prompt-file, not both", "BAD_FLAG", helpStep(this.verb.name))
    }
    if (file === undefined) return inline
    const text = readFileSync(file === "-" ? 0 : resolve(process.cwd(), expandTilde(file)), "utf8")
    if (text.trim().length === 0) throw new ApiError(`--prompt-file ${file} is empty`, "BAD_FLAG")
    return text
  }

  /** Required string value (MISSING_FLAG when absent). */
  require(name: string): string {
    const v = this.str(name)
    if (v === undefined) throw new ApiError(`--${name} is required`, "MISSING_FLAG")
    return v
  }

  /** Enum value, validated against the SPEC's declared `values`. */
  enumOf<T extends string>(name: string): T | undefined {
    const f = this.spec(name)
    const v = this.str(name)
    if (v === undefined) return undefined
    if (f.values && !f.values.includes(v)) {
      throw new ApiError(`--${name} must be one of ${f.values.join(", ")}`, "BAD_FLAG", helpStep(this.verb.name))
    }
    return v as T
  }

  /** Required enum value. */
  requireEnum<T extends string>(name: string): T {
    this.require(name)
    return this.enumOf<T>(name) as T
  }

  /**
   * NOT `enumOf`: engines are an OPEN set. `values` lists built-ins for
   * `--help`; a registered custom engine id is equally valid, matching the
   * daemon's `optionalVendor`.
   */
  vendor(): VendorId | undefined {
    const value = this.str("vendor")
    if (value === undefined) return undefined
    const builtins = this.spec("vendor").values ?? ALL_VENDORS
    if (builtins.includes(value)) return value as VendorId
    // Registry read is lazy — only a non-built-in id pays for the state read.
    if (registeredEngineIds().includes(value)) return value as VendorId
    throw new ApiError(
      `--vendor must be a built-in (${builtins.join(", ")}) or a registered engine id — see \`engine-list\``,
      "BAD_FLAG",
      helpStep(this.verb.name),
    )
  }

  /** Boolean flag (`true/1/yes` / `false/0/no`); undefined when absent. */
  bool(name: string): boolean | undefined {
    this.spec(name)
    const raw = this.str(name)
    if (raw === undefined) return undefined
    const value = parseBoolLiteral(raw)
    if (value === undefined) throw new ApiError(`--${name} must be a boolean (true/false)`, "BAD_FLAG")
    return value
  }

  /** Positive-integer flag; undefined when absent. */
  int(name: string): number | undefined {
    this.spec(name)
    const raw = this.str(name)
    if (raw === undefined) return undefined
    const n = parsePositiveInt(raw)
    if (n === undefined) throw new ApiError(`--${name} must be a positive integer`, "BAD_FLAG")
    return n
  }

  /** `uint`: {@link int} admitting zero, for flags where 0 means something (`--grace 0` = no slack). */
  nonNegativeInt(name: string): number | undefined {
    this.spec(name)
    const raw = this.str(name)
    if (raw === undefined) return undefined
    const n = parseNonNegativeInt(raw)
    if (n === undefined) throw new ApiError(`--${name} must be a non-negative integer`, "BAD_FLAG")
    return n
  }

  /** Optional PATH flag resolved against $PWD (with a leading `~` expanded first). */
  path(name: string): string | undefined {
    const v = this.str(name)
    return v === undefined ? undefined : resolve(process.cwd(), expandTilde(v))
  }

  /** Required PATH flag resolved against $PWD (with a leading `~` expanded first). */
  requirePath(name: string): string {
    return resolve(process.cwd(), expandTilde(this.require(name)))
  }

  /**
   * Local path, or a remote `ssh://…` key verbatim — {@link requirePath}'s
   * `resolve()` would mangle the key into `$PWD/ssh:/me@host`.
   */
  requireRepo(name: string): string {
    const raw = this.require(name)
    return isRemoteRepoKey(raw) ? raw : resolve(process.cwd(), expandTilde(raw))
  }
}

/**
 * `claude:2,codex:1` → one PRESET ID per task (`[claude, claude, codex]`).
 * Preset ids (incl. registered custom ones), not raw commands: a command line
 * would collide with the `,`/`:` separators.
 */
export function parseAgentsSpec(spec: string): VendorId[] {
  const out: VendorId[] = []
  for (const part of spec.split(",")) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const colon = trimmed.indexOf(":")
    if (colon === -1) throw new ApiError(`--agents entry "${trimmed}" must be engine:count`, "BAD_FLAG", FANOUT_STEP)
    const vendor = trimmed.slice(0, colon)
    if (!ALL_VENDORS.includes(vendor as VendorId) && !registeredEngineIds().includes(vendor)) {
      throw new ApiError(
        `--agents engine "${vendor}" must be a built-in (${ALL_VENDORS.join(", ")}) or a registered engine id — see \`engine-list\``,
        "BAD_FLAG",
        FANOUT_STEP,
      )
    }
    const count = parsePositiveInt(trimmed.slice(colon + 1))
    if (count === undefined) {
      throw new ApiError(`--agents count for "${vendor}" must be a positive integer`, "BAD_FLAG", FANOUT_STEP)
    }
    // Cap check BEFORE materializing: `claude:1000000000` would OOM first.
    if (out.length + count > FANOUT_CAP) {
      throw new ApiError(
        `--agents requests ${out.length + count} agents, exceeds the cap of ${FANOUT_CAP}`,
        "BAD_FLAG",
        FANOUT_STEP,
      )
    }
    for (let i = 0; i < count; i++) out.push(vendor as VendorId)
  }
  if (out.length === 0)
    throw new ApiError('--agents specified no agents (e.g. "claude:2,codex:1")', "BAD_FLAG", FANOUT_STEP)
  return out
}

/** N copies of `vendor`; cap checked BEFORE allocating so a huge `--count` can't OOM. */
export function buildCountPlan(count: number, vendor: VendorId): VendorId[] {
  if (count > FANOUT_CAP) {
    throw new ApiError(
      `--count ${count} exceeds the parallel cap of ${FANOUT_CAP} — spawn in batches`,
      "BAD_FLAG",
      FANOUT_STEP,
    )
  }
  return new Array<VendorId>(count).fill(vendor)
}
