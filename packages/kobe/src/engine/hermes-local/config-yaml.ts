/**
 * The one edit Rove makes to Hermes Agent's `config.yaml`: adding (or
 * removing) its plugin from the `plugins.enabled` list. Writing the plugin
 * files is not enough — Hermes loads only what that list names.
 *
 * Line-based, and NARROW on purpose. Rove has no YAML library, and a
 * round-trip through one would reformat a config the user hand-wrote:
 * comments, key order and block style are all theirs. So this recognizes the
 * two shapes it can edit without disturbing anything else and REFUSES
 * everything else, which is the same contract the JSON adapters have for a
 * document they cannot merge into — `rove doctor` names the file, the user's
 * config is never rewritten from a guess.
 *
 * Recognized:
 *   - no top-level `plugins:` key      → append the whole block
 *   - `plugins:` → `enabled:` → `- item` lines  → insert/remove one item
 *   - `plugins:` → `enabled: []`       → expand to a block list (install only)
 *
 * Refused (named in the reason): a flow sequence (`plugins: [a, b]` or
 * `enabled: [a]`), and a `plugins:` block with no `enabled:` key under it.
 *
 * Pure (no I/O) so the shapes are unit-testable as plain strings.
 */

/** The directory name under `plugins/`, which is also the name the list carries. */
export const HERMES_PLUGIN_NAME = "rove-agent-state"

export type HermesConfigEdit =
  | { readonly ok: true; readonly content: string }
  | { readonly ok: false; readonly reason: string }

/** Leading spaces, or undefined for a line that carries no key/item (blank,
 *  comment). Tabs are not YAML indentation, so a tab-indented line is treated
 *  as unrecognized and falls through to the refusal. */
function indentOf(line: string): number | undefined {
  if (!line.trim() || line.trim().startsWith("#")) return undefined
  const match = /^ */.exec(line)
  const indent = match ? match[0].length : 0
  return line[indent] === "\t" ? undefined : indent
}

/** `<indent spaces><key>:` → the key name, else undefined. */
function keyAt(line: string, indent: number): string | undefined {
  if (indentOf(line) !== indent) return undefined
  const match = /^ *([A-Za-z0-9_.-]+):(?:\s|$)/.exec(line)
  return match?.[1]
}

/** The value after `<key>:` on the same line, trimmed; "" when the key opens a block. */
function inlineValue(line: string): string {
  const match = /^ *[A-Za-z0-9_.-]+:(.*)$/.exec(line)
  return (match?.[1] ?? "").trim()
}

/** `- name` (quoted or not) at `indent` → the item, else undefined. */
function listItemAt(line: string, indent: number): string | undefined {
  if (indentOf(line) !== indent) return undefined
  const match = /^ *- *(.*)$/.exec(line)
  if (!match) return undefined
  return match[1].trim().replace(/^["']|["']$/g, "")
}

function join(lines: readonly string[], trailingNewline: boolean): string {
  return lines.join("\n") + (trailingNewline ? "\n" : "")
}

/**
 * Add or remove `{@link HERMES_PLUGIN_NAME}` in `content`'s `plugins.enabled`
 * list. Returns the content unchanged when it is already in the wanted state.
 */
export function setHermesPluginEnabled(content: string, enabled: boolean): HermesConfigEdit {
  const trailingNewline = content.endsWith("\n") || content === ""
  const lines = content.length > 0 ? content.replace(/\n$/, "").split("\n") : []

  const pluginsIndex = lines.findIndex((line) => keyAt(line, 0) === "plugins")
  if (pluginsIndex < 0) {
    if (!enabled) return { ok: true, content }
    const head = content.replace(/\n+$/, "")
    const block = `plugins:\n  enabled:\n    - ${HERMES_PLUGIN_NAME}\n`
    return { ok: true, content: head ? `${head}\n${block}` : block }
  }
  if (inlineValue(lines[pluginsIndex] ?? "") !== "") {
    return { ok: false, reason: '"plugins" is written inline; Rove only edits a block mapping' }
  }

  // The `plugins:` block runs until the next line at indent 0.
  let pluginsEnd = lines.length
  for (let i = pluginsIndex + 1; i < lines.length; i++) {
    if (indentOf(lines[i] ?? "") === 0) {
      pluginsEnd = i
      break
    }
  }

  const enabledIndex = lines.slice(pluginsIndex + 1, pluginsEnd).findIndex((line) => keyAt(line, 2) === "enabled")
  if (enabledIndex < 0) {
    return { ok: false, reason: '"plugins" has no "enabled" key that Rove can add to' }
  }
  const enabledAt = pluginsIndex + 1 + enabledIndex
  const enabledValue = inlineValue(lines[enabledAt] ?? "")

  if (enabledValue === "[]") {
    if (!enabled) return { ok: true, content }
    const next = [...lines]
    next.splice(enabledAt, 1, "  enabled:", `    - ${HERMES_PLUGIN_NAME}`)
    return { ok: true, content: join(next, trailingNewline) }
  }
  if (enabledValue !== "") {
    return { ok: false, reason: '"plugins.enabled" is written inline; Rove only edits a block list' }
  }

  // The list runs until the next KEY at indent 2 or less. A list item is not a
  // key: YAML lets `- item` sit at the same indent as the key that owns it, so
  // stopping at any line indented <= 2 would read a flush list as empty.
  let listEnd = pluginsEnd
  for (let i = enabledAt + 1; i < pluginsEnd; i++) {
    const line = lines[i] ?? ""
    const indent = indentOf(line)
    if (indent !== undefined && indent <= 2 && listItemAt(line, indent) === undefined) {
      listEnd = i
      break
    }
  }

  const itemIndent = (() => {
    for (let i = enabledAt + 1; i < listEnd; i++) {
      const indent = indentOf(lines[i] ?? "")
      if (indent !== undefined && listItemAt(lines[i] ?? "", indent) !== undefined) return indent
    }
    return 4
  })()

  let existing = -1
  for (let i = enabledAt + 1; i < listEnd; i++) {
    if (listItemAt(lines[i] ?? "", itemIndent) === HERMES_PLUGIN_NAME) {
      existing = i
      break
    }
  }

  if (enabled) {
    if (existing >= 0) return { ok: true, content }
    const next = [...lines]
    next.splice(enabledAt + 1, 0, `${" ".repeat(itemIndent)}- ${HERMES_PLUGIN_NAME}`)
    return { ok: true, content: join(next, trailingNewline) }
  }
  if (existing < 0) return { ok: true, content }
  const next = [...lines]
  next.splice(existing, 1)
  return { ok: true, content: join(next, trailingNewline) }
}
