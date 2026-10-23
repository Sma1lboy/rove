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
