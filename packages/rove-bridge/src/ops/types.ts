/**
 * The extended op set: every op is one named entry in an area table, wraps exactly one
 * `rove api` verb, daemon RPC or Rove helper, and validates its own arguments. Nothing here
 * forwards a shell string or a caller-chosen verb/argv. Area tables are merged in
 * `ops/index.ts`; the server answers only ops named there or in the core `OPS` list.
 */

import type { DaemonRequestName } from "@sma1lboy/rove-daemon/daemon/protocol"

export type Args = Readonly<Record<string, unknown>>

/** How the bridge reaches Rove: one verb or one RPC per call. Faked in tests. */
export interface BridgeApi {
  /** `rove api <name> <argv>` in-process; refusals keep their stable `code`. */
  verb<T>(name: string, argv: readonly string[]): Promise<T>
  /** A daemon RPC by name. */
  rpc<T>(name: DaemonRequestName, payload?: unknown): Promise<T>
}

export interface OpContext {
  readonly api: BridgeApi
}

export interface OpSpec {
  /** `write` changes Rove state; `read` does not. */
  readonly kind: "read" | "write"
  /**
   * Loses work or is hard to undo (delete, land, remove a worktree, close a tab, change a
   * setting). The app confirms these twice; the bridge logs op + ids for each call.
   */
  readonly destructive: boolean
  /** One-line description for the PR's protocol table: which command it wraps. */
  readonly wraps: string
  run(args: Args, ctx: OpContext): Promise<unknown>
}

export type OpTable = Readonly<Record<string, OpSpec>>
