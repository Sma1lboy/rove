/** Image/PDF attachments for a message: stored on the Mac by `attachment.put`, referenced like the TUI composer does. */

import { type ClipboardEvent, type DragEvent, type ReactNode, useRef, useState } from "react"
import type { AppModel } from "./model.ts"
import { AttachThumbs } from "./ui/attach-thumbs.tsx"

const MIMES = ["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf"]

/** Drop a file on the box, or paste one into its field; text pastes pass through. */
export function fileTargets(attach: (files: File[]) => void) {
  return {
    drop: {
      onDragOver: (e: DragEvent) => e.dataTransfer.types.includes("Files") && e.preventDefault(),
      onDrop: (e: DragEvent) => {
        if (e.dataTransfer.files.length === 0) return
        e.preventDefault()
        attach(Array.from(e.dataTransfer.files))
      },
    },
    onPaste: (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData.files)
      if (files.length === 0) return
      e.preventDefault()
      attach(files)
    },
  }
}

/** A label that opens the system file picker (the phone's photo library): `children` is what it shows. */
export function AttachPicker(props: {
  className: string
  title: string
  disabled?: boolean
  onFiles: (files: File[]) => void
  children: ReactNode
}) {
  return (
    <label className={props.className} title={props.title}>
      {props.children}
      <input
        type="file"
        accept={MIMES.join(",")}
        multiple
        className="sr-only"
        disabled={props.disabled}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          e.target.value = ""
          if (files.length > 0) props.onFiles(files)
        }}
      />
    </label>
  )
}

export interface Attachment {
  readonly id: string
  readonly name: string
  readonly size: number
  readonly mime: string
  /** A small copy of an image, kept with the draft so it shows again after a reload. */
  readonly thumb?: string
  /** Where the Mac stored it; absent while it uploads. */
  readonly path?: string
  readonly kind?: string
}

/** `images[0]: /path` lines, as the TUI appends them to the first prompt. */
export function withRefs(prompt: string, attachments: readonly Attachment[]): string {
  const stored = attachments.filter((a) => a.path !== undefined)
  if (stored.length === 0) return prompt
  const refs = stored.map((a, i) => `${a.kind === "pdf" ? "pdf" : "images"}[${i}]: ${a.path}`).join("\n")
  return `${prompt}\n\n${refs}`
}

async function toBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ""
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

/** Twice the 56px block, for a dense screen. */
const THUMB_PX = 112

async function thumbOf(file: File): Promise<string | undefined> {
  if (!file.type.startsWith("image/")) return undefined
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, THUMB_PX / Math.min(bitmap.width, bitmap.height))
    const canvas = document.createElement("canvas")
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    return canvas.toDataURL("image/webp", 0.8)
  } catch {
    // An image the browser cannot decode still attaches; its block shows the extension.
    return undefined
  }
}

function loadKept(key: string | undefined): readonly Attachment[] {
  if (!key) return []
  try {
    const raw: unknown = JSON.parse(sessionStorage.getItem(key) ?? "[]")
    return Array.isArray(raw) ? (raw as Attachment[]) : []
  } catch {
    return []
  }
}

let nextId = 0

/**
 * Dropped or pasted files that are images or PDFs; anything else is ignored. A file shows at once and uploads behind
 * it; a refusal goes to `onError`. With `keepKey` the stored ones survive a reload of this browser tab.
 */
export function useAttachments(model: AppModel, onError: (message: string) => void, keepKey?: string) {
  const [attachments, setAttachments] = useState<readonly Attachment[]>(() => loadKept(keepKey))
  // The list as of the last change, for `ready` to read after an upload lands and before React renders it.
  const list = useRef(attachments)
  const uploads = useRef(new Set<Promise<void>>())
  const update = (change: (now: readonly Attachment[]) => readonly Attachment[]): void => {
    list.current = change(list.current)
    setAttachments(list.current)
    if (!keepKey) return
    try {
      sessionStorage.setItem(keepKey, JSON.stringify(list.current.filter((a) => a.path !== undefined)))
    } catch {
      // Storage blocked or full: the attachments just do not survive a reload.
    }
  }
  const upload = async (file: File): Promise<void> => {
    const id = `${Date.now()}-${nextId++}`
    const thumb = await thumbOf(file)
    update((now) => [...now, { id, name: file.name, size: file.size, mime: file.type, ...(thumb ? { thumb } : {}) }])
    try {
      const res = await model.client.request<{ path: string; kind: string }>("attachment.put", {
        mime: file.type,
        data: await toBase64(file),
      })
      update((now) => now.map((a) => (a.id === id ? { ...a, path: res.path, kind: res.kind } : a)))
    } catch (err) {
      update((now) => now.filter((a) => a.id !== id))
      onError(err instanceof Error ? err.message : String(err))
    }
  }
  const attach = (files: Iterable<File>): void => {
    for (const file of files) {
      if (!MIMES.includes(file.type)) continue
      const job = upload(file)
      uploads.current.add(job)
      void job.finally(() => uploads.current.delete(job))
    }
  }
  /** The attachments once every upload in flight has landed: what a send waits for. */
  const ready = async (): Promise<readonly Attachment[]> => {
    await Promise.all(uploads.current)
    return list.current
  }
  const remove = (id: string) => update((now) => now.filter((a) => a.id !== id))
  return { attachments, attach, remove, ready, clear: () => update(() => []) }
}

/** The attached files as small previews; a click on × drops one. */
export function AttachmentThumbs(props: { attachments: readonly Attachment[]; onRemove: (id: string) => void }) {
  return (
    <AttachThumbs
      items={props.attachments.map((a) => ({ ...a, pending: a.path === undefined }))}
      onRemove={props.onRemove}
    />
  )
}
