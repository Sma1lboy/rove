/**
 * Unit tests for CLI `~` expansion.
 *
 * The CLI's path arguments (`kobe add ~/repo`, `kobe api --repo ~/repo`,
 * `kobe repo set --init-script-file ~/s.sh`, …) reach us verbatim when the
 * `~` is quoted or forwarded from another tool. `expandTilde` turns a
 * leading `~` / `~/` into the (KOBE_HOME_DIR-aware) home directory so the
 * later `resolve(cwd, …)` can't produce a bogus `<cwd>/~/repo` path.
 */

import path from "node:path"
import { resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { expandTilde } from "../../src/lib/path-home.ts"

let prevHome: string | undefined
const HOME = path.join(path.sep, "tmp", "kobe-home-fixture")

beforeEach(() => {
  prevHome = process.env.KOBE_HOME_DIR
  process.env.KOBE_HOME_DIR = HOME
})

afterEach(() => {
  if (prevHome === undefined) Reflect.deleteProperty(process.env, "KOBE_HOME_DIR")
  else process.env.KOBE_HOME_DIR = prevHome
})

describe("expandTilde", () => {
  test("expands a bare `~` to the home directory", () => {
    expect(expandTilde("~")).toBe(HOME)
  })

  test("does not expand `~user` (no username lookup)", () => {
    expect(expandTilde("~user/repo")).toBe("~user/repo")
    expect(expandTilde("~-foo")).toBe("~-foo")
  })

  test("the regression: resolving a quoted `~/repo` no longer yields `<cwd>/~/repo`", () => {
    const cwd = "/some/cwd"
    // Before the fix, `resolve(cwd, "~/repo")` produced `/some/cwd/~/repo`.
    expect(resolve(cwd, expandTilde("~/repo"))).toBe(path.join(HOME, "repo"))
    expect(resolve(cwd, expandTilde("~/repo"))).not.toContain("~")
  })
})
