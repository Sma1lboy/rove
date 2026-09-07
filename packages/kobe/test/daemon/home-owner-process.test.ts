import { type ChildProcess, spawn } from "node:child_process"
import { once } from "node:events"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it } from "vitest"

const roots: string[] = []
const children: ChildProcess[] = []
afterEach(async () => {
  await Promise.all(
    children.splice(0).map(async (child) => {
      if (child.exitCode !== null || child.signalCode !== null) return
      const exited = once(child, "exit")
      child.kill("SIGKILL")
      await exited
    }),
  )
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})
async function home() {
  const path = await mkdtemp(join(tmpdir(), "rove-process-owner-"))
  roots.push(path)
  return path
}
function start(homeDir: string, socket: string) {
  const child = spawn(
    process.env.ROVE_TEST_BUN ?? "bun",
    [fileURLToPath(new URL("./fixtures/home-owner-process.ts", import.meta.url)), homeDir, socket],
    {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        ROVE_HOME_DIR: homeDir,
        KOBE_HOME_DIR: homeDir,
        XDG_CONFIG_HOME: join(homeDir, ".config"),
      },
    },
  )
  children.push(child)
  const output = new Promise<string>((resolve, reject) => {
    let text = ""
    child.stdout?.on("data", (data) => {
      text += data
      if (text.includes("\n")) resolve(text.trim())
    })
    child.once("error", reject)
    child.once("exit", () => {
      if (!text) reject(new Error("child exited without a verdict"))
    })
  })
  return { child, output }
}

describe("single-home ownership across real Bun processes", () => {
  it.each([1, 2, 3, 4, 5])(
    "round %i admits one concurrent factory and recovers after SIGKILL",
    async () => {
      const path = await home()
      const attempts = [start(path, "one.sock"), start(path, "two.sock")]
      const outcomes = await Promise.all(attempts.map((attempt) => attempt.output))
      expect(
        outcomes.filter((outcome) => outcome === "factory"),
        JSON.stringify(outcomes),
      ).toHaveLength(1)
      expect(outcomes.filter((outcome) => outcome.startsWith("refused:"))).toHaveLength(1)
      expect((await readFile(join(path, "factories.log"), "utf8")).trim().split("\n")).toHaveLength(1)
      const owner = attempts[outcomes.indexOf("factory")].child
      const exited = once(owner, "exit")
      owner.kill("SIGKILL")
      await exited
      expect(await start(path, "recovered.sock").output).toBe("factory")
      expect((await readFile(join(path, "factories.log"), "utf8")).trim().split("\n")).toHaveLength(2)
    },
    15_000,
  )

  it("allows unrelated homes to initialize concurrently", async () => {
    const a = start(await home(), "daemon.sock")
    const b = start(await home(), "daemon.sock")
    expect(await Promise.all([a.output, b.output])).toEqual(["factory", "factory"])
  }, 15_000)
})
