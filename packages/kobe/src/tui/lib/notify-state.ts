/**
 * Pure map transforms and gating rules behind per-tab completion notifications
 * (`src/tui-react/context/notifications.tsx`): the escalation rule
 * (needs_input / error outrank done) and "error toasts always show" live here once.
 */

export type NotificationKind = "done" | "needs_input" | "error"

export interface Toast {
  readonly id: number
  readonly kind: NotificationKind
  readonly taskId: string
  readonly tabId: string
  readonly title: string
  /** Optional context line under the title (task title, project…). */
  readonly body?: string
}

export interface NotifyInput {
  readonly kind: NotificationKind
  readonly taskId: string
  readonly tabId: string
  readonly title: string
  /** Optional context line under the title (task title, project…). */
  readonly body?: string
}

export const TOAST_DURATION_MS = 4500

export function unreadKey(taskId: string, tabId: string): string {
  return `${taskId}:${tabId}`
}

/** needs_input / error outrank `done` for the same uncleared key; returns `prev` then. */
export function addUnread(
  prev: ReadonlyMap<string, NotificationKind>,
  input: NotifyInput,
): ReadonlyMap<string, NotificationKind> {
  const key = unreadKey(input.taskId, input.tabId)
  const existing = prev.get(key)
  if (existing === "needs_input" || existing === "error") return prev
  const next = new Map(prev)
  next.set(key, input.kind)
  return next
}

export function removeUnread(
  prev: ReadonlyMap<string, NotificationKind>,
  taskId: string,
  tabId: string,
): ReadonlyMap<string, NotificationKind> {
  const key = unreadKey(taskId, tabId)
  if (!prev.has(key)) return prev
  const next = new Map(prev)
  next.delete(key)
  return next
}

/**
 * `error` always shows: failure feedback must not vanish into the daemon log
 * because the user disabled the completion "Toast" preference.
 */
export function shouldShowToast(kind: NotificationKind, toastEnabled: boolean): boolean {
  return kind === "error" || toastEnabled
}

/**
 * Task-level `TaskActivityState` → kind; null = don't notify.
 * permission_needed → needs_input; error / rate_limited / dead → error;
 * turn_complete → done. These are the daemon's `ATTENTION_INBOX_STATES`, so
 * every pending Inbox episode announces itself, symmetric with the chip
 * notifier. String-typed so the caller needn't import the notify enum.
 */
export function attentionKindFor(state: string): NotificationKind | null {
  if (state === "permission_needed") return "needs_input"
  if (state === "error" || state === "rate_limited" || state === "dead") return "error"
  if (state === "turn_complete") return "done"
  return null
}

/** Tab-chip (`ChatTabTurnState`) twin of {@link attentionKindFor}; idle/running/unknown → null. */
export function chipAttentionKind(turn: string): NotificationKind | null {
  if (turn === "done") return "done"
  // The chip keeps these apart so the GLYPH can; a toast has three kinds and
  // all three mean "something needs you".
  if (turn === "error" || turn === "rate_limited" || turn === "dead") return "error"
  if (turn === "needs_input") return "needs_input"
  return null
}

/**
 * Rising-edge detector shared by both notifiers: keys whose value transitioned
 * INTO an attention state per `kindFor`.
 *  - Seed: `prev === null` (first observation, or a replay including sticky
 *    states like `turn_complete`) returns []; replayed history must not toast.
 *  - Edge: an unchanged value never notifies.
 * `skip` is the key already on screen (selected task / active tab); that
 * disjointness makes double-toasting impossible by construction.
 */
export function attentionEdges(
  prev: ReadonlyMap<string, string> | null,
  next: ReadonlyMap<string, string>,
  skip: string | null,
  kindFor: (state: string) => NotificationKind | null,
): readonly { key: string; kind: NotificationKind }[] {
  if (prev === null) return []
  const out: { key: string; kind: NotificationKind }[] = []
  for (const [key, state] of next) {
    if (key === skip) continue
    if (prev.get(key) === state) continue
    const kind = kindFor(state)
    if (kind) out.push({ key, kind })
  }
  return out
}

function sanitizeOscBody(body: string): string {
  let out = ""
  let segmentStart = 0
  for (let i = 0; i < body.length; i++) {
    const code = body.charCodeAt(i)
    if (code > 0x1f && (code < 0x7f || code > 0x9f)) continue
    out += `${body.slice(segmentStart, i)} `
    segmentStart = i + 1
  }
  return segmentStart === 0 ? body : out + body.slice(segmentStart)
}

/**
 * OSC 9 desktop notification: iTerm2 / kitty / WezTerm / Ghostty show it
 * natively, others ignore it, and it travels over SSH to the user's LOCAL
 * terminal (unlike a remote `afplay`). BEL-terminated; control chars in the
 * body become spaces.
 */
export function osc9(body: string): string {
  return `\x1b]9;${sanitizeOscBody(body)}\x07`
}
