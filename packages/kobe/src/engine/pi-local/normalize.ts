/**
 * pi-family session content → neutral content blocks.
 *
 * The pi family's on-disk message shape is its own: a `content` array of
 * `text` / `thinking` / `toolCall` blocks on the assistant side, and a
 * separate `toolResult` message whose `content` is text plus a
 * `toolCallId`/`isError` pair. claude's `tool_use`/`tool_result` spelling is
 * close enough that the mapping is mechanical, which is the point — the
 * neutral union is the contract, the vendor spelling dies here.
 *
 * Dropped silently, same policy as claude's normalizer: `image` blocks (Rove
 * renders no images from history) and any unknown block type.
 */

import type { ContentBlock } from "@/types/content"

/** Coerce a pi `content` field (string | block[]) into neutral blocks. */
export function normalizePiContent(content: unknown): ContentBlock[] {
  if (typeof content === "string") {
    return content.length > 0 ? [{ type: "text", text: content }] : []
  }
  if (!Array.isArray(content)) return []

  const out: ContentBlock[] = []
  for (const block of content) {
    if (typeof block === "string") {
      if (block.length > 0) out.push({ type: "text", text: block })
      continue
    }
    if (!block || typeof block !== "object") continue
    const b = block as Record<string, unknown>

    if (b.type === "text" && typeof b.text === "string") {
      out.push({ type: "text", text: b.text })
      continue
    }
    if (b.type === "thinking" && typeof b.thinking === "string") {
      out.push({ type: "thinking", text: b.thinking })
      continue
    }
    if (b.type === "toolCall" || b.type === "tool_use") {
      out.push({
        type: "tool_call",
        callId: typeof b.id === "string" ? b.id : "",
        name: typeof b.name === "string" ? b.name : "",
        input: b.arguments ?? b.input,
      })
      continue
    }
    if (b.type === "toolResult" || b.type === "tool_result") {
      out.push({
        type: "tool_result",
        callId:
          typeof b.toolCallId === "string" ? b.toolCallId : typeof b.tool_use_id === "string" ? b.tool_use_id : "",
        output: b.content,
        isError: b.isError === true || b.is_error === true,
      })
    }
    // Unknown / image blocks — drop.
  }
  return out
}
