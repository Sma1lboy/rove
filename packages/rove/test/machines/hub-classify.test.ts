/**
 * How a failed machine handshake reads on its row.
 *
 * Tested as a pure classification rather than by downgrading a real machine:
 * the message shapes below are the two `performInit` actually throws, and a
 * machine you can only reach over SSH is a poor place to install an old build
 * on purpose.
 */

import { describe, expect, it } from "vitest"
import { classifyHandshakeFailure } from "../../src/machines/hub.ts"

describe("classifyHandshakeFailure", () => {
  it("calls a protocol-range rejection a mismatch, from either side of the wire", () => {
    expect(
      classifyHandshakeFailure(
        "Rove daemon is protocol v2 (min v2); this client is v5 (min v5). Restart the daemon (`rove daemon restart`) or upgrade Rove.",
      ),
    ).toBe("mismatch")
    expect(classifyHandshakeFailure("daemon is protocol v9 (min v9); this client is v5 (min v2). Upgrade Rove.")).toBe(
      "mismatch",
    )
  })

  it("calls everything else offline", () => {
    expect(classifyHandshakeFailure("connect ENOENT /x/daemon.sock")).toBe("offline")
    expect(classifyHandshakeFailure("socket closed before hello")).toBe("offline")
    // "protocol" without a version is not the protocol check — don't grey a
    // machine as incompatible on a word.
    expect(classifyHandshakeFailure("protocol error: bad frame")).toBe("offline")
  })
})
