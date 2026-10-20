/** Image/PDF attachments for a first message: stored on the Mac by `attachment.put`, referenced like the TUI composer does. */

import { useState } from "react"
import type { AppModel } from "./model.ts"

const MIMES = ["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf"]

export interface Attachment {
  readonly path: string
  readonly kind: string
  readonly name: string
}

/** `images[0]: /path` lines, as the TUI appends them to the first prompt. */
export function withRefs(prompt: string, attachments: readonly Attachment[]): string {
  if (attachments.length === 0) return prompt
  const refs = attachments.map((a, i) => `${a.kind === "pdf" ? "pdf" : "images"}[${i}]: ${a.path}`).join("\n")
  return `${prompt}\n\n${refs}`
}

async function toBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ""
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

/** Dropped or pasted files that are images or PDFs; anything else is ignored. A refusal goes to `onError`. */
export function useAttachments(model: AppModel, onError: (message: string) => void) {
  const [attachments, setAttachments] = useState<readonly Attachment[]>([])
  const attach = async (files: Iterable<File>) => {
    for (const file of files) {
      if (!MIMES.includes(file.type)) continue
      try {
        const res = await model.client.request<{ path: string; kind: string }>("attachment.put", {
          mime: file.type,
          data: await toBase64(file),
        })
        setAttachments((now) => [...now, { path: res.path, kind: res.kind, name: file.name || res.path }])
      } catch (err) {
        onError(err instanceof Error ? err.message : String(err))
      }
    }
  }
  const remove = (path: string) => setAttachments((now) => now.filter((x) => x.path !== path))
  return { attachments, attach, remove }
}

/** The attached files as removable chips; a click drops one. */
export function AttachmentChips(props: { attachments: readonly Attachment[]; onRemove: (path: string) => void }) {
  if (props.attachments.length === 0) return null
  return (
    <div className="chips-row" data-field="attachments">
      {props.attachments.map((a, i) => (
        <button
          type="button"
          key={a.path}
          className="chip-button is-active"
          title={a.path}
          onClick={() => props.onRemove(a.path)}
        >
          {a.kind === "pdf" ? "pdf" : "images"}[{i}] ×
        </button>
      ))}
    </div>
  )
}
