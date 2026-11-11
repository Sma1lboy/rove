/**
 * Rove's own build of OpenTUI's native library (github.com/Sma1lboy/opentui-rove): the stock renderer
 * with a frame encoder that writes only the colours that changed inside a run of cells.
 *
 * It ships as an optional package per platform. Where none is installed, or the installed one was
 * built for another OpenTUI version, OpenTUI loads its own library as before.
 */

import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"

/** Set to `1` to keep OpenTUI's stock native library even when Rove's build is installed. */
export const STOCK_OPENTUI_ENV = "ROVE_STOCK_OPENTUI"

export interface NativeLibProbe {
  readonly platform: string
  readonly arch: string
  readonly env: Record<string, string | undefined>
  /** `require.resolve`; throws when the module is not installed. */
  readonly resolve: (id: string) => string
  readonly readText: (path: string) => string
}

/** Path of the native library to hand OpenTUI, or null to leave its own in place. */
export function roveNativeLibPath(probe: NativeLibProbe): string | null {
  if (probe.env[STOCK_OPENTUI_ENV] === "1") return null
  try {
    const manifestPath = probe.resolve(`@sma1lboy/opentui-rove-${probe.platform}-${probe.arch}/package.json`)
    const manifest = JSON.parse(probe.readText(manifestPath)) as { opentui?: string; lib?: string }
    // `@opentui/core` does not export its package.json; its entry file sits beside it.
    const core = JSON.parse(probe.readText(join(dirname(probe.resolve("@opentui/core")), "package.json"))) as {
      version?: string
    }
    // OpenTUI refuses a library built for another context ABI, so a version apart means the stock one.
    if (!manifest.lib || !manifest.opentui || manifest.opentui !== core.version) return null
    return join(dirname(manifestPath), manifest.lib)
  } catch {
    // Not installed on this platform: the ordinary case everywhere Rove ships no build.
    return null
  }
}

export function installedRoveNativeLibPath(): string | null {
  const require = createRequire(import.meta.url)
  return roveNativeLibPath({
    platform: process.platform,
    arch: process.arch,
    env: process.env,
    resolve: (id) => require.resolve(id),
    readText: (path) => readFileSync(path, "utf8"),
  })
}
