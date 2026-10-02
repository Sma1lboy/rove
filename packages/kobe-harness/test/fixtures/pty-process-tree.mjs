import { spawn } from "node:child_process"

process.on("SIGHUP", () => {})
process.on("SIGTERM", () => {})
process.stdout.write(`${process.argv[2] === "service" ? "SERVICE" : "TREE"}_PID=${process.pid}\n`)
const depth = Number(process.argv[2] ?? 2)
if (depth === 2) {
  const service = spawn(process.execPath, [import.meta.filename, "service"], {
    detached: true,
    stdio: ["ignore", "pipe", "ignore"],
  })
  service.stdout.on("data", (data) => process.stdout.write(data))
  service.unref()
}
if (depth > 0) {
  spawn(process.execPath, [import.meta.filename, String(depth - 1)], {
    stdio: "inherit",
  })
}
setInterval(() => {}, 1000)
