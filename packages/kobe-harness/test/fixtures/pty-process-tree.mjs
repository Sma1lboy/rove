import { spawn } from "node:child_process"

process.on("SIGHUP", () => {})
process.on("SIGTERM", () => {})
process.stdout.write(`TREE_PID=${process.pid}\n`)
const depth = Number(process.argv[2] ?? 2)
if (depth > 0) {
  spawn(process.execPath, [import.meta.filename, String(depth - 1)], {
    detached: true,
    stdio: "inherit",
  })
}
setInterval(() => {}, 1000)
