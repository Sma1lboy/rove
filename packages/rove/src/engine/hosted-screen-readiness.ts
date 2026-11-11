import type { PtyPeekResult } from "@sma1lboy/rove-daemon/daemon/protocol"
import { Terminal } from "@xterm/headless"
import type { HostedSessionRpc } from "./hosted-session.ts"
import { type EngineScreenManifest, classifyScreen } from "./screen-state.ts"

/** Replay the current screen so erased dialogs in the PTY ring cannot block delivery. */
export async function awaitUnblockedScreen(
  rpc: HostedSessionRpc,
  key: string,
  manifest: EngineScreenManifest,
  opts: { timeoutMs: number; intervalMs: number; sleep: (ms: number) => Promise<void> },
): Promise<boolean> {
  const deadline = Date.now() + opts.timeoutMs
  for (;;) {
    const peek = await rpc.request<PtyPeekResult>("pty.peek", { key, preamble: true })
    if (!peek.alive) return false
    const terminal = new Terminal({
      cols: peek.cols ?? 80,
      rows: peek.rows ?? 24,
      allowProposedApi: true,
      scrollback: 0,
    })
    try {
      const bytes = Buffer.from(peek.data, "base64")
      if (bytes.length) await new Promise<void>((resolve) => terminal.write(bytes, resolve))
      const buffer = terminal.buffer.active
      const lines = Array.from(
        { length: terminal.rows },
        (_, row) => buffer.getLine(buffer.baseY + row)?.translateToString(true) ?? "",
      )
      if (classifyScreen(manifest, lines.join("\n")) !== "blocked") return true
    } finally {
      terminal.dispose()
    }
    if (Date.now() >= deadline) return false
    await opts.sleep(opts.intervalMs)
  }
}
