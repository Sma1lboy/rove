import { expect, test } from "bun:test"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { EDITED_OPS } from "../src/optimistic.ts"

/**
 * An op the page can draw before the daemon answers is sent through `AppModel` (`act`, `closeTab`,
 * `renameTab`), which draws it. A raw `request("task.archive")` elsewhere works and waits a round
 * trip plus the next push to show: the lag this guards against. A line that must send one raw
 * says why on the line above: `// act-ok: <reason>`.
 */
test("ops the page can draw on the click are sent through the model", () => {
  const src = join(import.meta.dir, "../src")
  const ops = [...EDITED_OPS, "tab.close", "tab.rename"].map((op) => op.replace(".", "\\."))
  const raw = new RegExp(`request(?:<[^(]*>)?\\(\\s*"(${ops.join("|")})"`, "g")
  const found: string[] = []
  for (const name of readdirSync(src, { recursive: true }) as string[]) {
    if (!/\.tsx?$/.test(name) || name === "model.ts") continue
    const text = readFileSync(join(src, name), "utf8")
    for (const hit of text.matchAll(raw)) {
      const before = text.slice(0, hit.index).split("\n")
      const excused = [before.at(-1), before.at(-2)].some((line) => line?.includes("act-ok:"))
      if (!excused) found.push(`${name}:${before.length} ${hit[1]}`)
    }
  }
  expect(found).toEqual([])
})
