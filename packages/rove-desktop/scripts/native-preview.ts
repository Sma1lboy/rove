/** Build the local AppKit preview and connect it to this checkout's bridge. */
import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { start } from "../src/bridge.ts"

if (process.platform !== "darwin") throw new Error("The native terminal preview requires macOS.")
const desktop = resolve(import.meta.dir, "..")
const mac = resolve(desktop, "macos")
const bin = resolve(desktop, "../rove/dist/cli/rove.js")
if (!process.env.ROVE_DESKTOP_URL && !existsSync(bin)) throw new Error("Run bun run build at the repo root first.")
const build = Bun.spawnSync(["swift", "build", "--package-path", mac], { stdio: ["inherit", "inherit", "inherit"] })
if (build.exitCode !== 0) process.exit(build.exitCode)
const bridge = await start({ bin })
try {
  const app = Bun.spawn([resolve(mac, ".build/debug/RoveMac")], {
    env: { ...process.env, ROVE_DESKTOP_URL: bridge.url },
    stdio: ["inherit", "inherit", "inherit"],
  })
  const stop = () => app.kill()
  process.once("SIGINT", stop)
  process.once("SIGTERM", stop)
  bridge.onExit(stop)
  process.exitCode = await app.exited
} finally {
  bridge.stop()
}
