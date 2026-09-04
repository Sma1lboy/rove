import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  assertHomeUnclaimed,
  claimHome,
  daemonHomeOwnerPath,
  parseHomeOwnerClaim,
  releaseHomeClaim,
} from "../../../kobe-daemon/src/daemon/home-owner.ts"

/**
 * The home claim exists because the daemon singleton is keyed on the SOCKET
 * path, not the home: override `ROVE_DAEMON_SOCKET_PATH` while leaving
 * `ROVE_HOME_DIR` alone — which this repo's own isolation recipes do — and two
 * daemons serve one state root, each invisible to the other, both writing
 * `tasks.json`, `automations.json` and `state.json`.
 */
describe("daemon home ownership claim", () => {
  let home: string
  const OURS = "/run/ours.sock"
  const THEIRS = "/run/theirs.sock"
  const alive = async (): Promise<boolean> => true
  const dead = async (): Promise<boolean> => false

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "kobe-home-owner-"))
    await mkdir(join(home, ".rove"), { recursive: true })
  })

  afterEach(async () => {
    await rm(home, { recursive: true, force: true })
  })

  it("splits a claim on the first colon only, so socket paths may contain more", () => {
    expect(parseHomeOwnerClaim("42:/run/a:b.sock\n")).toEqual({ pid: 42, socketPath: "/run/a:b.sock" })
    for (const bad of ["", "nonsense", ":/run/a.sock", "42:", "-1:/run/a.sock"]) {
      expect(parseHomeOwnerClaim(bad)).toBeNull()
    }
  })

  it("refuses a second daemon and names the incumbent's socket", async () => {
    await writeFile(daemonHomeOwnerPath(home), `4321:${THEIRS}\n`, "utf8")
    await expect(assertHomeUnclaimed({ homeDir: home, socketPath: OURS, probe: alive })).rejects.toThrow(THEIRS)
  })

  it("lets a boot through when nothing answers on the claimed socket", async () => {
    // A crashed daemon leaves its claim behind. Liveness is decided by asking
    // the recorded SOCKET, not by trusting the pid — pids get reused — so a
    // stale claim needs no sweeping, it is simply overwritten.
    await writeFile(daemonHomeOwnerPath(home), `4321:${THEIRS}\n`, "utf8")
    await expect(assertHomeUnclaimed({ homeDir: home, socketPath: OURS, probe: dead })).resolves.toBeUndefined()
  })

  it("ignores a claim naming our own socket, and an absent one", async () => {
    // Our own path is already defended by the boot probe in server.ts; a claim
    // naming it is our own crashed predecessor, not a peer.
    await writeFile(daemonHomeOwnerPath(home), `4321:${OURS}\n`, "utf8")
    await expect(assertHomeUnclaimed({ homeDir: home, socketPath: OURS, probe: alive })).resolves.toBeUndefined()
    await rm(daemonHomeOwnerPath(home))
    await expect(assertHomeUnclaimed({ homeDir: home, socketPath: OURS, probe: alive })).resolves.toBeUndefined()
  })

  it("drops its own claim on release but never someone else's", async () => {
    await claimHome(home, OURS)
    expect(await readFile(daemonHomeOwnerPath(home), "utf8")).toBe(`${process.pid}:${OURS}\n`)

    // Fails closed like socket-guard's release: a superseded daemon exiting
    // late must not delete the new owner's claim.
    await releaseHomeClaim(home, THEIRS)
    expect(await readFile(daemonHomeOwnerPath(home), "utf8")).toContain(OURS)
    await writeFile(daemonHomeOwnerPath(home), `${process.pid + 1}:${OURS}\n`, "utf8")
    await releaseHomeClaim(home, OURS)
    expect(await readFile(daemonHomeOwnerPath(home), "utf8")).toContain(OURS)

    await claimHome(home, OURS)
    await releaseHomeClaim(home, OURS)
    await expect(readFile(daemonHomeOwnerPath(home), "utf8")).rejects.toThrow()
  })
})
