import { expect, spyOn, test } from "bun:test"
import { renderUnicodeCompact } from "uqr"
import { printBanner } from "../src/banner.ts"
import { parseBridgeArgs } from "../src/cli-args.ts"

const printed = (signIn: "token" | "open") => {
  const lines: string[] = []
  const log = spyOn(console, "log").mockImplementation((s: string) => void lines.push(String(s)))
  printBanner({
    name: "rove --web",
    web: true,
    home: "/h",
    bridgeDir: "/h/bridge",
    args: parseBridgeArgs(["--host", "192.168.1.9"]),
    token: "tok",
    servers: [{ hostname: "192.168.1.9", port: 7878 }],
    signIn,
    relay: null,
  })
  log.mockRestore()
  return lines
}

test("rove --web prints a QR of the page link the phone opens", () => {
  expect(printed("token")).toContain(renderUnicodeCompact("http://192.168.1.9:7878/#token=tok"))
  expect(printed("open")).toContain(renderUnicodeCompact("http://192.168.1.9:7878/"))
})
