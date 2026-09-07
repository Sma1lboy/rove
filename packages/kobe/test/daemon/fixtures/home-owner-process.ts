import { appendFileSync } from "node:fs"
import { join } from "node:path"
import { startDaemonServer } from "@sma1lboy/kobe-daemon/daemon/server"
import { daemonRuntime } from "../../../src/core/daemon-runtime.ts"

const [homeDir, socketName] = process.argv.slice(2)
if (!homeDir || !socketName) throw new Error("temporary home and socket name are required")
try {
  await startDaemonServer(
    async () => {
      appendFileSync(join(homeDir, "factories.log"), `${process.pid}\n`)
      process.stdout.write("factory\n")
      process.stdin.resume()
      return await new Promise<never>(() => {})
    },
    {
      homeDir,
      socketPath: join(homeDir, socketName),
      runtime: daemonRuntime,
    },
  )
} catch (err) {
  process.stdout.write(`refused: ${err instanceof Error ? err.message : String(err)}\n`)
}
