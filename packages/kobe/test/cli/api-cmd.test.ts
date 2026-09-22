import { describe, expect, it, vi } from "vitest"
import {
  API_VERBS,
  ApiError,
  buildCountPlan,
  findVerb,
  fullSchema,
  parseAgentsSpec,
  parseFlags,
  schemaIndex,
  validateAgainstSpec,
  verbHelp,
  verbSchema,
} from "../../src/cli/api-cmd.ts"

// `engine-list` attaches each engine's model list, and pi/omp answer that by
// RUNNING their CLI (`model-lists.ts`: `pi --list-models`, `omp models --json`).
// Two real spawns per call, uncached between calls, cost these tests ~1.4s
// each against a 5s timeout — and only on a machine that has pi/omp installed,
// so it read as a flake. Stubbed to the shape the verb consumes; the product
// fix (memoize the per-protocol lookup) is issue #112.
vi.mock("../../src/engine/model-lists.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/engine/model-lists.ts")>()),
  listPiModels: async () => [{ id: "openai/gpt-5.1" }],
  listOmpModels: async () => [{ id: "anthropic/claude-opus-5" }],
}))

function withEnv(name: string, value: string | undefined, fn: () => void): void {
  const before = process.env[name]
  try {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
    fn()
  } finally {
    if (before === undefined) delete process.env[name]
    else process.env[name] = before
  }
}

describe("parseFlags", () => {
  it("parses `--key value` pairs", () => {
    const { flags, pretty } = parseFlags(["--repo", "/x", "--prompt", "hello world"])
    expect(flags.get("repo")).toBe("/x")
    expect(flags.get("prompt")).toBe("hello world")
    expect(pretty).toBe(false)
  })

  it("parses `--key=value` pairs", () => {
    const { flags } = parseFlags(["--task-id=abc", "--title=My Task"])
    expect(flags.get("task-id")).toBe("abc")
    expect(flags.get("title")).toBe("My Task")
  })

  it("treats `--pretty` as a boolean flag", () => {
    expect(parseFlags(["--pretty"]).pretty).toBe(true)
    expect(parseFlags(["--pretty=false"]).pretty).toBe(false)
    expect(parseFlags(["--pretty=0"]).pretty).toBe(false)
    expect(parseFlags(["--pretty=true"]).pretty).toBe(true)
  })

  it("rejects a positional arg with BAD_FLAG", () => {
    try {
      parseFlags(["spawn-task"])
      expect.unreachable("should have thrown")
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError)
      expect((err as ApiError).code).toBe("BAD_FLAG")
    }
  })

  it("rejects a flag missing its value", () => {
    expect(() => parseFlags(["--repo"])).toThrow(/--repo requires a value/)
    // A following flag does not count as the value.
    expect(() => parseFlags(["--repo", "--prompt", "x"])).toThrow(/--repo requires a value/)
  })
})

describe("parseAgentsSpec", () => {
  it("expands engine:count pairs into one entry per task", () => {
    expect(parseAgentsSpec("claude:2,codex:1")).toEqual(["claude", "claude", "codex"])
  })

  it("rejects an unknown engine with the add help recovery step", () => {
    try {
      parseAgentsSpec("bogus:2")
      expect.unreachable("should have thrown")
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError)
      expect((err as ApiError).code).toBe("BAD_FLAG")
      expect((err as ApiError).message).toContain("must be a built-in")
      expect((err as ApiError).data?.nextCommandArgs).toEqual(["api", "add", "--help"])
      expect((err as ApiError).data?.hint).toBeTruthy()
    }
  })

  it("rejects a non-positive or malformed count", () => {
    expect(() => parseAgentsSpec("claude:0")).toThrow(/positive integer/)
    expect(() => parseAgentsSpec("claude")).toThrow(/engine:count/)
    // Trailing garbage must NOT be silently coerced (`parseInt("2x") === 2`).
    expect(() => parseAgentsSpec("claude:2x")).toThrow(/positive integer/)
    expect(() => parseAgentsSpec("claude:1e3")).toThrow(/positive integer/)
    expect(() => parseAgentsSpec("claude:2.5")).toThrow(/positive integer/)
  })

  it("rejects an over-cap count before allocating (no OOM on a huge count)", () => {
    // Guards against `--agents claude:1000000000` building a billion-element
    // array before the post-build cap check rejects it.
    expect(() => parseAgentsSpec("claude:1000000000")).toThrow(/exceeds the cap/)
    expect(() => parseAgentsSpec("claude:6,codex:6")).toThrow(/exceeds the cap/)
  })
})

describe("buildCountPlan", () => {
  it("rejects an over-cap count BEFORE allocating (no OOM on a huge --count)", () => {
    // Mirrors the parseAgentsSpec guard: `--count 1000000000` must fail fast
    // instead of building a billion-element array only to hit the post-build
    // cap check.
    expect(() => buildCountPlan(1_000_000_000, "claude")).toThrow(/exceeds the parallel cap/)
    expect(() => buildCountPlan(11, "claude")).toThrow(/exceeds the parallel cap/)
  })
})

describe("parseFlags boolean presence flags", () => {
  it("parses --help / -h", () => {
    expect(parseFlags(["--help"]).help).toBe(true)
    expect(parseFlags(["-h"]).help).toBe(true)
    expect(parseFlags([]).help).toBe(false)
  })
})

describe("API surface (full CRUD)", () => {
  // The ORDER of API_VERBS is a contract, not an implementation detail: it is
  // the order `rove api schema` and `--help` list verbs in, and an agent reads
  // that listing to discover the API. The neighbouring assertions cannot catch
  // a drift in it — `toContain` only proves nothing was lost, and comparing
  // `schemaIndex()` against `API_VERBS` is self-consistent (both derive from
  // the same array, so they move together). Splitting the registry across
  // `verbs-*.ts` files makes reordering a one-line accident, so the canonical
  // sequence is pinned here verbatim.
  //
  // If you intend to change the order, update this list in the same commit and
  // say so in the changeset — it is a user-visible change, not a refactor.
  it("pins the canonical verb order that schema and help expose", () => {
    expect([...API_VERBS]).toEqual([
      "schema",
      "engine-list",
      "list",
      "get-task",
      "pty-list",
      "collect",
      "context",
      "digest",
      "agent-turns",
      "inspect",
      "read-output",
      "watch",
      "add",
      "send",
      "dispatch",
      "interrupt",
      "note",
      "note-list",
      "note-delete",
      "pane-open",
      "pane-close",
      "pane-graphics",
      "tab-close",
      "notify",
      "prompt",
      "engine-report",
      "row-token",
      "set-active",
      "feedback",
      "issue-list",
      "issue-create",
      "issue-set-status",
      "issue-update",
      "issue-delete",
      "routine-list",
      "routine-create",
      "routine-update",
      "routine-set-enabled",
      "routine-delete",
      "routine-run-now",
      "routine-runs",
      "workitem-list",
      "workitem-start",
      "rename",
      "set-branch",
      "set-command",
      "set-effort",
      "set-model",
      "set-status",
      "pin",
      "land",
      "delete",
      "ensure-worktree",
      "remove-worktree",
      "discover-adoptable",
      "adopt",
    ])
  })

  it("the compact index lists every verb + summary but NO flags (context economy)", () => {
    const idx = schemaIndex() as { verbs: { name: string; group: string; summary: string; flags?: unknown }[] }
    expect(idx.verbs.map((v) => v.name)).toEqual([...API_VERBS])
    // Crucially, the index does NOT carry per-verb flags — that's the drill-in level.
    for (const v of idx.verbs) expect(v.flags).toBeUndefined()
    expect(idx.verbs.find((v) => v.name === "add")?.group).toBe("create")
  })

  it("drill-in (verbSchema) carries one verb's full flag detail", () => {
    const add = findVerb("add")!
    const detail = verbSchema(add) as { name: string; flags: { name: string; type: string }[] }
    expect(detail.name).toBe("add")
    expect(detail.flags.find((f) => f.name === "repo")).toMatchObject({ required: true, type: "string" })
    expect(detail.flags.find((f) => f.name === "status")).toMatchObject({ type: "enum" })
  })

  it("--all (fullSchema) covers every verb WITH flags", () => {
    const full = fullSchema() as { verbs: { name: string; flags: unknown[] }[] }
    expect(full.verbs.map((v) => v.name)).toEqual([...API_VERBS])
    expect(full.verbs.every((v) => Array.isArray(v.flags))).toBe(true)
  })

  it("uses the active CLI name (rove) when invoked through the rove wrapper", () => {
    withEnv("ROVE_INVOKED_AS", "rove", () => {
      const help = verbHelp(findVerb("add")!)
      expect(help).toContain("rove api add")
      expect(help).not.toContain("kobe api add")
    })
  })
})

describe("validateAgainstSpec", () => {
  const add = findVerb("add")!

  it("rejects an unknown flag with BAD_FLAG", () => {
    const { flags } = parseFlags(["--repo", "/x", "--bogus", "1"])
    expect(() => validateAgainstSpec(add, flags)).toThrow(/unknown flag --bogus/)
  })

  it("rejects a missing required flag with MISSING_FLAG + the verb's help recovery step", () => {
    const { flags } = parseFlags(["--title", "t"])
    try {
      validateAgainstSpec(add, flags)
      expect.unreachable("should have thrown")
    } catch (err) {
      expect((err as ApiError).code).toBe("MISSING_FLAG")
      expect((err as ApiError).data?.nextCommandArgs).toEqual(["api", "add", "--help"])
    }
  })

  it("rejects an int flag with trailing garbage instead of coercing it", () => {
    // `parseInt` stops at the first non-digit: without a shape guard `--count 2x`
    // passed as 2 and `--count 1e3` as 1 — a typo becoming a wrong action.
    for (const bad of ["2x", "1e3", "2.5", "0x10", "  ", "-1", "0", "abc"]) {
      const { flags } = parseFlags(["--repo", "/x", "--prompt", "p", "--count", bad])
      expect(() => validateAgainstSpec(add, flags)).toThrow(/must be a positive integer/)
    }
  })
})
