/**
 * Toast store — the web UI's one error/notice surface. RPC failures used to
 * be swallowed (`.catch(() => {})`) so a failed rename/archive/create looked
 * like nothing happened; every mutation path now reports here instead.
 * Module-level external store, same persistence semantics as store.ts/tabs.ts.
 */

import { createExternalStore } from "./external-store.ts"

export type ToastKind = "error" | "success" | "info"

export interface Toast {
  id: number
  kind: ToastKind
  message: string
}

const EXPIRE_MS = 5_000
const MAX_TOASTS = 4

const store = createExternalStore<readonly Toast[]>([])
let seq = 0

export function pushToast(kind: ToastKind, message: string): void {
  seq += 1
  const toast: Toast = { id: seq, kind, message }
  store.update((toasts) => [...toasts.slice(-(MAX_TOASTS - 1)), toast])
  window.setTimeout(() => dismissToast(toast.id), EXPIRE_MS)
}

export function dismissToast(id: number): void {
  const toasts = store.getSnapshot()
  if (!toasts.some((t) => t.id === id)) return
  store.replace(toasts.filter((t) => t.id !== id))
}

/** Standard shape for a failed mutation: `label: cause`. An Error contributes
 *  its message; a plain object its JSON (never "[object Object]"); anything
 *  else is stringified. Pure + exported so the contract is testable without
 *  the window-bound toast store. */
export function formatError(label: string, err: unknown): string {
  if (err instanceof Error) return `${label}: ${err.message}`
  const raw = String(err)
  if (raw !== "[object Object]") return `${label}: ${raw}`
  try {
    return `${label}: ${JSON.stringify(err) ?? raw}`
  } catch {
    return `${label}: ${raw}` // circular — raw is the best we have
  }
}

/** Standard shape for a failed mutation: `label: cause`. */
export function reportError(label: string, err: unknown): void {
  pushToast("error", formatError(label, err))
}

export function useToasts(): readonly Toast[] {
  return store.useSnapshot()
}
