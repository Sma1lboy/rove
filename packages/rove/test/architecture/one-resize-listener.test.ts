/**
 * `@opentui/react`'s `useTerminalDimensions` / `useOnResize` add a renderer
 * listener per caller; past ten mounted callers Node prints
 * MaxListenersExceededWarning into the terminal. Components read the size
 * through `tui-react/lib/use-terminal-size`, which shares one listener.
 */

import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"

const SRC = fileURLToPath(new URL("../../src/", import.meta.url))

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sources(path)
    return /\.tsx?$/.test(entry.name) ? [path] : []
  })
}

test("no component subscribes to renderer resize on its own", () => {
  const offenders = sources(SRC).filter((path) =>
    /import\s*\{[^}]*\b(useTerminalDimensions|useOnResize)\b[^}]*\}\s*from\s*"@opentui\/react"/.test(
      readFileSync(path, "utf8"),
    ),
  )
  expect(offenders.map((path) => path.slice(SRC.length))).toEqual([])
})
