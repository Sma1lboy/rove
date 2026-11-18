/** The labels a plugin or an agent put on a task row (`rove api row-token`), in the row's chip cluster. */

import type { RowTokenChip } from "rove-bridge/protocol"

/** A token's tone is a role; the theme's token of that name colours it. */
const TONE: Readonly<Record<string, string>> = {
  info: "text-info",
  success: "text-success",
  warning: "text-warning",
  error: "text-error",
}

export function RowTokens(props: { tokens: readonly RowTokenChip[] | undefined }) {
  return props.tokens?.map((token) => (
    <span
      key={`${token.source}:${token.text}`}
      className={`max-w-32 truncate ${TONE[token.tone ?? ""] ?? "text-subtle"}`}
      title={token.source}
    >
      {token.text}
    </span>
  ))
}
