import { formatBytes } from "@sma1lboy/rove/src/lib/format-bytes.ts"
import { useEffect, useState } from "react"
import { t } from "../i18n/index.ts"

export interface Thumb {
  readonly id: string
  readonly file: File
}

const BLOCK = "size-14 rounded-sm border-hairline border-line object-cover"

/** The picture itself for an image; the extension for anything else. The object URL lives exactly as long as the block. */
function Face({ file }: { file: File }) {
  const [url, setUrl] = useState<string | null>(null)
  const image = file.type.startsWith("image/")
  useEffect(() => {
    if (!image) return
    const made = URL.createObjectURL(file)
    setUrl(made)
    return () => URL.revokeObjectURL(made)
  }, [file, image])
  if (image) return url && <img src={url} alt="" draggable={false} className={BLOCK} />
  const ext = file.name.includes(".") ? (file.name.split(".").pop() ?? "") : ""
  return (
    <span className={`${BLOCK} flex items-center justify-center font-mono text-meta uppercase text-muted`}>
      {ext.slice(0, 4) || "file"}
    </span>
  )
}

/** What is attached, as small previews above the prompt: no click needed to see an image; × drops one. */
export function AttachThumbs({ items, onRemove }: { items: readonly Thumb[]; onRemove: (id: string) => void }) {
  if (items.length === 0) return null
  return (
    <ul className="m-0 flex min-w-0 list-none flex-wrap gap-1.5 p-0" data-field="attachments">
      {items.map(({ id, file }) => {
        const label = `${file.name} · ${formatBytes(file.size)}`
        return (
          <li key={id} className="group relative size-14 shrink-0" title={label}>
            <Face file={file} />
            <button
              type="button"
              aria-label={t("newSession.removeAttachment", { name: file.name })}
              className="absolute top-0.5 right-0.5 flex size-5 cursor-pointer items-center justify-center rounded-full border-hairline border-line bg-paper p-0 text-meta leading-none text-ink opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 touch:size-7 touch:opacity-100 touch:after:absolute touch:after:-inset-2 touch:after:content-['']"
              onClick={() => onRemove(id)}
            >
              ×
            </button>
          </li>
        )
      })}
    </ul>
  )
}
