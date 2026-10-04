import { copyFileSync, existsSync, mkdirSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { bobQuery } from "../../src/engine/bob-local/db.ts"
import { bobDbPath } from "../../src/engine/vendor-home.ts"

function fixture() {
  const home = mkdtempSync(join(tmpdir(), "bob-wal-"))
  mkdirSync(join(home, ".bob", "db"), { recursive: true })
  const { DatabaseSync } = process.getBuiltinModule("node:sqlite")
  const writer = new DatabaseSync(bobDbPath(home))
  writer.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE entries (value TEXT)")
  writer.exec("INSERT INTO entries VALUES ('committed')")
  return { home, writer }
}

describe("Bob read-only WAL access", () => {
  it("reads committed rows during a write transaction and sees the next commit", async () => {
    const { home, writer } = fixture()
    try {
      writer.exec("BEGIN IMMEDIATE; INSERT INTO entries VALUES ('pending')")
      expect(await bobQuery("SELECT value FROM entries ORDER BY rowid", [], home)).toEqual([{ value: "committed" }])
      writer.exec("COMMIT")
      expect(await bobQuery("SELECT value FROM entries ORDER BY rowid", [], home)).toEqual([
        { value: "committed" },
        { value: "pending" },
      ])
    } finally {
      writer.close()
    }
  })

  it("reads a WAL database with no shared-memory file in a writable directory", async () => {
    const { home, writer } = fixture()
    const copyHome = mkdtempSync(join(tmpdir(), "bob-wal-copy-"))
    mkdirSync(join(copyHome, ".bob", "db"), { recursive: true })
    const copyPath = bobDbPath(copyHome)
    try {
      copyFileSync(bobDbPath(home), copyPath)
      copyFileSync(`${bobDbPath(home)}-wal`, `${copyPath}-wal`)
      expect(existsSync(`${copyPath}-shm`)).toBe(false)
      expect(await bobQuery("SELECT value FROM entries", [], copyHome)).toEqual([{ value: "committed" }])
    } finally {
      writer.close()
    }
  })
})
