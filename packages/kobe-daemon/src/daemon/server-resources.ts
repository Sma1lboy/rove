import { logDaemonError } from "./crash-log.ts"

/** Shutdown and failed bootstrap unwind the same daemon resources, once. */
export class DaemonResources {
  private readonly cleanup: Array<() => void | Promise<void>> = []
  private closing: Promise<void> | undefined

  defer(close: () => void | Promise<void>): void {
    this.cleanup.push(close)
  }

  close(): Promise<void> {
    this.closing ??= this.dispose()
    return this.closing
  }

  private async dispose(): Promise<void> {
    for (const close of this.cleanup.reverse()) {
      try {
        await close()
      } catch (err) {
        logDaemonError("daemon-shutdown", err)
      }
    }
  }
}
