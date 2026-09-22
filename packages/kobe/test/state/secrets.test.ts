/**
 * `~/.rove/secrets.json` (`src/state/secrets.ts`).
 *
 * The interesting cases are all about what must NOT happen: a key must not
 * reach a caller that only asked whether one exists, a concurrent writer must
 * not erase one, a crash must not leave one lying in a file nobody reads, and
 * an environment variable must not be quietly outranked by a stored value.
 *
 * `KOBE_HOME_DIR` points at a per-test tmpdir throughout, so the operator's
 * real `~/.rove/secrets.json` is never read or written.
 */

import { spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { readSecret, resolveSecret, secretHint, secretStatus, writeSecret } from "../../src/state/secrets.ts"

let tmpHome: string
let originalHome: string | undefined

function secretsPath(): string {
  return path.join(tmpHome, ".rove", "secrets.json")
}

const readDisk = (): Record<string, string> => JSON.parse(fs.readFileSync(secretsPath(), "utf8"))
const siblings = () => fs.readdirSync(path.dirname(secretsPath())).sort()

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "rove-secrets-"))
  originalHome = process.env.KOBE_HOME_DIR
  process.env.KOBE_HOME_DIR = tmpHome
})

afterEach(() => {
  // biome-ignore lint/performance/noDelete: env cleanup must fully unset when the var was unset before the test (assigning undefined leaves it as the string "undefined"). Same pattern as test/state/store.test.ts.
  if (originalHome === undefined) delete process.env.KOBE_HOME_DIR
  else process.env.KOBE_HOME_DIR = originalHome
  fs.rmSync(tmpHome, { recursive: true, force: true })
})

describe("writeSecret / readSecret", () => {
  it("stores a key and reads it back", () => {
    writeSecret("TYPESAFE_API_KEY", "sk-live-abcd")
    expect(readSecret("TYPESAFE_API_KEY")).toBe("sk-live-abcd")
    expect(readDisk()).toEqual({ TYPESAFE_API_KEY: "sk-live-abcd" })
  })

  it("writes the file owner-only, and never lands a world-readable version of it", () => {
    // Mode on the staging file, not a chmod after the rename: between a 0644
    // create and a later chmod there is a window where the key is readable by
    // anyone on the box. (POSIX only — on Windows the ACL decides, which is
    // why the docs do not promise 0600 there.)
    writeSecret("TYPESAFE_API_KEY", "sk-live-abcd")
    if (process.platform !== "win32") {
      expect(fs.statSync(secretsPath()).mode & 0o777).toBe(0o600)
    }
  })

  it("removes the FILE when the last key is cleared, not just the key", () => {
    // Absence is the signal callers read as "no secrets stored"; an empty
    // object left behind would make that question need a parse.
    writeSecret("A", "one")
    writeSecret("A", "")
    expect(fs.existsSync(secretsPath())).toBe(false)
    expect(readSecret("A")).toBeUndefined()
  })

  it("clearing a key nobody stored does not create the file it would remove", () => {
    writeSecret("A", "")
    expect(fs.existsSync(secretsPath())).toBe(false)
  })

  it("keeps the other keys when one is cleared", () => {
    writeSecret("A", "one")
    writeSecret("B", "two")
    writeSecret("A", "")
    expect(readDisk()).toEqual({ B: "two" })
  })

  it("treats a corrupt file as empty rather than throwing on a task-create path", () => {
    fs.mkdirSync(path.dirname(secretsPath()), { recursive: true })
    fs.writeFileSync(secretsPath(), "{not json", "utf8")
    expect(readSecret("A")).toBeUndefined()
    writeSecret("A", "one")
    expect(readDisk()).toEqual({ A: "one" })
  })

  it("sets a corrupt file ASIDE before writing, so the keys still in it survive", () => {
    // A hand edit that lost a comma still holds every key someone put there.
    // Storing one more must not cost them the rest.
    fs.mkdirSync(path.dirname(secretsPath()), { recursive: true })
    const broken = '{"B": "two", "C": "three",}'
    fs.writeFileSync(secretsPath(), broken, "utf8")
    writeSecret("A", "one")
    expect(readDisk()).toEqual({ A: "one" })
    const backups = siblings().filter((f) => f.startsWith("secrets.json.corrupt-"))
    expect(backups).toHaveLength(1)
    expect(fs.readFileSync(path.join(path.dirname(secretsPath()), backups[0] ?? ""), "utf8")).toBe(broken)
  })

  it("clearing a key in a corrupt file backs it up instead of deleting it", () => {
    fs.mkdirSync(path.dirname(secretsPath()), { recursive: true })
    fs.writeFileSync(secretsPath(), "{not json", "utf8")
    writeSecret("A", "")
    expect(fs.existsSync(secretsPath())).toBe(false)
    expect(siblings().filter((f) => f.startsWith("secrets.json.corrupt-"))).toHaveLength(1)
  })

  it("carries entries it does not read through a write untouched", () => {
    // Readers only see strings; the writer must not narrow the FILE to what
    // readers see, or a hand-added entry of another type vanishes on save.
    fs.mkdirSync(path.dirname(secretsPath()), { recursive: true })
    fs.writeFileSync(secretsPath(), JSON.stringify({ note: { from: "me" } }), "utf8")
    writeSecret("A", "one")
    expect(JSON.parse(fs.readFileSync(secretsPath(), "utf8"))).toEqual({ note: { from: "me" }, A: "one" })
  })

  it("does not lose a key written by another process between our read and our write", () => {
    // The lost update this takes the index lockfile for. Simulated at the one
    // point a second writer could interleave: the transaction re-reads under
    // the lock, so a key written after our caller last looked is still there
    // when ours lands.
    writeSecret("FIRST", "one")
    // Another process stores a different key.
    fs.writeFileSync(secretsPath(), JSON.stringify({ FIRST: "one", SECOND: "two" }), "utf8")
    writeSecret("THIRD", "three")
    expect(readDisk()).toEqual({ FIRST: "one", SECOND: "two", THIRD: "three" })
  })
})

describe("concurrent writers", () => {
  it("keeps EVERY key when separate processes store different ones at once", async () => {
    // The lost update the index lockfile is taken for, driven for real rather
    // than simulated: without mutual exclusion each process reads the same
    // file, adds its own key to its own copy, and the last rename wins — the
    // others vanish with nothing raised anywhere. This machine runs dozens of
    // sessions at once, so "two at the same moment" is the normal case.
    //
    // Every child is SPAWNED before any is awaited, and they all spin until a
    // shared wall-clock instant: a synchronous `execFileSync` in a loop runs
    // them one after another, which is exactly the shape that passes whether
    // or not the lock exists.
    const here = path.dirname(fileURLToPath(import.meta.url))
    const module = path.join(here, "..", "..", "src", "state", "secrets.ts")
    const writers = ["ALPHA", "BRAVO", "CHARLIE", "DELTA", "ECHO", "FOXTROT", "GOLF", "HOTEL"]
    const startAt = String(Date.now() + 1500)
    const children = writers.map((name) =>
      spawn(
        process.execPath,
        [
          "-e",
          [
            `const { writeSecret } = await import(${JSON.stringify(module)});`,
            "const at = Number(process.env.START_AT); while (Date.now() < at) {}",
            `writeSecret(${JSON.stringify(name)}, ${JSON.stringify(`key-for-${name}`)});`,
          ].join(""),
        ],
        { env: { ...process.env, KOBE_HOME_DIR: tmpHome, START_AT: startAt }, stdio: ["ignore", "pipe", "pipe"] },
      ),
    )
    const codes = await Promise.all(
      children.map(
        (child) =>
          new Promise<number>((resolve, reject) => {
            let stderr = ""
            child.stderr?.on("data", (chunk) => {
              stderr += String(chunk)
            })
            child.on("error", reject)
            child.on("close", (code) => (code === 0 ? resolve(0) : reject(new Error(`exit ${code}: ${stderr}`))))
          }),
      ),
    )
    expect(codes).toEqual(writers.map(() => 0))
    expect(readDisk()).toEqual(Object.fromEntries(writers.map((n) => [n, `key-for-${n}`])))
  }, 60_000)
})

describe("staging files", () => {
  it("sweeps a staging file a crashed writer left holding a key", () => {
    // A crash between write and rename leaves the key verbatim in a file that
    // is 0600, permanent, and invisible: nothing reads `*.tmp`, so it never
    // shows in the UI and never expires. The next write clears it.
    fs.mkdirSync(path.dirname(secretsPath()), { recursive: true })
    const orphan = `${secretsPath()}.9999.abandoned.tmp`
    fs.writeFileSync(orphan, JSON.stringify({ TYPESAFE_API_KEY: "sk-leaked" }), { mode: 0o600 })
    expect(fs.existsSync(orphan)).toBe(true)

    writeSecret("TYPESAFE_API_KEY", "sk-fresh")
    expect(fs.existsSync(orphan)).toBe(false)
    expect(siblings()).toEqual(["secrets.json"])
  })

  it("leaves unrelated files in the state dir alone", () => {
    fs.mkdirSync(path.dirname(secretsPath()), { recursive: true })
    const other = path.join(path.dirname(secretsPath()), "tasks.json")
    fs.writeFileSync(other, "{}", "utf8")
    writeSecret("A", "one")
    expect(fs.existsSync(other)).toBe(true)
  })

  it("leaves no staging file behind on a successful write", () => {
    writeSecret("A", "one")
    expect(siblings().filter((n) => n.endsWith(".tmp"))).toEqual([])
  })
})

describe("resolveSecret", () => {
  it("lets the environment outrank a stored key", () => {
    writeSecret("K", "stored")
    expect(resolveSecret("K", { K: "from-env" })).toBe("from-env")
    expect(resolveSecret("K", {})).toBe("stored")
  })

  it("reads an EMPTY environment value as unset, not as a deliberate blank", () => {
    // `export FOO=` in a shell profile means "I did not set this", and
    // reading it the other way would silently disable a key the user saved.
    writeSecret("K", "stored")
    expect(resolveSecret("K", { K: "" })).toBe("stored")
    expect(resolveSecret("K", { K: "   " })).toBe("stored")
  })
})

describe("secretStatus and secretHint", () => {
  it("reports where the key came from without ever returning it", () => {
    expect(secretStatus("K", {})).toEqual({ source: "none", hint: "" })
    writeSecret("K", "sk-live-wxyz")
    expect(secretStatus("K", {})).toEqual({ source: "file", hint: "…wxyz" })
    // Still the STORED hint, because that is what "did I paste the right one"
    // is asking about — but the source says the environment is what will be sent.
    expect(secretStatus("K", { K: "other" })).toEqual({ source: "env", hint: "…wxyz" })
  })

  it("never yields enough of a key to use", () => {
    expect(secretHint("sk-live-abcdefgh")).toBe("…efgh")
    // A short value would otherwise be shown whole.
    expect(secretHint("abcd")).toBe("…")
    expect(secretHint("ab")).toBe("…")
  })
})
