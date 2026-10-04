import { spawn } from "node:child_process"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, it } from "vitest"

let home: string | undefined
afterEach(async () => {
  if (home) await rm(home, { recursive: true, force: true })
})

it("serializes independent settings writers through the complete read-mutate-write", async () => {
  home = await mkdtemp(join(tmpdir(), "rove-settings-writers-"))
  const store = new URL("../../src/state/store.ts", import.meta.url).href
  const source = `
    import { updateStateFile } from ${JSON.stringify(store)};
    const key = process.env.TEST_STATE_KEY;
    for (let i = 0; i < 8; i++) updateStateFile(state => {
      // Widen the read/write interleaving without replacing real filesystem I/O.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3);
      state[key] = i;
      return undefined;
    });
  `
  const exitCodes = await Promise.all(
    Array.from(
      { length: 6 },
      (_, index) =>
        new Promise<number | null>((resolve, reject) => {
          const child = spawn("bun", ["--eval", source], {
            env: {
              ...process.env,
              ROVE_HOME_DIR: home,
              KOBE_HOME_DIR: home,
              XDG_CONFIG_HOME: join(home!, ".config"),
              TEST_STATE_KEY: `writer${index}`,
            },
            stdio: "pipe",
          })
          child.once("error", reject)
          child.once("exit", resolve)
        }),
    ),
  )
  expect(exitCodes).toEqual(Array(6).fill(0))
  const saved = JSON.parse(await readFile(join(home, ".config", "rove", "state.json"), "utf8"))
  expect(saved).toEqual(Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`writer${i}`, 7])))
}, 15_000)
