import { formatBytes } from "@sma1lboy/rove/src/lib/format-bytes.ts"
import { useState } from "react"
import { t } from "../i18n/index.ts"

export interface Thumb {
  readonly id: string
  readonly name: string
  readonly size: number
  /** A picture of an image; without one the block shows the extension. */
  readonly thumb?: string
  /** Still uploading. */
  readonly pending: boolean
}

const BLOCK = "size-14 rounded-sm border-hairline border-line object-cover"

function Face({ name, thumb }: Thumb) {
  if (thumb) return <img src={thumb} alt="" draggable={false} className={BLOCK} />
  const ext = name.includes(".") ? (name.split(".").pop() ?? "") : ""
  return (
    <span className={`${BLOCK} flex items-center justify-center font-mono text-meta uppercase text-muted`}>
      {ext.slice(0, 4) || "file"}
    </span>
  )
}

function Item({ item, onRemove }: { item: Thumb; onRemove: (id: string) => void }) {
  // Only a file added just now rises in; one restored with the draft is simply there.
  const [added] = useState(item.pending)
  return (
    <li
      className={`group relative size-14 shrink-0 ${added ? "motion-safe:animate-rise-in" : ""}`}
      title={`${item.name} · ${formatBytes(item.size)}`}
    >
      <div
        className={`transition-opacity duration-150 motion-reduce:transition-none ${item.pending ? "opacity-50" : ""}`}
      >
        <Face {...item} />
      </div>
      <button
        type="button"
        aria-label={t("newSession.removeAttachment", { name: item.name })}
        className="absolute top-0.5 right-0.5 flex size-5 cursor-pointer items-center justify-center rounded-full border-hairline border-line bg-paper p-0 text-meta leading-none text-ink opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 touch:size-7 touch:opacity-100 touch:after:absolute touch:after:-inset-2 touch:after:content-['']"
        onClick={() => onRemove(item.id)}
      >
        ×
      </button>
    </li>
  )
}

/** What is attached, as small previews above the prompt: no click needed to see an image; × drops one. */
export function AttachThumbs({ items, onRemove }: { items: readonly Thumb[]; onRemove: (id: string) => void }) {
  if (items.length === 0) return null
  return (
    <ul className="m-0 flex min-w-0 list-none flex-wrap gap-1.5 p-0" data-field="attachments">
      {items.map((item) => (
        <Item key={item.id} item={item} onRemove={onRemove} />
      ))}
    </ul>
  )
}
