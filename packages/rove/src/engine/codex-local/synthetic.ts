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
 * Deliberately loose after the heading word: Codex emits it with or without
 * `for `, with varying padding, and appends text after `</INSTRUCTIONS>`. A
 * miss makes the auto-titler name the task after the repo's contributor rules.
 * Heading + tag is specific enough.
 */
function isInstructionsEnvelope(text: string): boolean {
  return text.startsWith("# AGENTS.md instructions") && text.includes("<INSTRUCTIONS>")
}
