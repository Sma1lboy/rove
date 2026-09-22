/** @jsxImportSource @opentui/react */
/**
 * A GitHub release body, rendered as markdown. The one entry point for
 * every page that shows release notes (update, versions, what's new) —
 * they all mount this, so the three stay in step.
 *
 * opentui ships a `MarkdownRenderable` (tree-sitter markdown + inline
 * grammars, `conceal` on) — the headings, nested bullets, `code`, fences
 * and emphasis a Changesets body uses are all its job, so there is no
 * parser here. What this file owns is the theme mapping: the grammar
 * emits `markup.*` capture groups and renders them plain unless each one
 * has a registered style, the same contract `tui/ops/preview-syntax.ts`
 * fills in for code previews.
 *
 * `SyntaxStyle` holds a native handle, so it is built once per theme and
 * not per render.
 */

import { SyntaxStyle } from "@opentui/core"
import { useMemo } from "react"
import type { Theme } from "../../tui/context/theme-core"
import { useTheme } from "../context/theme"
import { releaseNotesMarkdown } from "./release-notes-markdown"

function buildReleaseNotesStyle(theme: Theme): SyntaxStyle {
  const heading = { fg: theme.accent, bold: true }
  const code = { fg: theme.info }
  return SyntaxStyle.fromStyles({
    "markup.heading": heading,
    "markup.heading.1": heading,
    "markup.heading.2": heading,
    "markup.heading.3": heading,
    "markup.heading.4": heading,
    "markup.heading.5": heading,
    "markup.heading.6": heading,
    "markup.strong": { fg: theme.text, bold: true },
    "markup.italic": { italic: true },
    "markup.strikethrough": { fg: theme.textMuted, dim: true },
    "markup.raw": code,
    "markup.raw.block": code,
    "markup.list": { fg: theme.textMuted },
    "markup.list.checked": { fg: theme.success },
    "markup.list.unchecked": { fg: theme.textMuted },
    "markup.quote": { fg: theme.textMuted, italic: true },
    // Links keep their label and lose their address (see
    // `release-notes-markdown.ts`); the label still reads as a reference.
    "markup.link": { fg: theme.info },
    "markup.link.label": { fg: theme.info },
    "markup.link.url": { fg: theme.textMuted, dim: true },
  })
}

export function ReleaseNotesBody(props: { body: string }) {
  const { theme } = useTheme()
  const syntaxStyle = useMemo(() => buildReleaseNotesStyle(theme), [theme])
  const content = useMemo(() => releaseNotesMarkdown(props.body), [props.body])
  return <markdown content={content} syntaxStyle={syntaxStyle} fg={theme.text} />
}
