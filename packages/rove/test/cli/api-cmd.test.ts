import { describe, expect, it } from "vitest"
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
  it("the compact index lists every verb + summary but NO flags (context economy)", () => {
    const idx = schemaIndex() as { verbs: { name: string; group: string; summary: string; flags?: unknown }[] }
    expect(idx.verbs.map((v) => v.name)).toEqual([...API_VERBS])
    // Crucially, the index does NOT carry per-verb flags — that's the drill-in level.
    expect(idx.verbs.some((v) => "flags" in v)).toBe(false)
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

  it("verb help names the full invocation", () => {
    expect(verbHelp(findVerb("add")!)).toContain("rove api add")
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

  // `parseInt` stops at the first non-digit: without a shape guard `--count 2x`
  // passed as 2 and `--count 1e3` as 1 — a typo becoming a wrong action.
  it.each(["2x", "1e3", "2.5", "0x10", "  ", "-1", "0", "abc"])(
    "rejects int flag value %j instead of coercing it",
    (bad) => {
      const { flags } = parseFlags(["--repo", "/x", "--prompt", "p", "--count", bad])
      expect(() => validateAgainstSpec(add, flags)).toThrow(/must be a positive integer/)
    },
  )
})
