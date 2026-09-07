/**
 * What a client does with the daemon's obituary (`daemon.stopping`, protocol
 * v5).
 *
 * The frame exists to answer one question a socket close cannot: is this
 * daemon being REPLACED, or is it just gone? Only the first is worth telling a
 * user about — it means their client is about to be a build behind — and the
 * three others are shutdowns the reconnect loop already absorbs silently, so
 * mistaking one for the other resurrects exactly the always-on disconnect
 * banner `host-banner.tsx` refuses to have.
 */

import { describe, expect, it } from "vitest"
import { handleOrchestratorEvent } from "../../src/client/remote-orchestrator-events.ts"
import type { OrchestratorSignals } from "../../src/client/remote-orchestrator-payloads.ts"

function fakeSignals() {
  const state = { restarting: false, version: null as string | null }
  const signals = {
    setDaemonRestartingSig: (next: boolean) => {
      state.restarting = next
    },
    setDaemonVersionSig: (next: string | null) => {
      state.version = next
    },
  } as unknown as OrchestratorSignals
  return { signals, state }
}

describe("daemon.stopping", () => {
  it("a restart arms the refresh and carries the outgoing build", () => {
    const { signals, state } = fakeSignals()
    handleOrchestratorEvent("daemon.stopping", { reason: "restart", kobeVersion: "0.9.160" }, signals)
    expect(state.restarting).toBe(true)
    // The version rides along so the client can compare NOW rather than after
    // a reconnect plus a `hello` under backoff.
    expect(state.version).toBe("0.9.160")
  })

  it("every other reason arms nothing", () => {
    // Idle shutdown, a socket takeover, a plain stop: all ordinary, all
    // recovered silently by the reconnect loop. A refresh prompt on any of
    // them would be the disconnect banner by another name.
    for (const reason of ["idle", "socket-lost", "stop"]) {
      const { signals, state } = fakeSignals()
      handleOrchestratorEvent("daemon.stopping", { reason }, signals)
      expect(state.restarting).toBe(false)
    }
  })

  it("a v4 daemon's empty payload arms nothing", () => {
    // The whole reason the field is optional: older daemons broadcast `{}` and
    // must keep meaning what they always meant.
    const { signals, state } = fakeSignals()
    handleOrchestratorEvent("daemon.stopping", {}, signals)
    expect(state.restarting).toBe(false)
    expect(state.version).toBe(null)
  })

  it("an unrecognized reason arms nothing", () => {
    // Forward-compat in the safe direction: a future reason this build has
    // never heard of must not be read as the one reason that tears down the UI.
    const { signals, state } = fakeSignals()
    handleOrchestratorEvent("daemon.stopping", { reason: "upgrading-in-place" }, signals)
    expect(state.restarting).toBe(false)
  })

  it("does not mistake a version for a reason", () => {
    // A daemon that reports its build on an ordinary stop is not restarting.
    const { signals, state } = fakeSignals()
    handleOrchestratorEvent("daemon.stopping", { kobeVersion: "0.9.160" }, signals)
    expect(state.version).toBe("0.9.160")
    expect(state.restarting).toBe(false)
  })
})
