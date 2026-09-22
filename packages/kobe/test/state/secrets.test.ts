/**
 * `state/secrets.ts` — the one file Rove keeps credentials in.
 *
 * What is pinned here is the handling, not the storage: that the environment
 * outranks the file, that an empty env var is "unset" rather than a
 * deliberate blank, that nothing hands a whole secret back for rendering,
 * and that the file is owner-only from the moment it exists. A key written
 * 0644 and chmod'd afterwards is readable for the width of that window,
 * which is the window that matters.
 */

import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

const saved = process.env.ROVE_HOME_DIR
let home: string

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "rove-secrets-"))
  process.env.ROVE_HOME_DIR = home
  // Re-imported per test: `secretsPath()` resolves the home at call time, but
  // a module-level cache anywhere upstream would otherwise leak between them.
  await import("../../src/state/secrets.ts")
})
afterEach(() => {
  if (saved === undefined) delete process.env.ROVE_HOME_DIR
  else process.env.ROVE_HOME_DIR = saved
})

const load = () => import("../../src/state/secrets.ts")
const file = () => join(home, ".rove", "secrets.json")

describe("secrets file", () => {
  it("is absent until something is stored, and absent means no secrets", async () => {
    const { readSecret, secretStatus } = await load()
    expect(existsSync(file())).toBe(false)
    expect(readSecret("TYPESAFE_API_KEY")).toBeUndefined()
    expect(secretStatus("TYPESAFE_API_KEY", {})).toEqual({ source: "none", hint: "" })
  })

  it("round-trips a secret, and holds nothing else", async () => {
    const { writeSecret, readSecret } = await load()
    writeSecret("TYPESAFE_API_KEY", "apikey_abcd1234")
    expect(readSecret("TYPESAFE_API_KEY")).toBe("apikey_abcd1234")
    expect(JSON.parse(readFileSync(file(), "utf8"))).toEqual({ TYPESAFE_API_KEY: "apikey_abcd1234" })
  })

  it.skipIf(process.platform === "win32")("is owner-only the moment it exists", async () => {
    const { writeSecret } = await load()
    writeSecret("TYPESAFE_API_KEY", "apikey_abcd1234")
    expect(statSync(file()).mode & 0o777).toBe(0o600)
  })

  it("goes away entirely when its last secret is cleared", async () => {
    const { writeSecret, readSecret } = await load()
    writeSecret("TYPESAFE_API_KEY", "apikey_abcd1234")
    writeSecret("TYPESAFE_API_KEY", "")
    // Not an empty object left behind: absence keeps meaning "nothing stored".
    expect(existsSync(file())).toBe(false)
    expect(readSecret("TYPESAFE_API_KEY")).toBeUndefined()
  })

  it("keeps other secrets when one is cleared", async () => {
    const { writeSecret, readSecret } = await load()
    writeSecret("A", "one")
    writeSecret("B", "two")
    writeSecret("A", "")
    expect(readSecret("A")).toBeUndefined()
    expect(readSecret("B")).toBe("two")
  })

  it("reads a corrupt file as empty rather than throwing on the create path", async () => {
    const { writeSecret, readSecret } = await load()
    writeSecret("TYPESAFE_API_KEY", "apikey_abcd1234")
    writeFileSync(file(), "{not json")
    // This runs while someone is making a task. The cost of a bad file is one
    // classification that does not happen, never a failed create.
    expect(readSecret("TYPESAFE_API_KEY")).toBeUndefined()
  })
})

describe("resolveSecret / secretStatus", () => {
  it("lets the environment outrank the file", async () => {
    const { writeSecret, resolveSecret, secretStatus } = await load()
    writeSecret("TYPESAFE_API_KEY", "from_file")
    expect(resolveSecret("TYPESAFE_API_KEY", { TYPESAFE_API_KEY: "from_env" })).toBe("from_env")
    // The hint still describes the STORED key, so the row can say which one
    // the environment is shadowing.
    expect(secretStatus("TYPESAFE_API_KEY", { TYPESAFE_API_KEY: "from_env" })).toEqual({
      source: "env",
      hint: "…file",
    })
  })

  it("treats an empty env var as unset, not as a deliberate blank", async () => {
    const { writeSecret, resolveSecret, secretStatus } = await load()
    writeSecret("TYPESAFE_API_KEY", "from_file")
    // `export FOO=` in a shell profile means "I never set this", and reading
    // it as an override would silently disable a key the user had saved.
    expect(resolveSecret("TYPESAFE_API_KEY", { TYPESAFE_API_KEY: "  " })).toBe("from_file")
    expect(secretStatus("TYPESAFE_API_KEY", { TYPESAFE_API_KEY: "" }).source).toBe("file")
  })
})

describe("secretHint", () => {
  it("shows a tail you can recognise and cannot use", async () => {
    const { secretHint } = await load()
    expect(secretHint("apikey_2204602c71b135ae4938")).toBe("…4938")
    expect(secretHint("apikey_2204602c71b135ae4938")).not.toContain("apikey")
  })

  it("gives a short value away no more than a long one", async () => {
    const { secretHint } = await load()
    expect(secretHint("abc")).toBe("…")
  })
})
