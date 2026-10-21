import { describe, expect, it } from "vitest"
import { handleOrchestratorEvent } from "../../src/client/remote-orchestrator-events.ts"
import type { OrchestratorSignals, PeerTabEvent } from "../../src/client/remote-orchestrator-payloads.ts"

/** Peer tab changes skip the coalescing `*Sig` cells: each one is delivered, in order. */
function fakeSignals() {
  const peer: PeerTabEvent[] = []
  const adds: unknown[] = []
  const closes: unknown[] = []
  const signals = {
    emitPeerTab: (event: PeerTabEvent) => peer.push(event),
    setTabAddSig: (next: unknown) => adds.push(next),
    setTabCloseSig: (next: unknown) => closes.push(next),
  } as unknown as OrchestratorSignals
  return { signals, peer, adds, closes }
}

const tab = { kind: "engine", id: "tab-3", title: null, ordinal: 3 }

describe("peer tab events", () => {
  it("a tab.add with an origin is a peer open, not a CLI add", () => {
    const { signals, peer, adds } = fakeSignals()
    handleOrchestratorEvent("tab.add", { taskId: "t1", tab, origin: "A", at: 1 }, signals)
    handleOrchestratorEvent("tab.add", { taskId: "t1", tab, at: 2 }, signals)
    expect(peer).toEqual([{ op: "opened", taskId: "t1", tab, origin: "A", at: 1 }])
    expect(adds).toEqual([{ taskId: "t1", tab, at: 2 }])
  })

  it("two quick peer closes both arrive", () => {
    const { signals, peer, closes } = fakeSignals()
    for (const tabId of ["tab-2", "tab-3"]) {
      handleOrchestratorEvent("tab.close", { kind: "peer-closed", taskId: "t1", tabId, origin: "A", at: 5 }, signals)
    }
    expect(peer.map((e) => (e.op === "closed" ? e.tabId : ""))).toEqual(["tab-2", "tab-3"])
    expect(closes).toEqual([])
  })

  it("a malformed peer close is dropped", () => {
    const { signals, peer, closes } = fakeSignals()
    handleOrchestratorEvent("tab.close", { kind: "peer-closed", taskId: "t1", at: 5 }, signals)
    expect(peer).toEqual([])
    expect(closes).toEqual([])
  })
})
