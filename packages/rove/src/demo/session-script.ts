/**
 * The scripted session a demo tab replays. Pure data — no terminal, no model,
 * no network. `replay.ts` turns it into frames; `run.ts` paints them.
 *
 * Beats are append-only and ordered by `atMs`, so the visible transcript at any
 * instant is just "every beat up to now". That keeps the replay a pure function
 * of elapsed time and makes it loopable by wrapping the clock.
 */

/** Where a line's color comes from. The renderer owns the escape codes. */
export type DemoTone = "plain" | "dim" | "muted" | "accent" | "ok" | "warn" | "err"

export interface DemoLine {
  readonly text: string
  readonly tone: DemoTone
}

export interface DemoBeat {
  /** Milliseconds after session start when this beat's lines land. */
  readonly atMs: number
  /** Spinner caption while this beat is the newest one; absent = keep the last. */
  readonly working?: string
  readonly lines: readonly DemoLine[]
}

export interface DemoSessionScript {
  /** Sorted by `atMs`; `replay.ts` asserts this. */
  readonly beats: readonly DemoBeat[]
  /** Scripted wall-clock length. The runner wraps the clock here to loop. */
  readonly durationMs: number
  /** Tokens attributed to the finished session, for the final footer. */
  readonly totalTokens: number
}

const line = (text: string, tone: DemoTone = "plain"): DemoLine => ({ text, tone })

/** The beats of one plausible "fix a flaky test" turn. */
const BEATS: readonly DemoBeat[] = [
  {
    atMs: 0,
    working: "Thinking",
    lines: [
      line("╭──────────────────────────────────────────────────────────╮", "muted"),
      line("│  ✳ Claude Code                                           │", "accent"),
      line("│  model: claude-sonnet-4-5 · cwd: ~/code/queue             │", "muted"),
      line("╰──────────────────────────────────────────────────────────╯", "muted"),
      line(""),
      line("> the retry test in src/queue.ts is flaky, fix it", "plain"),
      line(""),
    ],
  },
  {
    atMs: 900,
    working: "Thinking",
    lines: [line("✻ Thinking…", "accent")],
  },
  {
    atMs: 2100,
    working: "Reading src/queue.ts",
    lines: [line("● Read(src/queue.ts)", "accent"), line("  ⎿  Read 84 lines", "muted")],
  },
  {
    atMs: 3000,
    working: "Searching",
    lines: [
      line('● Grep(pattern: "retry|backoff", path: "src")', "accent"),
      line("  ⎿  Found 12 matches across 3 files", "muted"),
    ],
  },
  {
    atMs: 4200,
    working: "Editing src/queue.ts",
    lines: [
      line("● Edit(src/queue.ts)", "accent"),
      line("  ⎿  Updated src/queue.ts with 6 additions and 2 removals", "muted"),
      line("      41   41   async function drain() {", "dim"),
      line("      42   42     const batch = queue.splice(0, limit)", "dim"),
      line("      43        -  await Promise.all(batch.map(send))", "err"),
      line("      43   43   +  await Promise.allSettled(batch.map(send))", "ok"),
      line("      44   44   +  if (batch.some((job) => !job.settled)) {", "ok"),
      line("      45   45   +    queue.unshift(...batch.filter((job) => !job.settled))", "ok"),
      line("      46   46   +  }", "ok"),
      line("      47   47   }", "dim"),
    ],
  },
  {
    atMs: 6000,
    working: "Running tests",
    lines: [line("● Bash(bun test src/queue.test.ts)", "accent"), line("  ⎿  Running…", "muted")],
  },
  {
    atMs: 7400,
    working: "Waiting for approval",
    lines: [
      line("  ⎿  11 passed, 1 failed", "warn"),
      line(""),
      line("╭──────────────────────────────────────────────────────────╮", "warn"),
      line("│  Bash command                                            │", "warn"),
      line("│                                                          │", "warn"),
      line("│    bun test src/queue.test.ts --retry=3                  │", "plain"),
      line("│                                                          │", "warn"),
      line("│  Rerun the suite with retries to confirm the flake.      │", "muted"),
      line("│                                                          │", "warn"),
      line("│  ❯ 1. Yes                                                │", "accent"),
      line("│    2. Yes, and don't ask again this session              │", "muted"),
      line("│    3. No, and tell Claude what to do differently (esc)   │", "muted"),
      line("╰──────────────────────────────────────────────────────────╯", "warn"),
    ],
  },
  {
    atMs: 10400,
    working: "Running tests",
    lines: [line("  ⎿  12 passed (3.1s) — flake did not reproduce", "ok")],
  },
  {
    atMs: 12200,
    working: "Writing the summary",
    lines: [
      line(""),
      line("● Reran the suite three times; the failure came from", "plain"),
      line("  Promise.all rejecting the whole batch on one send error,", "plain"),
      line("  so the remaining jobs were dropped and the retry counter", "plain"),
      line("  never advanced. Switched to allSettled and requeue the", "plain"),
      line("  unsettled jobs.", "plain"),
      line(""),
    ],
  },
  {
    atMs: 14600,
    lines: [line("✻ Worked for 14.6s · 3.4k tokens · 8% of context used", "muted"), line(""), line("> ", "dim")],
  },
]

export const DEMO_SESSION: DemoSessionScript = {
  beats: BEATS,
  durationMs: 16000,
  totalTokens: 3400,
}
