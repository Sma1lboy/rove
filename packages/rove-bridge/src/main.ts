/**
 * rove-bridge — the Mac-side WebSocket gateway for the Rove phone clients.
 *
 *   bun src/main.ts [--preset tailscale|cf] [--port <n>] [--rotate-token]
 *
 * `rove --web` runs the same bridge with the browser client attached.
 */

import { runBridge } from "./run.ts"

await runBridge(process.argv.slice(2), { name: "rove-bridge" })
