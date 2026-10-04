import { samePath } from "../path-identity.ts"

/**
 * Handshake compatibility policy: whether two builds may talk at all.
 * `protocol.ts` owns the wire vocabulary and re-exports everything here;
 * nothing here imports the vocabulary.
 */

/**
 * The handshake negotiates a range (LSP-style): each peer advertises its
 * version and the oldest it still speaks ({@link MIN_COMPATIBLE_PROTOCOL_VERSION});
 * unknown extra fields are ignored. A backward-compatible change bumps this and
 * leaves MIN, so a newer daemon keeps serving an older TUI through a rolling
 * upgrade. Bump MIN only on a breaking change.
 *
 * v3: no `daemon.web.start` / `daemon.web.stop`; browser HTTP/SSE lives on the
 * daemon-owned web transport. A v2 client's `kobe web` gets "unknown daemon
 * request"; everything else interoperates, so MIN stays 2.
 *
 * v4: daemon-hosted PTYs (`pty.*` requests + targeted `pty.data`/`pty.exit`
 * frames). Additive: a newer client against an older daemon gets "unknown
 * daemon request" and falls back to a local PTY. MIN stays 2.
 *
 * v5: `daemon.stopping` carries a {@link import("./protocol").DaemonStopReason}
 * and `daemon.stop` accepts one. Additive: an older daemon still sends `{}`
 * (read as an unlabelled stop) and ignores the extra field; an older client
 * ignores unknown payload fields. MIN stays 2.
 */
export const DAEMON_PROTOCOL_VERSION = 5

/** Oldest protocol version this build can still interoperate with. */
export const MIN_COMPATIBLE_PROTOCOL_VERSION = 2

/** Compatible iff each side's version is at least the other's minimum. Symmetric. */
export function isProtocolCompatible(args: {
  readonly localVersion: number
  readonly localMin: number
  readonly remoteVersion: number
  readonly remoteMin: number
}): boolean {
  return args.remoteVersion >= args.localMin && args.localVersion >= args.remoteMin
}

/**
 * Build-version skew: a patch upgrade keeps the protocol version, so a
 * long-lived daemon still running its boot-time code is otherwise invisible.
 * Compares `hello.kobeVersion` / `daemon.status.kobeVersion` against
 * {@link import("../version").CURRENT_VERSION}.
 *
 * Non-fatal: drives a dismissible restart banner, never an error. A daemon that
 * omits the field is never flagged. Plain string inequality, not semver: a
 * newer or older daemon both warrant a restart.
 */
export function isDaemonVersionStale(daemonVersion: string | undefined, clientVersion: string): boolean {
  if (!daemonVersion) return false
  return daemonVersion !== clientVersion
}

/**
 * Home ownership: a daemon that speaks fine but belongs to a different state
 * root. Happens when an explicit `*_DAEMON_SOCKET_PATH` outranks a sandbox's
 * `*_HOME_DIR` (see `scripts/dev-sandbox-args.ts`): the sandbox daemon binds
 * the production socket and its empty index would render as "No active tasks"
 * while every task sits intact on disk.
 *
 * Fatal, unlike {@link isDaemonVersionStale}: showing another home's data is
 * silent corruption, so the client refuses and keeps reconnecting. A daemon
 * that reports no home is never rejected. Trailing separators are
 * insignificant (`XDG_RUNTIME_DIR` and friends arrive both ways).
 */
export function isForeignDaemonHome(daemonHome: string | undefined, clientHome: string): boolean {
  if (!daemonHome) return false
  return !samePath(daemonHome, clientHome)
}
