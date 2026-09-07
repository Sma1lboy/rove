import { normalizeCodexContent } from "./normalize"

type CodexTextLikeBlock = {
  readonly type: string
  readonly text?: string
}

/**
 * True when every text block in the message is one of Codex's
 * synthetic envelopes. Conservative — anything else mixed in (a user
 * prompt that happens to paste an envelope-shaped string) is preserved.
 */
export function isSyntheticCodexUserRow(blocks: readonly CodexTextLikeBlock[]): boolean {
  if (blocks.length === 0) return false
  for (const b of blocks) {
    if (b.type !== "text") return false
    const t = (b.text ?? "").trim()
    if (!isTagEnvelope(t) && !isInstructionsEnvelope(t)) return false
  }
  return true
}

/**
 * Convert a Codex user-message content payload into visible user text.
 * Synthetic environment/instruction rows return null so callers can
 * keep scanning for the real first user prompt.
 */
export function visibleCodexUserText(content: unknown): string | null {
  const blocks = normalizeCodexContent(content)
  if (isSyntheticCodexUserRow(blocks)) return null
  const text = blocks
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join(" ")
    .trim()
  return text.length > 0 ? text : null
}

/** Codex's whole-message XML-ish envelopes: the row IS the tag. */
const ENVELOPE_TAGS = ["environment_context", "recommended_plugins", "user_instructions"] as const

function isTagEnvelope(text: string): boolean {
  return ENVELOPE_TAGS.some((tag) => text.startsWith(`<${tag}>`) && text.endsWith(`</${tag}>`))
}

/**
 * Codex's AGENTS.md preamble: a markdown heading followed by an
 * `<INSTRUCTIONS>` block.
 *
 * Deliberately loose about everything after the heading word. The previous
 * spelling demanded a trailing `for ` (Codex also emits the heading bare),
 * exact `\n` padding around the tag, and that the message END at
 * `</INSTRUCTIONS>` (real rollouts append more). Each of those made the filter
 * miss, and a missed filter is not silent: the auto-titler takes the
 * transcript's first `role: "user"` record, so the repo's contributor rules
 * became the task's name in the sidebar and in `tasks.json`. The heading plus
 * the tag is specific enough — a genuine prompt has to open with that exact
 * heading and contain an `<INSTRUCTIONS>` block to be dropped.
 */
function isInstructionsEnvelope(text: string): boolean {
  return text.startsWith("# AGENTS.md instructions") && text.includes("<INSTRUCTIONS>")
}
