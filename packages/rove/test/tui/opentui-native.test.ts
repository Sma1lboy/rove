import { describe, expect, it } from "vitest"
import { type NativeLibProbe, roveNativeLibPath } from "../../src/tui/lib/opentui-native"

function probe(over: {
  built?: string
  core?: string
  installed?: boolean
  env?: Record<string, string>
}): NativeLibProbe {
  const files: Record<string, string> = {
    "/nm/@opentui/core/package.json": JSON.stringify({ version: over.core ?? "0.8.4" }),
    "/nm/@sma1lboy/opentui-rove-darwin-arm64/package.json": JSON.stringify({
      opentui: over.built ?? "0.8.4",
      lib: "libopentui.dylib",
    }),
  }
  return {
    platform: "darwin",
    arch: "arm64",
    env: over.env ?? {},
    resolve: (id) => {
      if (id === "@opentui/core") return "/nm/@opentui/core/index.bun.js"
      if (id === "@sma1lboy/opentui-rove-darwin-arm64/package.json" && over.installed !== false) return `/nm/${id}`
      throw new Error(`Cannot find module '${id}'`)
    },
    readText: (path) => {
      const text = files[path]
      if (text === undefined) throw new Error(`ENOENT ${path}`)
      return text
    },
  }
}

describe("roveNativeLibPath", () => {
  it("hands OpenTUI Rove's build when it was built for the installed OpenTUI", () => {
    expect(roveNativeLibPath(probe({}))).toBe("/nm/@sma1lboy/opentui-rove-darwin-arm64/libopentui.dylib")
  })

  // OpenTUI throws at load on a library built for another version, which would stop the TUI from starting.
  it("keeps the stock library when the build is for another OpenTUI version", () => {
    expect(roveNativeLibPath(probe({ built: "0.8.4", core: "0.9.0" }))).toBeNull()
  })

  it("keeps the stock library where no build is installed, or when asked to", () => {
    expect(roveNativeLibPath(probe({ installed: false }))).toBeNull()
    expect(roveNativeLibPath(probe({ env: { ROVE_STOCK_OPENTUI: "1" } }))).toBeNull()
  })
})
