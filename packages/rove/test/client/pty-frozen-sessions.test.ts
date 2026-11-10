import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { hasFrozenPtySessions } from "../../../rove-daemon/src/client/pty-process.ts"
import { defaultPtyFreezeDir } from "../../../rove-daemon/src/daemon/paths.ts"
import { FREEZE_TTL_MS } from "../../../rove-daemon/src/daemon/pty-freeze-store.ts"

let home: string
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "rove-frozen-"))
})
afterEach(() => rmSync(home, { recursive: true, force: true }))

describe("hasFrozenPtySessions", () => {
  it("is false with no freeze directory, true for a fresh record, false once the record outlived its TTL", async () => {
    expect(await hasFrozenPtySessions(home)).toBe(false)

    const dir = defaultPtyFreezeDir(home)
    mkdirSync(dir, { recursive: true })
    const record = join(dir, "task__tab-2.json")
    writeFileSync(record, "{}")
    expect(await hasFrozenPtySessions(home)).toBe(true)

    const old = new Date(Date.now() - FREEZE_TTL_MS - 60_000)
    utimesSync(record, old, old)
    expect(await hasFrozenPtySessions(home)).toBe(false)
  })
})
