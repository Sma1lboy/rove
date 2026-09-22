/**
 * Vendor-neutral content blocks (`Message.blocks`, wire and disk). Vendor
 * adapters normalize into this (e.g. `engine/claude-code-local/normalize.ts`).
 *
 * Four kinds, one per UI affordance; `image`, `redacted_thinking` and
 * citations are left out so "we don't render this" is explicit.
 * `tool_result.output` is `unknown` because outputs are tool-specific
 * (string, diff, arbitrary MCP JSON); renderers narrow per tool.
 */

export type ContentBlock =
  | { readonly type: "text"; readonly text: string }
  | {
      readonly type: "tool_call"
      /** Stable id linking a tool_call to its later tool_result. */
      readonly callId: string
      /** Tool name as the vendor reported it (e.g. "Bash", "Edit"). */
      readonly name: string
      /** Vendor-shaped tool args. Renderers narrow per tool. */
      readonly input: unknown
    }
  | {
      readonly type: "tool_result"
      readonly callId: string
      /** Vendor-shaped output. Renderers narrow per tool. */
      readonly output: unknown
      readonly isError: boolean
    }
  | { readonly type: "thinking"; readonly text: string }
