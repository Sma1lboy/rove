import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  acquireHomeClaim,
  daemonHomeOwnerPath,
  parseHomeOwnerClaim,
} from "../../../kobe-daemon/src/daemon/home-owner.ts"

const absent = async () => "absent" as const

describe("daemon home lease", () => {
  let home: string
  const claims: Array<Awaited<ReturnType<typeof acquireHomeClaim>>> = []
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "rove-owner-"))
    await mkdir(join(home, ".rove"))
  })
  afterEach(async () => {
    await Promise.allSettled(claims.splice(0).map((claim) => claim.release()))
    await rm(home, { recursive: true, force: true })
  })
  const acquire = async (homeDir: string, socketPath: string) => {
    const claim = await acquireHomeClaim({ homeDir, socketPath, probe: absent })
    claims.push(claim)
    return claim
  }

  it("parses exact positive PIDs and socket paths containing colons", () => {
    expect(parseHomeOwnerClaim("42:/run/a:b.sock\n")).toEqual({ pid: 42, socketPath: "/run/a:b.sock" })
    for (const bad of ["", "42junk:/run/a", "1.5:/run/a", ":/run/a", "42:", "-1:/run/a"]) {
      expect(parseHomeOwnerClaim(bad)).toBeNull()
    }
  })

  it("admits only one same-process boot before either socket exists", async () => {
    const results = await Promise.allSettled([acquire(home, "one.sock"), acquire(home, "two.sock")])
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1)
  })

  it("releases once and keeps the lock inode available for the next boot", async () => {
    const claim = await acquire(home, "one.sock")
    await Promise.all([claim.release(), claim.release()])
    await expect(readFile(daemonHomeOwnerPath(home))).rejects.toThrow()
    await expect(readFile(`${daemonHomeOwnerPath(home)}.lock`)).resolves.toBeInstanceOf(Buffer)
    await acquire(home, "two.sock")
  })

  it.each(["alive", "wedged"] as const)("refuses an %s legacy owner even without a SQLite lease", async (state) => {
    await writeFile(daemonHomeOwnerPath(home), "999999999:old.sock\n")
    await expect(acquireHomeClaim({ homeDir: home, socketPath: "new.sock", probe: async () => state })).rejects.toThrow(
      "old.sock",
    )
    await expect(acquire(home, "new.sock")).resolves.toBeDefined()
  })

  it("refuses an old owner with a live PID even if its socket disappeared", async () => {
    await writeFile(daemonHomeOwnerPath(home), `${process.pid}:old.sock\n`)
    await expect(acquire(home, "new.sock")).rejects.toThrow("old.sock")
  })

  it("replaces a dead legacy owner only after checking both socket paths", async () => {
    await writeFile(daemonHomeOwnerPath(home), "999999999:old.sock\n")
    const paths: string[] = []
    const claim = await acquireHomeClaim({
      homeDir: home,
      socketPath: "new.sock",
      probe: async (path) => {
        paths.push(path)
        return "absent"
      },
    })
    claims.push(claim)
    expect(paths).toEqual(["old.sock", "new.sock"])
    expect(await readFile(daemonHomeOwnerPath(home), "utf8")).toContain("new.sock")
  })

  it("releases the SQLite lease when metadata publication fails", async () => {
    await mkdir(daemonHomeOwnerPath(home))
    await expect(acquire(home, "one.sock")).rejects.toThrow()
    await rm(daemonHomeOwnerPath(home), { recursive: true })
    await expect(acquire(home, "two.sock")).resolves.toBeDefined()
  })

  it("does not serialize unrelated homes", async () => {
    await acquire(home, "one.sock")
    await acquire(join(home, "independent"), "two.sock")
  })

  it("does not remove metadata that another owner replaced", async () => {
    const claim = await acquire(home, "one.sock")
    await writeFile(daemonHomeOwnerPath(home), "999999999:replacement.sock\n")
    await claim.release()
    expect(await readFile(daemonHomeOwnerPath(home), "utf8")).toContain("replacement.sock")
    await acquire(home, "next.sock")
  })
})
