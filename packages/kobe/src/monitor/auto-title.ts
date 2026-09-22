/**
 * Task title from the session transcript. Rove never sees the prompt typed
 * into the interactive engine, so the title is the FIRST user message of the
 * origin session, truncated by `deriveTitleFromPrompt` (no model call).
 *
 * The task's `vendor` resolves an `EngineHistoryReader` returning neutral
 * `Message[]`, so extraction is vendor-neutral. A custom engine gets the EMPTY
 * reader and keeps its placeholder rather than mis-reading claude transcripts.
 */

import { protocolEntry } from "@/engine/engine-presets"
import { deriveTitleFromPrompt } from "@/orchestrator/title"
import type { Message } from "@/types/engine"
import { DEFAULT_TASK_VENDOR, type VendorId } from "@/types/task"

const MAX_SESSIONS_SCANNED = 8

/** First user message's text, truncated to a title, or `""` if none yet. */
function titleFromMessages(messages: readonly Message[]): string {
  const firstUser = messages.find((m) => m.role === "user")
  if (!firstUser) return ""
  const text = firstUser.blocks
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join(" ")
  const title = deriveTitleFromPrompt(text)
  // Force-copy before it enters the daemon's task store: in JSC (Bun) a slice
  // SHARES the parent's buffer, so the title would pin the whole (maybe huge)
  // first prompt for the daemon's lifetime.
  return title.length > 0 ? Buffer.from(title, "utf8").toString("utf8") : title
}

/** Title for the task at `worktree`, or `""` (keep the placeholder). Missing files return `""`. */
export async function deriveTitleFromSession(
  worktree: string,
  vendor: VendorId = DEFAULT_TASK_VENDOR,
): Promise<string> {
  if (!worktree) return ""
  const { history } = protocolEntry(vendor)
  const ids = await history.listSessionIdsForWorktree(worktree)
  // Oldest-first, first usable title wins: the earliest session's opening
  // "user" record can be non-text (tool result, slash-command echo). Capped.
  for (const sessionId of ids.slice(0, MAX_SESSIONS_SCANNED)) {
    const title = titleFromMessages(await history.readHistory(sessionId))
    if (title) return title
  }
  return ""
}

/**
 * Title for ONE session id (the per-ChatTab auto-namer knows it via claude
 * `--session-id`), or `""`. `readHistory` finds it by id, so no worktree is
 * needed. Never throws.
 */
export async function deriveTitleFromSessionId(vendor: VendorId, sessionId: string): Promise<string> {
  if (!sessionId) return ""
  try {
    return titleFromMessages(await protocolEntry(vendor).history.readHistory(sessionId))
  } catch {
    return ""
  }
}
