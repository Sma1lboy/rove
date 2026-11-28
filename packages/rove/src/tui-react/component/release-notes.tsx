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

import { type NativeResourceOwner, SyntaxStyle } from "@opentui/core"
import { useRenderer } from "@opentui/react"
import { useMemo, useState } from "react"
import { type BumpGroup, type NoteScope, TUI_NOTE_CLIENTS, groupReleaseNotes } from "../../lib/release-note-clients"
import type { Theme } from "../../tui/context/theme-core"
import { useTheme } from "../context/theme"
import { useT } from "../i18n"
import { releaseNotesMarkdown } from "./release-notes-markdown"

function buildReleaseNotesStyle(theme: Theme, owner: NativeResourceOwner): SyntaxStyle {
  const heading = { fg: theme.accent, bold: true }
  const bumpHeading = { fg: theme.text, bold: true }
  const code = { fg: theme.info }
  return SyntaxStyle.fromStyles(
    {
      "markup.heading": heading,
      "markup.heading.1": bumpHeading,
      "markup.heading.2": bumpHeading,
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
    },
    owner,
  )
}

function renderGroupsMarkdown(
  groups: readonly BumpGroup[],
  scopeLabel: (scope: NoteScope) => string,
  showScopeHeading: boolean,
): string {
  const parts: string[] = []
  for (const group of groups) {
    if (group.heading) parts.push(`## ${group.heading}`)
    for (const section of group.sections) {
      if (showScopeHeading) parts.push(`### ${scopeLabel(section.scope)} (${section.count})`)
      const sep = section.entries.some((e) => e.includes("\n") || e.length > 80) ? "\n\n" : "\n"
      parts.push(section.entries.join(sep))
    }
  }
  return parts.join("\n\n")
}

/** The TUI's own scope sections first; the ones tagged for other clients fold under one clickable line. */
export function ReleaseNotesBody(props: { body: string }) {
  const { theme } = useTheme()
  const t = useT()
  const [open, setOpen] = useState(false)
  const notes = useMemo(() => groupReleaseNotes(releaseNotesMarkdown(props.body), TUI_NOTE_CLIENTS), [props.body])
  const scopeLabel = (scope: NoteScope) => t(`update.scopes.${scope}`)
  const ownContent = [notes.preface, renderGroupsMarkdown(notes.own, scopeLabel, notes.hasScopedEntries)]
    .filter(Boolean)
    .join("\n\n")
  const otherContent = notes.otherCount > 0 ? renderGroupsMarkdown(notes.other, scopeLabel, notes.hasScopedEntries) : ""
  return (
    <box flexDirection="column" gap={1}>
      {ownContent ? <MarkdownText content={ownContent} /> : null}
      {notes.otherCount > 0 ? (
        <text fg={theme.textMuted} wrapMode="word" onMouseUp={() => setOpen((v) => !v)}>
          {open ? "▾" : "▸"} {t("update.otherClients", { count: String(notes.otherCount) })}
        </text>
      ) : null}
      {open && otherContent ? <MarkdownText content={otherContent} /> : null}
    </box>
  )
}

/** Markdown in the theme's release-notes styling; also routine responses. */
export function MarkdownText(props: { content: string }) {
  const { theme } = useTheme()
  const renderer = useRenderer()
  const syntaxStyle = useMemo(() => buildReleaseNotesStyle(theme, renderer.nativeScene), [theme, renderer])
  return <markdown content={props.content} syntaxStyle={syntaxStyle} fg={theme.text} />
}
