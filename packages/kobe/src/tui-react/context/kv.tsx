/** @jsxImportSource @opentui/react */
/**
 * React side of the KV store; persistence lives in `./kv-core`. The context
 * value is rebuilt per snapshot, so every consumer re-renders on any `kv.set`.
 * `store` is the immutable snapshot, not a fine-grained proxy.
 */

import { type ReactNode, createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react"
import { type KvCore, type KvWriteErrorListener, createKvCore } from "./kv-core"

export type KVContext = {
  readonly ready: boolean
  readonly store: Record<string, unknown>
  signal<T>(name: string, defaultValue: T): readonly [() => T, (next: T) => void]
  get(key: string, defaultValue?: unknown): unknown
  set(key: string, value: unknown): void
  /** Synchronously flush pending state (standalone pages, before exit). */
  flush(): boolean
  /** Wipe every persisted key; false leaves state and pending edits intact. */
  clear(): boolean
  /**
   * A subscription, not a constructor callback: the toast sink sits below
   * this provider (Theme > KV > Focus > Dialog > Notifications, see
   * `lib/host-boot.tsx`).
   */
  onWriteError(listener: KvWriteErrorListener): () => void
}

const Ctx = createContext<KVContext | null>(null)

export function KVProvider(props: { children?: ReactNode }) {
  const [core] = useState<KvCore>(createKvCore)
  const snapshot = useSyncExternalStore(core.subscribe, core.snapshot, core.snapshot)

  // Every quit path ends synchronously inside the 250ms debounce, so flush on
  // "exit" (fires on process.exit, unlike "beforeExit") or e.g. a just-set
  // seen mark is lost. Removed on unmount so render-test providers don't pile up.
  useEffect(() => {
    const flush = (): void => {
      core.flush()
    }
    process.on("exit", flush)
    return () => {
      process.off("exit", flush)
    }
  }, [core])

  const value = useMemo<KVContext>(
    () => ({
      ready: true,
      store: snapshot,
      signal<T>(name: string, defaultValue: T) {
        core.seed(name, defaultValue)
        return [() => (core.get(name) ?? defaultValue) as T, (next: T) => core.set(name, next)] as const
      },
      get: core.get,
      set: core.set,
      flush: core.flush,
      clear: core.clear,
      onWriteError: core.onWriteError,
    }),
    [core, snapshot],
  )

  return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>
}

export function useKV(): KVContext {
  const value = useContext(Ctx)
  if (!value) throw new Error("KV context must be used within a context provider")
  return value
}

/**
 * Null without a provider, for components with a live fallback. `useKV`
 * stays the throwing default so real kv users fail loud, not lose settings.
 */
export function useOptionalKV(): KVContext | null {
  return useContext(Ctx) ?? null
}
