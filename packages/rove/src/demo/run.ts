/**
 * The demo tab's process: paint `DEMO_SESSION` on a timer until interrupted.
 * Owns terminal IO and nothing else — the frames come from `replay.ts`.
 *
 * Never touches a model, the network, or the daemon. Speed and looping are the
 * only knobs, read from the environment so a task can launch it with no flags.
 */

import { ENTER_SCREEN, LEAVE_SCREEN, paintDemoFrame } from "./render.ts"
import { demoFrameAt, demoLoopElapsed } from "./replay.ts"
import { DEMO_SESSION, type DemoSessionScript } from "./session-script.ts"

/** ~10 fps: enough for a convincing spinner, cheap on a laptop. */
export const TICK_MS = 100

export interface DemoRunOptions {
  /** Playback multiplier; 2 = twice as fast. */
  readonly speed: number
  readonly loop: boolean
  readonly color: boolean
  readonly script: DemoSessionScript
}

export function demoRunOptions(env: NodeJS.ProcessEnv = process.env): DemoRunOptions {
  const raw = Number.parseFloat(env.ROVE_DEMO_SPEED ?? "")
  return {
    speed: Number.isFinite(raw) && raw > 0 ? raw : 1,
    loop: env.ROVE_DEMO_LOOP !== "0",
    color: !env.NO_COLOR,
    script: DEMO_SESSION,
  }
}

function transcript(script: DemoSessionScript): string {
  const frame = demoFrameAt(script, script.durationMs)
  return `${frame.lines.map((l) => l.text).join("\n")}\n`
}

/**
 * Paint until SIGINT/SIGTERM. Resolves with the process exit code. A non-TTY
 * stdout gets the finished transcript once — the escape codes would be noise.
 */
export function runDemoSession(opts: DemoRunOptions = demoRunOptions()): Promise<number> {
  const out = process.stdout
  if (!out.isTTY) {
    out.write(transcript(opts.script))
    return Promise.resolve(0)
  }
  return new Promise<number>((resolve) => {
    const started = Date.now()
    let done = false

    // The timer clears itself on the tick after `finish`, so no handler has to
    // hold an interval id it might not own yet.
    const finish = (code: number): void => {
      if (done) return
      done = true
      process.off("SIGWINCH", paint)
      out.write(LEAVE_SCREEN)
      resolve(code)
    }

    function paint(): void {
      if (done) return
      const wall = (Date.now() - started) * opts.speed
      const elapsed = demoLoopElapsed(opts.script, wall, opts.loop)
      // A fresh PTY reports 0×0 until the first resize wins the ioctl race.
      const cols = out.columns || 80
      const rows = out.rows || 24
      out.write(paintDemoFrame(demoFrameAt(opts.script, elapsed), { cols, rows, color: opts.color }))
      if (!opts.loop && wall >= opts.script.durationMs) finish(0)
    }

    const timer = setInterval(() => {
      if (done) {
        clearInterval(timer)
        return
      }
      paint()
    }, TICK_MS)
    process.on("SIGWINCH", paint)
    process.on("SIGINT", () => finish(0))
    process.on("SIGTERM", () => finish(0))
    out.write(ENTER_SCREEN)
    paint()
  })
}
