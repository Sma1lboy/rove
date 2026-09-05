/**
 * `psSnapshot` used to await `ps` with no deadline and no kill. Every caller
 * wraps the probe in try/catch, which catches a THROW and never a hang, so a
 * `ps` that did not exit froze whichever gate asked it until the process was
 * restarted — there was no other backstop anywhere on the path.
 *
 * The deadline exists so that failure becomes an ANSWER: "unknown", which
 * readers already publish as such and reporting gates must not restate as
 * "no engine".
 */
import { PS_PROBE_TIMEOUT_MS, type PsProcess, PsProbeUnavailableError, psSnapshotWith } from "../../src/engine/foreground.ts"
import { enginePresence, sessionHasEngine } from "../../src/engine/session-engine-presence.ts"
import { describe, expect, it } from "vitest"

/** A `ps` that never exits — the failure the deadline exists for. */
function neverExits(): { spawn: () => PsProcess; killed: () => number } {
  let kills = 0
  return {
    spawn: () => ({ text: new Promise<string>(() => {}), kill: () => { kills++ } }),
    killed: () => kills,
  }
}

const PS_LINE = "  100     1 /bin/zsh -ilc\n  200   100 claude --session-id abc\n"

describe("ps probe deadline", () => {
  it("gives up on a ps that never exits, and kills it", async () => {
    const stub = neverExits()
    const started = Date.now()
    await expect(psSnapshotWith(stub.spawn, 150)).rejects.toBeInstanceOf(PsProbeUnavailableError)
    // Bounded: the whole point is that this returns at all.
    expect(Date.now() - started).toBeLessThan(2_000)
    // An abandoned `ps` holding a pipe nobody reads leaks in a long-lived daemon.
    expect(stub.killed()).toBe(1)
  })

  it("returns the output and leaves the child alone when ps answers", async () => {
    const stub = neverExits()
    const spawn = (): PsProcess => ({ text: Promise.resolve(PS_LINE), kill: stub.spawn().kill })
    expect(await psSnapshotWith(spawn, 150)).toBe(PS_LINE)
    expect(stub.killed()).toBe(0)
  })

  it("ships a deadline wide enough that a healthy ps never hits it", () => {
    // `ps -A` measures ~20ms on a healthy machine; the constant is the
    // stuck-process-table threshold, not a latency budget.
    expect(PS_PROBE_TIMEOUT_MS).toBeGreaterThanOrEqual(1_000)
    expect(PS_PROBE_TIMEOUT_MS).toBeLessThanOrEqual(30_000)
  })
})

describe("engine presence when the probe cannot answer", () => {
  const hang = () => psSnapshotWith(neverExits().spawn, 100)

  it("reports unknown rather than inventing an absence", async () => {
    expect(await enginePresence(200, undefined, hang)).toBe("unknown")
  })

  it("still walks to a real verdict when ps answers", async () => {
    const ok = async () => PS_LINE
    expect(await enginePresence(100, undefined, ok)).toBe("engine")
    expect(await enginePresence(999, undefined, ok)).toBe("none")
    // No pid is an answer, not a failed look.
    expect(await enginePresence(null, undefined, ok)).toBe("none")
  })

  it("keeps the write GATE closed on unknown — refusing is not the same as reporting", async () => {
    // sessionHasEngine must stay false: a prompt pasted into a bare shell is
    // executed. The distinction is for what callers SAY, not what they allow.
    expect(await sessionHasEngine(200, undefined, hang)).toBe(false)
  })
})
