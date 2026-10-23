/**
 * Migrated children whose conversation is still a hosted PTY keyed under their
 * parent (`Task.ptyAlias`): the key arithmetic that teardown, the boot sweep
 * and the tab joins share.
 */

export interface AliasRef {
  readonly taskId: string
  readonly tabId: string
}

/** The slice of a task row the alias rules read. */
export interface AliasTask {
  readonly id: string
  readonly ptyAlias?: AliasRef | null
  /** Present while deletion is queued, running or failed: the row is on its way out. */
  readonly deletion?: unknown
}

/** PTY keys a task's teardown changes: `spare` survives it, `also` dies with it. */
export interface TeardownScope {
  readonly spare: readonly string[]
  readonly also: readonly string[]
}

export const aliasKey = (alias: AliasRef): string => `${alias.taskId}::${alias.tabId}`

/** `key` is `base` itself or one of its split leaves (`<base>::leaf-N`). */
export function isUnderKey(key: string, base: string): boolean {
  return key === base || key.startsWith(`${base}::`)
}

/** Every key an alias names, for owners that only know a PTY by its key. */
export function aliasedKeys(tasks: readonly AliasTask[]): string[] {
  return tasks.flatMap((task) => (task.ptyAlias ? [aliasKey(task.ptyAlias)] : []))
}

/**
 * What tearing down task `taskId` must leave alone and also take: a surviving
 * child's conversation living under `taskId`'s key survives; `taskId`'s own
 * aliased conversation dies with it. `leaving` = every id going away with it.
 */
export function teardownScope(
  tasks: readonly AliasTask[],
  taskId: string,
  leaving: ReadonlySet<string>,
): TeardownScope {
  const spare = tasks
    .filter((t) => t.ptyAlias?.taskId === taskId && !leaving.has(t.id) && !t.deletion)
    .map((t) => aliasKey(t.ptyAlias as AliasRef))
  const own = tasks.find((t) => t.id === taskId)?.ptyAlias
  return { spare, also: own && own.taskId !== taskId ? [aliasKey(own)] : [] }
}

/**
 * Whose PTYs a task's liveness, tab reads and prompt routing cover. A migrated
 * child's conversation is a hosted PTY keyed under its parent: the child reads
 * it there (`alias`), and no other task counts it (`claimed`).
 */
export interface PtyScope {
  /** The task's own aliased PTY, when it is a migrated child. */
  readonly alias?: AliasRef
  /** Every task's aliased PTY key: sessions that belong to a child, not to the task named by the key. */
  readonly claimed?: readonly string[]
}

/** The scope of `taskId` among `tasks`. */
export function ptyScopeFor(tasks: readonly AliasTask[], taskId: string): PtyScope {
  const alias = tasks.find((t) => t.id === taskId)?.ptyAlias
  return { ...(alias ? { alias } : {}), claimed: aliasedKeys(tasks) }
}

/** `sessions` minus those another task's alias claims (this task's own alias stays). */
export function unclaimedSessions<T extends { readonly key: string }>(
  sessions: readonly T[],
  scope: PtyScope | undefined,
): T[] {
  const own = scope?.alias ? aliasKey(scope.alias) : undefined
  const foreign = (scope?.claimed ?? []).filter((base) => base !== own)
  return sessions.filter((s) => !foreign.some((base) => isUnderKey(s.key, base)))
}

/**
 * The hosted key of `taskId`'s tab `tabId`: a migrated child's aliased tab is the
 * parent-keyed PTY. `null` when another task's alias claims that key.
 */
export function hostedKeyFor(taskId: string, tabId: string, scope: PtyScope | undefined): string | null {
  if (scope?.alias && scope.alias.tabId === tabId) return aliasKey(scope.alias)
  const key = `${taskId}::${tabId}`
  return unclaimedSessions([{ key }], scope).length > 0 ? key : null
}
