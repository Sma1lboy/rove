import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { addDevice, deviceOf, listDevices, revokeDevice } from "../src/auth.ts"
import { parseBridgeArgs } from "../src/cli-args.ts"
import { TOKEN, connect, start, stopServers } from "./server-harness.ts"

afterEach(stopServers)

describe("per-device tokens", () => {
  test("each device gets its own token, stored only as a hash, revoked alone", () => {
    const dir = mkdtempSync(join(tmpdir(), "rove-devices-"))
    try {
      const path = join(dir, "devices.json")
      const phone = addDevice(path, "phone")
      const laptop = addDevice(path, "laptop")
      expect(deviceOf(path, phone)).toBe("phone")
      expect(deviceOf(path, laptop)).toBe("laptop")
      expect(deviceOf(path, "nope")).toBeNull()
      expect(readFileSync(path, "utf8")).not.toContain(phone)
      expect(revokeDevice(path, "phone")).toBe(true)
      expect(deviceOf(path, phone)).toBeNull()
      expect(deviceOf(path, laptop)).toBe("laptop")
      expect(listDevices(path).map((d) => d.name)).toEqual(["laptop"])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("the flags parse into one-shot actions", () => {
    expect(parseBridgeArgs(["--device", "phone"])).toMatchObject({ device: "phone", action: "serve" })
    expect(parseBridgeArgs(["--revoke-device", "phone"])).toMatchObject({ device: "phone", action: "revoke-device" })
    expect(parseBridgeArgs(["--list-devices"]).action).toBe("list-devices")
    expect(parseBridgeArgs(["--setup"]).action).toBe("setup")
  })

  test("the bridge accepts a device's token as well as the shared one, and refuses others", async () => {
    const h = start({ deviceOf: (t) => (t === "d".repeat(43) ? "phone" : null) })
    const shared = await connect(h.url, { Authorization: `Bearer ${TOKEN}` })
    expect((await shared.call("hello")).ok).toBe(true)
    const device = await connect(h.url, { Authorization: `Bearer ${"d".repeat(43)}` })
    expect((await device.call("hello")).ok).toBe(true)
    await expect(connect(h.url, { Authorization: `Bearer ${"x".repeat(43)}` })).rejects.toThrow()
  })
})
