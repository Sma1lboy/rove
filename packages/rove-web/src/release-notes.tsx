/**
 * Release notes as the web shows them: the changelog markdown (Changesets output) grouped by
 * scope via `groupReleaseNotes`, rendered as headings, bullets and clickable links. Only the
 * subset the changelog uses — `#` headings, `-` bullets with wrapped continuation lines,
 * `[text](url)`, `` `code` `` and `**bold**` — built as React elements, never as HTML.
 */

import { en as upEn, zh as upZh } from "@sma1lboy/rove/src/i18n/messages/update.ts"
import {
  type BumpGroup,
  type NoteScope,
  WEB_NOTE_CLIENTS,
  groupReleaseNotes,
} from "@sma1lboy/rove/src/lib/release-note-clients.ts"
import type { ReactNode } from "react"
import { useLocale } from "./i18n/index.ts"
import {
  RELEASE_BUMP,
  RELEASE_BUMP_HEAD,
  RELEASE_HEADING,
  RELEASE_MD,
  RELEASE_OTHER,
  RELEASE_OTHER_BODY,
  RELEASE_SCOPE,
  RELEASE_SCOPE_COUNT,
  RELEASE_SCOPE_HEAD,
  RELEASE_SCOPE_TITLE,
} from "./ui/update.ts"

type Block = { kind: "heading" | "item" | "para"; text: string; id: number }

/** Changesets prefixes each entry with the commit's short-sha link and ends it with the author; the PR link stays. */
function trimEntry(text: string): string {
  return text
    .replace(/\[`[0-9a-f]{7,40}`\]\([^)]*\)\s*/g, "")
    .replace(/\s+[—-]\s+\[@[^\]]+\]\([^)]*\)\s*$/, "")
    .trim()
}

export function parseReleaseNotes(body: string): Block[] {
  const blocks: Block[] = []
  const push = (kind: Block["kind"], text: string) => blocks.push({ kind, text, id: blocks.length })
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trimEnd()
    if (line.trim() === "") continue
    const heading = /^#{1,6}\s+(.*)$/.exec(line)
    if (heading) {
      push("heading", heading[1] ?? "")
      continue
    }
    const item = /^\s*[-*]\s+(.*)$/.exec(line)
    if (item) {
      push("item", item[1] ?? "")
      continue
    }
    const last = blocks.at(-1)
    // A wrapped line continues the bullet or paragraph above it.
    if (last && last.kind !== "heading") last.text = `${last.text} ${line.trim()}`
    else push("para", line.trim())
  }
  return blocks.map((block) => (block.kind === "item" ? { ...block, text: trimEntry(block.text) } : block))
}

const INLINE = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|`([^`]+)`|\*\*([^*]+)\*\*/g

export function inlineMarkdown(text: string): ReactNode[] {
  const out: ReactNode[] = []
  let at = 0
  for (const match of text.matchAll(INLINE)) {
    const start = match.index ?? 0
    if (start > at) out.push(text.slice(at, start))
    const [whole, label, url, code, bold] = match
    if (label !== undefined && url !== undefined) {
      out.push(
        <a key={start} href={url} target="_blank" rel="noopener noreferrer">
          {inlineMarkdown(label)}
        </a>,
      )
    } else if (code !== undefined) out.push(<code key={start}>{code}</code>)
    else if (bold !== undefined) out.push(<b key={start}>{bold}</b>)
    at = start + whole.length
  }
  if (at < text.length) out.push(text.slice(at))
  return out
}

/** The web's own scopes (Phone & iPhone app, Web, Background service, untagged) first; the rest fold under one line. */
export function ReleaseNotes({ body }: { body: string }) {
  const u = useLocale() === "zh" ? upZh : upEn
  const notes = groupReleaseNotes(body, WEB_NOTE_CLIENTS)
  const scopeLabel = (scope: NoteScope) => u.scopes[scope]
  return (
    <div className={RELEASE_MD}>
      {notes.preface && <NotesBlocks body={notes.preface} />}
      <GroupedSections groups={notes.own} scopeLabel={scopeLabel} showScopeHeading={notes.hasScopedEntries} />
      {notes.otherCount > 0 && (
        <details className={RELEASE_OTHER}>
          <summary>{u.otherClients.replace("{count}", String(notes.otherCount))}</summary>
          <div className={RELEASE_OTHER_BODY}>
            <GroupedSections groups={notes.other} scopeLabel={scopeLabel} showScopeHeading={notes.hasScopedEntries} />
          </div>
        </details>
      )}
    </div>
  )
}

function GroupedSections({
  groups,
  scopeLabel,
  showScopeHeading,
}: {
  groups: readonly BumpGroup[]
  scopeLabel: (scope: NoteScope) => string
  showScopeHeading: boolean
}) {
  return groups.map((group) => {
    const sections = group.sections.map((section) => (
      <section key={section.scope} className={RELEASE_SCOPE}>
        {showScopeHeading && (
          <div className={RELEASE_SCOPE_HEAD}>
            <span className={RELEASE_SCOPE_TITLE}>{scopeLabel(section.scope)}</span>
            <span className={RELEASE_SCOPE_COUNT}>{section.count}</span>
          </div>
        )}
        <NotesBlocks body={section.entries.join("\n\n")} />
      </section>
    ))
    const key = group.heading ?? group.sections.map((s) => s.scope).join(",")
    if (!group.heading) return <div key={key}>{sections}</div>
    return (
      <div key={key} className={RELEASE_BUMP}>
        <h3 className={RELEASE_BUMP_HEAD}>{group.heading}</h3>
        {sections}
      </div>
    )
  })
}

function NotesBlocks({ body }: { body: string }) {
  const blocks = parseReleaseNotes(body)
  const out: ReactNode[] = []
  let items: ReactNode[] = []
  const flush = () => {
    if (items.length > 0) out.push(<ul key={`ul-${out.length}`}>{items}</ul>)
    items = []
  }
  for (const block of blocks) {
    if (block.kind === "item") {
      items.push(<li key={block.id}>{inlineMarkdown(block.text)}</li>)
      continue
    }
    flush()
    out.push(
      block.kind === "heading" ? (
        <h3 key={block.id} className={RELEASE_HEADING}>
          {block.text}
        </h3>
      ) : (
        <p key={block.id}>{inlineMarkdown(block.text)}</p>
      ),
    )
  }
  flush()
  return out
}
