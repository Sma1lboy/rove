/** @jsxImportSource @opentui/react */
/**
 * A GitHub release body as markdown — the one renderer for every
 * release-notes page (update, versions, what's new).
 *
 * Parsing is opentui's `MarkdownRenderable`; this owns the theme mapping:
 * `markup.*` captures render plain unless each has a registered style (same
 * contract as `tui/ops/preview-syntax.ts`).
 *
 * `SyntaxStyle` holds a native handle — built once per theme, not per render.
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
  const content = useMemo(() => releaseNotesMarkdown(props.body), [props.body])
  return <MarkdownText content={content} />
}

/** Markdown in the theme's release-notes styling; also routine responses. */
export function MarkdownText(props: { content: string }) {
  const { theme } = useTheme()
  const syntaxStyle = useMemo(() => buildReleaseNotesStyle(theme), [theme])
  return <markdown content={props.content} syntaxStyle={syntaxStyle} fg={theme.text} />
}
