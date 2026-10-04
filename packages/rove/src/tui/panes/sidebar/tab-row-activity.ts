/** A tab row reads only its own entry in this task's per-tab ledger. */
export function tabRowActivity<T>(args: {
  readonly tabId: string
  readonly tabActivities: ReadonlyMap<string, T> | undefined
}): T | undefined {
  return args.tabActivities?.get(args.tabId)
}
