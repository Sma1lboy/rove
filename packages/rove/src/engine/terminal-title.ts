/**
 * Terminal-title policy: rules for reading an engine's own OSC 0/2 title.
 * Pure and vendor-free: functions take the declared {@link EngineTerminalTitle},
 * never a vendor id; `registry.ts` keeps the vendor→entry resolution and the
 * wrappers neutral callers import.
 *
 * Three questions, in order:
 *   1. the NAME in it: {@link stripStatusPrefix} drops the engine's status
 *      decoration, which Rove draws in its own glyph column;
 *   2. the TURN state: {@link titleTurnHint};
 *   3. is it a name at all: {@link titleIsPlaceholder} / {@link titleSessionId}.
 *      Codex writes its thread UUID until the thread is named, where claude
 *      and kimi write a sentence. An engine whose bad title carries no id
 *      would need a new knob; none does today.
 */

/**
 * OSC 0/2 title policy for an engine's interactive sessions. `ownsStatus`: the
 * live title is the status display, so tab chrome must not prefix a duplicate
 * turn glyph. `launchArgs` selects the engine's own title fields; asking the
 * engine for a better title is the first fix for a bad one.
 */
export interface EngineTerminalTitle {
  readonly ownsStatus: boolean
  readonly launchArgs?: readonly string[]
  /**
   * Leading status decoration, stripped before Rove renders the name (Rove
   * draws that state itself; animated variants make a resting tab look busy).
   * Anchored, longest-first, plus following whitespace. Never applied when it
   * would consume the whole title: a session named "Working" keeps its name.
   */
  readonly statusPrefixes?: readonly string[]
  /**
   * Subset of {@link statusPrefixes} written only while a turn runs. Losing it
   * is the one observable event an ESC interrupt leaves (claude-code runs no
   * Stop hook on its abort path). Omit when resting and working titles look
   * alike.
   */
  readonly workingPrefixes?: readonly string[]
  /**
   * Subset of {@link statusPrefixes} written only while blocked on a human
   * (approval, question). The turn is still in flight, so {@link titleTurnHint}
   * never says `"rest"` here, or `tui/workspace/interrupt-observer.ts` would
   * idle a live turn. omp writes `π !`.
   */
  readonly attentionPrefixes?: readonly string[]
  /**
   * Session id read out of a title that is an identifier until named. Codex's
   * `thread-title` is "the thread title, or the thread identifier when
   * unnamed", so a fresh codex tab's title is a bare UUID.
   *
   * Non-null means: don't render the title, and name the tab from that
   * session's first-prompt summary via the engine's `history` reader. Strict:
   * only the declaring engine answers, since the id is looked up in that
   * vendor's store. Absent = the title is always a name (claude, kimi).
   */
  readonly sessionIdFromTitle?: (title: string) => string | null
}

/**
 * Strip leading status decoration ({@link EngineTerminalTitle.statusPrefixes}).
 * Longest-first; a prefix that is the whole title is kept as the name. The
 * union fallback for a not-yet-known engine lives in `registry.ts`.
 */
export function stripStatusPrefix(title: string, prefixes: readonly string[]): string {
  for (const prefix of [...prefixes].sort((a, b) => b.length - a.length)) {
    if (!title.startsWith(prefix)) continue
    const rest = title.slice(prefix.length).trimStart()
    // Whole title was the decoration → it is the name, not a status.
    if (rest.length === 0) return title
    return rest
  }
  return title
}

/**
 * Turn state from the live title, or null for no verdict. The title rewrite
 * on stop is the only event-grade "turn ended" signal an ESC interrupt
 * produces (claude-code's abort path skips its stop hooks).
 *
 * `"rest"` only when the engine declares `workingPrefixes` AND wrote a
 * non-empty title without one; undecorated engines (copilot, custom wrappers)
 * and untitled sessions answer null. Attention titles answer null too: blocked
 * mid-turn is not stopped.
 */
export function titleTurnHint(config: EngineTerminalTitle | undefined, title: string): "working" | "rest" | null {
  const working = config?.workingPrefixes
  if (config?.ownsStatus !== true || !working || working.length === 0) return null
  const trimmed = title.trim()
  if (trimmed.length === 0) return null
  if (config.attentionPrefixes?.some((prefix) => trimmed.startsWith(prefix))) return null
  return working.some((prefix) => trimmed.startsWith(prefix)) ? "working" : "rest"
}

/** Session id this title is, or null; see {@link EngineTerminalTitle.sessionIdFromTitle}. */
export function titleSessionId(config: EngineTerminalTitle | undefined, title: string): string | null {
  const trimmed = title.trim()
  if (!trimmed) return null
  return config?.sessionIdFromTitle?.(trimmed) ?? null
}

/** True when the title is not a name; callers show the first-prompt summary, then the vendor default. */
export function titleIsPlaceholder(config: EngineTerminalTitle | undefined, title: string): boolean {
  return titleSessionId(config, title) !== null
}
