import { spawn } from "node-pty"
const [bun, script, ...args] = process.argv.slice(2)
const child = spawn(bun, [script, ...args], { name: "xterm-256color", cols: 120, rows: 40, cwd: process.cwd(), env: process.env })
child.onData((data) => process.stdout.write(data))
child.onExit(({ exitCode }) => process.exit(exitCode))
setTimeout(() => { child.kill(); process.exit(124) }, 230000).unref()
