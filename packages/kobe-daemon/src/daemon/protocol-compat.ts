/**
 * Handshake compatibility POLICY: whether two builds may talk to each other
 * at all. Split out of `protocol.ts`, which owns the wire VOCABULARY (frames,
 * request names, task serialization) — that half changes on every new RPC,
 * this half only when the protocol version, the build-skew rule, or the
 * home-ownership rule moves. Nothing here imports the vocabulary.
 *
 * `protocol.ts` re-exports every symbol below, so importers keep using
 * `daemon/protocol`.
 */

/**
 * The handshake negotiates a COMPATIBILITY RANGE rather than requiring an
 * exact match (LSP-style): each peer advertises its current version plus the oldest
 * version it can still talk to ({@link MIN_COMPATIBLE_PROTOCOL_VERSION}),
 * and unknown extra fields are ignored. A backward-compatible change bumps
 * `DAEMON_PROTOCOL_VERSION` while leaving `MIN_COMPATIBLE_PROTOCOL_VERSION`
 * put, so a newer daemon keeps serving a slightly-older TUI through a
 * rolling upgrade instead of hard-rejecting it. Bump the MIN only on a
 * breaking change.
 *
 * v3: no `daemon.web.start` / `daemon.web.stop` in the socket protocol.
 * Browser HTTP/SSE lives on the daemon-owned web transport instead of a
 * socket RPC that starts/stops routes. A v2 client's `kobe web` gets a clear
 * "unknown daemon request" error; everything else still interoperates, so MIN
 * stays 2.
 *
 * v4: daemon-hosted PTYs (`pty.*` requests + targeted `pty.data`/`pty.exit`
 * event frames). Additive — an older client never sends `pty.*`, a newer
 * client against an older daemon gets "unknown daemon request" and falls back
 * to a local PTY — so MIN stays 2.
 *
 * v5: the `daemon.stopping` lifecycle frame carries a
 * {@link import("./protocol").DaemonStopReason} payload, and `daemon.stop`
 * accepts one. Additive on both sides of the wire: an older DAEMON keeps
 * broadcasting the `{}` it always sent (a newer client reads that as an
 * unlabelled stop) and ignores the extra `daemon.stop` field, while an older
 * CLIENT ignores payload fields it does not know. MIN stays 2.
 */
export const DAEMON_PROTOCOL_VERSION = 5

/** Oldest protocol version this build can still interoperate with. */
export const MIN_COMPATIBLE_PROTOCOL_VERSION = 2

/**
 * Two protocol peers are compatible iff EACH side's current version is at
 * least the OTHER side's minimum-supported version. Symmetric; unknown
 * extra hello fields are ignored by the caller. Pure — unit-tested.
 */
export function isProtocolCompatible(args: {
  readonly localVersion: number
  readonly localMin: number
  readonly remoteVersion: number
  readonly remoteMin: number
}): boolean {
  return args.remoteVersion >= args.localMin && args.localVersion >= args.remoteMin
}

/**
 * Build-version skew check (KOB) — distinct from the protocol check above.
 * The protocol range only catches a BREAKING wire change; a normal patch
 * upgrade keeps the same protocol version, so a stale-build daemon (the user
 * upgraded the binary but the long-lived daemon is still running the code it
 * booted with) is otherwise invisible. This compares the daemon's reported build
 * version (`hello.kobeVersion` / `daemon.status`'s `kobeVersion`) against the
 * client's own {@link import("../version").CURRENT_VERSION}.
 *
 * NON-FATAL by design: a mismatch means "the code is stale, restart it", not
 * "these two can't talk" — so this only drives a dismissible banner, never a
 * thrown error. Returns `false` when the daemon's version is unknown (an older
 * daemon that predates this field omits it), so an old daemon never produces a
 * false "stale" signal — it just goes unflagged.
 *
 * Pure — unit-tested. A plain string inequality (not semver) is intentional:
 * any difference at all — newer OR older daemon — is worth a restart prompt,
 * and the build versions are the package.json strings on both sides.
 */
export function isDaemonVersionStale(daemonVersion: string | undefined, clientVersion: string): boolean {
  if (!daemonVersion) return false
  return daemonVersion !== clientVersion
}

/**
 * Home-ownership check — the third, and bluntest, `hello` guard.
 *
 * The protocol range catches a breaking wire change and the build-version
 * check catches stale code; neither notices a daemon that speaks perfectly but
 * belongs to a DIFFERENT state root. That happens whenever an explicit
 * `*_DAEMON_SOCKET_PATH` outranks a sandbox's `*_HOME_DIR` (see
 * `scripts/dev-sandbox-args.ts`): the sandbox daemon binds the production
 * socket and answers `hello` with its own empty task index, which the TUI
 * would otherwise render as a truthful "No active tasks" while every task
 * sits intact on disk.
 *
 * FATAL by design, unlike {@link isDaemonVersionStale}: serving another home's
 * data is silent corruption of what the user sees, so the client refuses the
 * connection and keeps reconnecting rather than trusting the payload.
 *
 * Returns `false` when the daemon reports no home (one that predates the
 * field), so an older daemon is never falsely rejected. Trailing separators
 * are insignificant — `XDG_RUNTIME_DIR` and friends arrive both ways.
 *
 * Pure — unit-tested.
 */
export function isForeignDaemonHome(daemonHome: string | undefined, clientHome: string): boolean {
  if (!daemonHome) return false
  const strip = (value: string): string => value.replace(/[/\\]+$/, "")
  return strip(daemonHome) !== strip(clientHome)
}
