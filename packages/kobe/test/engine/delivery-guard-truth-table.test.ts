/**
 * The delivery guard's whole contract as a truth table: three settings × the
 * two situations that block a paste.
 *
 * Enumerated on purpose, and this is the one shape where enumeration earns its
 * keep — the bug being fixed is a THIRD state collapsing back into a boolean.
 * Any implementation that treats `screen-off` and `off` as one value, or that
 * keeps the keystroke window unconditional (as the previous one did, comment
 * and all), fails a cell here rather than passing six tests about two states.
 */

import { describe, expect, it } from "vitest"
import { ComposerBusyError, type HostedSessionRpc, deliverToHostedKey } from "../../src/engine/hosted-session.ts"
import { type DeliveryGuard, deliveryGuardLayers } from "../../src/state/delivery-guard.ts"

/** A composer holding text: the manifest's empty-rule does not match. */
const BUSY_SCREEN = Buffer.from("❯ half a sentence\n").toString("base64")
const EMPTY_SCREEN = Buffer.from("❯\n❯\n").toString("base64")

const MANIFEST = {
  rules: [],
  composerEmpty: [{ bottomLines: 2, all: ["❯"], lineRegex: ["^\\s*❯\\s*$"] }],
}

const NOW = 5_000

function rpcWith(peek: { data: string; lastHumanWriteMs?: number }) {
  let written = ""
  const rpc: HostedSessionRpc = {
    request: async <T>(name: string, payload?: unknown): Promise<T> => {
      if (name === "pty.write") {
        written += (payload as { data?: string })?.data ?? ""
        return {} as T
      }
      if (name === "pty.peek") {
        return {
          exists: true,
          alive: true,
          pid: 42,
          offset: 0,
          // DECSET 2004 up front so the paste-readiness wait passes, and the
          // echo appended so the delivery confirmation does — neither is what
          // this table measures.
          data: Buffer.concat([
            Buffer.from("\x1b[?2004h"),
            Buffer.from(peek.data, "base64"),
            Buffer.from(written),
          ]).toString("base64"),
          sinceValid: false,
          exit: null,
          humanWriteQuietMs: 10_000,
          ...(peek.lastHumanWriteMs === undefined ? {} : { lastHumanWriteMs: peek.lastHumanWriteMs }),
        } as T
      }
      return {} as T
    },
  }
  return rpc
}

/** `null` when the paste went through, else the layer that stopped it. */
async function deliver(
  guard: DeliveryGuard,
  situation: "typing" | "composer-has-text",
): Promise<ComposerBusyError["layer"] | null> {
  const rpc =
    situation === "typing"
      ? // Someone typed 4s ago, and the composer they typed into is empty —
        // only the keystroke window can hold this.
        rpcWith({ data: EMPTY_SCREEN, lastHumanWriteMs: 1_000 })
      : // Text is on screen and nobody has touched the keyboard in ages —
        // only the screen read can hold this.
        rpcWith({ data: BUSY_SCREEN })
  try {
    await deliverToHostedKey(rpc, "t1::tab-1", "go", {
      guard,
      screenManifest: MANIFEST,
      now: () => NOW,
      pasteReadyTimeoutMs: 50,
    })
    return null
  } catch (error) {
    if (error instanceof ComposerBusyError) return error.layer
    throw error
  }
}

describe("delivery guard truth table", () => {
  const cells: ReadonlyArray<{
    guard: DeliveryGuard
    typing: ComposerBusyError["layer"] | null
    composer: ComposerBusyError["layer"] | null
  }> = [
    { guard: "on", typing: "recent-human-write", composer: "composer-not-empty" },
    // The escape hatch for a vendor redesign: the layout rule is dropped, the
    // clock is not, so a composer someone is typing into stays protected.
    { guard: "screen-off", typing: "recent-human-write", composer: null },
    { guard: "off", typing: null, composer: null },
  ]

  for (const cell of cells) {
    it(`${cell.guard}: keystroke window ${cell.typing ? "holds" : "delivers"}, screen read ${cell.composer ? "holds" : "delivers"}`, async () => {
      expect(await deliver(cell.guard, "typing")).toBe(cell.typing)
      expect(await deliver(cell.guard, "composer-has-text")).toBe(cell.composer)
    })
  }

  it("no two settings run the same pair of layers", () => {
    const signatures = cells.map((cell) => JSON.stringify(deliveryGuardLayers(cell.guard)))
    expect(new Set(signatures).size).toBe(cells.length)
  })

  it("the table and the layer map agree about every cell", () => {
    // The map is what the daemon and the docs read; the deliveries above are
    // what actually happens. A change to one that skips the other fails here.
    for (const cell of cells) {
      const layers = deliveryGuardLayers(cell.guard)
      expect(layers.humanWrite).toBe(cell.typing !== null)
      expect(layers.screen).toBe(cell.composer !== null)
    }
  })
})
