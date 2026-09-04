import { spawnSync } from "node:child_process"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { expect, it } from "vitest"

it.skipIf(process.platform === "win32")("rejects FIFOs without blocking async or synchronous readers", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "rove-fifo-"))
  const file = path.join(dir, "pipe")
  const made = spawnSync("mkfifo", [file], { timeout: 2000 })
  expect(made.status).toBe(0)
  const modulePath = path.resolve("src/engine/file-bounds.ts")
  const script = `import {readTextFileBounded, readTextFileSyncBounded, readFirstLineBounded} from ${JSON.stringify(modulePath)};
    const path = ${JSON.stringify(file)};
    console.log(JSON.stringify([await readTextFileBounded(path), readTextFileSyncBounded(path), await readFirstLineBounded(path)]));`
  const child = spawnSync("bun", ["-e", script], { timeout: 3000, encoding: "utf8" })
  expect(child.error).toBeUndefined()
  expect(child.status).toBe(0)
  expect(JSON.parse(child.stdout)).toEqual(["", null, ""])
})
