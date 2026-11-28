/**
 * Session-identity policy: how an engine reports and resumes its session id.
 * Pure and vendor-free: functions take the adapter's declared
 * {@link EngineSessionIdentity}, never a vendor id.
 *
 * The id has three possible origins, fixed by each CLI:
 *
 *   1. PINNED at launch: the CLI accepts a caller-generated id
 *      (`claude --session-id <uuid>`), so the tab is trackable from frame one.
 *   2. READ FROM THE TITLE: the CLI writes its id into its OSC title until the
 *      thread has a name (codex). Declared on
 *      `EngineTerminalTitle.sessionIdFromTitle`.
 *   3. DISCOVERED AFTER THE FACT: the CLI mints an id and tells no one, so Rove
 *      looks in the session store for what appeared under this worktree
 *      (kimi). Weakest, but every engine has it
 *      (`EngineHistoryReader.listSessionIdsForWorktree`). Without it a kimi
 *      tab respawns blank on every restart.
 */

/**
 * How an engine's CLI handles session identity. Absent = no known session
 * flags: tabs are still tracked from the history store, but a restart opens a
 * fresh conversation.
 */
export interface EngineSessionIdentity {
  /** Flag that pins a caller-generated id at launch (`--session-id <uuid>`).
   *  Absent = the engine mints its own and the tab learns it via origin 2 or 3. */
  readonly pinFlag?: string
  /**
   * Flags meaning "this command already controls its own session". When the
   * user's `engineCommand.<id>` carries one, Rove must NOT append its pin: the
   * engine would refuse two session controls or resume some other id. The
   * user's flag always wins.
   */
  readonly sessionControlFlags?: readonly string[]
  /**
   * Argv that reopens `sessionId`'s conversation. A full-argv rewrite because
   * shapes differ in kind: claude/kimi take a flag (`--resume <id>` /
   * `-S <id>`), codex a subcommand (`codex resume [opts] <id>`); probed on the
   * real binaries. Absent = a restarted tab starts fresh rather than pass a
   * flag that kills the launch.
   */
  readonly resumeArgv?: (base: readonly string[], sessionId: string) => readonly string[]
  /**
   * Argv that opens `sourceId`'s conversation as a NEW diverging session in the
   * same worktree: claude `--resume <src> --fork-session`, codex
   * `codex fork [opts] <src>`. Absent = Rove refuses; kimi's `-S` and
   * copilot's `--resume` reopen rather than fork, putting two live processes
   * on one transcript.
   *
   * `newId` is the id the fork should carry, for CLIs that accept one
   * (claude's `--session-id`); others ignore it. Null/absent = the engine
   * names it. Returning null refuses this fork; the caller opens an ordinary tab.
   */
  readonly forkArgv?: (base: readonly string[], sourceId: string, newId?: string | null) => readonly string[] | null
}

/**
 * `--flag value` or `--flag=value`; `--resume-x` is not `--resume`. Local so
 * this module stays a leaf with no engine-module imports.
 */
function hasFlag(argv: readonly string[], flag: string): boolean {
  return argv.some((a) => a === flag || a.startsWith(`${flag}=`))
}

/** The launch command already pins or resumes a session of its own. */
export function controlsOwnSession(identity: EngineSessionIdentity | undefined, argv: readonly string[]): boolean {
  return (identity?.sessionControlFlags ?? []).some((flag) => hasFlag(argv, flag))
}

/** Append the pin flag, unless the engine takes none (kimi/codex/custom) or the command controls its session. */
export function pinSessionArgv(
  identity: EngineSessionIdentity | undefined,
  argv: readonly string[],
  sessionId: string,
): readonly string[] {
  if (!identity?.pinFlag) return argv
  if (controlsOwnSession(identity, argv)) return argv
  return [...argv, identity.pinFlag, sessionId]
}

/** True when this engine accepts a caller-set id on a launch of `argv`. */
export function acceptsPinnedSession(identity: EngineSessionIdentity | undefined, argv: readonly string[]): boolean {
  return !!identity?.pinFlag && !controlsOwnSession(identity, argv)
}

/**
 * Argv that resumes `sessionId`, or null (caller launches fresh) when there is
 * no resume verb or the command controls its own session; the user's
 * `--resume <other>` must not be overridden.
 */
export function resumeSessionArgv(
  identity: EngineSessionIdentity | undefined,
  base: readonly string[],
  sessionId: string,
): readonly string[] | null {
  if (!sessionId || !identity?.resumeArgv) return null
  if (controlsOwnSession(identity, base)) return null
  return identity.resumeArgv(base, sessionId)
}

/**
 * Newest id in `ids` (oldest-first) that no sibling tab claims. The store
 * answers per worktree, not per tab, so two tabs see one list; claims give the
 * second tab the second-newest. Null when all are claimed: better a blank tab
 * than a stolen one.
 */
export function pickUnclaimedSessionId(ids: readonly string[], claimed: ReadonlySet<string>): string | null {
  for (let i = ids.length - 1; i >= 0; i--) {
    const id = ids[i]
    if (id && !claimed.has(id)) return id
  }
  return null
}

/**
 * Argv that forks `sourceId`, or null (caller opens an ordinary tab) when there
 * is no fork verb, no source id, or the command controls its own session (a
 * second `--resume` makes claude refuse to launch).
 */
export function forkSessionArgvFor(
  identity: EngineSessionIdentity | undefined,
  base: readonly string[],
  sourceId: string,
  newId?: string | null,
): readonly string[] | null {
  if (!sourceId || !identity?.forkArgv) return null
  if (controlsOwnSession(identity, base)) return null
  return identity.forkArgv(base, sourceId, newId)
}

/** True when this engine declares a verb that BRANCHES a conversation. */
export function acceptsSessionFork(identity: EngineSessionIdentity | undefined): boolean {
  return !!identity?.forkArgv
}
