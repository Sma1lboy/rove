/**
 * Session-identity policy — how an engine answers "what is my current
 * session id" and "how do I resume it", split out of `registry.ts` (the
 * ~500-line cap) alongside its sibling `terminal-title.ts`.
 *
 * Pure on purpose: every function here takes the engine's declared
 * {@link EngineSessionIdentity} rather than a vendor id, so nothing in this
 * file names an engine. The vendor-specific KNOWLEDGE (which flag pins an
 * id, which flag resumes one, whether the id is even knowable at launch) is
 * declared by the adapter that owns it.
 *
 * The id has THREE possible origins, and which one an engine uses is a
 * property of its CLI, not a choice Rove gets to make:
 *
 *   1. PINNED at launch — the CLI accepts a caller-generated id
 *      (`claude --session-id <uuid>`). Rove knows the id before the process
 *      exists, so the tab is trackable from its first frame.
 *   2. READ FROM THE TITLE — the CLI writes its own id into its OSC title
 *      until it has a name for the thread (codex). Declared on
 *      `EngineTerminalTitle.sessionIdFromTitle`, not here.
 *   3. DISCOVERED AFTER THE FACT — the CLI mints its own id and tells no
 *      one, so the only way to learn it is to look in the engine's session
 *      store for what appeared under this worktree (kimi). This is the
 *      weakest source and the one every engine has, because it is exactly
 *      `EngineHistoryReader.listSessionIdsForWorktree`.
 *
 * (3) is why kimi tabs lost their conversation on every restart: with no
 * pin flag and a title that is a sentence rather than an id, nothing ever
 * recorded which session a tab belonged to, so the tab respawned blank.
 */

/**
 * How an engine's CLI handles session identity. Absent on a registry entry
 * = Rove knows no session flags for this engine: its tabs are still named
 * and tracked from whatever id the history store yields, but a restart
 * opens a fresh conversation because there is no verb to resume with.
 */
export interface EngineSessionIdentity {
  /**
   * The flag that pins a CALLER-GENERATED session id at launch
   * (`--session-id <uuid>`), for the engines whose CLI accepts one. Absent
   * = this engine mints its own id and the tab learns it later (origin 2
   * or 3 above) — kimi cannot be told what to call a new session, only
   * asked which sessions exist.
   */
  readonly pinFlag?: string
  /**
   * Flags meaning "this launch command already controls its own session".
   * When the user's `engineCommand.<id>` override carries one, Rove must
   * NOT append its own pin: the engine would either refuse two session
   * controls or silently resume something other than the id we recorded.
   * The user's explicit flag always wins.
   */
  readonly sessionControlFlags?: readonly string[]
  /**
   * Argv that REOPENS `sessionId`'s conversation, given the launch command.
   * A full-argv rewrite rather than a flag pair because the shapes differ
   * in kind, not just spelling: claude and kimi take a flag
   * (`--resume <id>` / `-S <id>`), codex takes a SUBCOMMAND with the id as
   * a positional (`codex resume [opts] <id>`). Probed against the real
   * binaries; see each adapter's declaration.
   *
   * Absent = this engine has no resume verb Rove knows, so a restarted tab
   * honestly starts a new conversation instead of passing a flag that
   * would kill the launch.
   */
  readonly resumeArgv?: (base: readonly string[], sessionId: string) => readonly string[]
}

/**
 * True when `argv` carries `flag` — in EITHER the separated form
 * (`--flag value`) or the attached form (`--flag=value`). Kept local rather
 * than imported from `interactive-command.ts` so this module stays a leaf
 * with no engine-module dependencies. Prefix-safe: `--resume-x` is not
 * `--resume`.
 */
function hasFlag(argv: readonly string[], flag: string): boolean {
  return argv.some((a) => a === flag || a.startsWith(`${flag}=`))
}

/** The launch command already pins or resumes a session of its own. */
export function controlsOwnSession(identity: EngineSessionIdentity | undefined, argv: readonly string[]): boolean {
  return (identity?.sessionControlFlags ?? []).some((flag) => hasFlag(argv, flag))
}

/**
 * Append the engine's session-pin flag with `sessionId`, or return `argv`
 * unchanged when this engine takes no pin (kimi/codex/custom) or the
 * command already controls its session.
 */
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
 * Argv that resumes `sessionId`, or `null` when this engine declares no
 * resume verb or the command already controls its own session (the user's
 * `--resume <other>` must not be overridden by ours). Null means the caller
 * launches the bare command — a fresh conversation, honestly.
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
 * The newest session id in `ids` (oldest-first, per the history-reader
 * contract) that no sibling tab has already claimed.
 *
 * Claim-tracking is what makes discovery safe with more than one tab per
 * worktree. The store answers per-WORKTREE, not per-tab, so two kimi tabs
 * in one task both see the same list; taking the newest unclaimed one
 * gives the second tab the second-newest session instead of both tabs
 * fighting over one conversation. Returns null when every session is
 * spoken for — better a blank tab than a stolen one.
 */
export function pickUnclaimedSessionId(ids: readonly string[], claimed: ReadonlySet<string>): string | null {
  for (let i = ids.length - 1; i >= 0; i--) {
    const id = ids[i]
    if (id && !claimed.has(id)) return id
  }
  return null
}
