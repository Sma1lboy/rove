/**
 * Codex's OSC title. Rove launches codex with
 * `-c tui.terminal_title=["activity","thread-title"]`, but an unnamed thread's
 * title is its bare UUID (observed on codex 0.147) — an id, not a label. It
 * names the rollout in `~/.codex/sessions/**`, so
 * `EngineTerminalTitle.sessionIdFromTitle` reads a non-null answer as "don't
 * show this; name the tab from this session instead".
 */

/** UUID shape (version nibble not pinned). Whole-string: a title merely
 *  containing a uuid is still a name. */
const CODEX_THREAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The thread id this title IS, or null once codex names the thread. The
 *  caller already stripped the spinner prefix; only whitespace is trimmed. */
export function codexSessionIdFromTitle(title: string): string | null {
  const trimmed = title.trim()
  return CODEX_THREAD_ID.test(trimmed) ? trimmed.toLowerCase() : null
}
