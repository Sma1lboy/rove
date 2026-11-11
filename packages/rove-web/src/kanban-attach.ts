/**
 * Pasted or dropped files in a story description: each is stored on the Mac through
 * `attachment.put` (in parts through `attachment.part` when it is big), and the body gains an `images[N]: /path` line, `files[N]` for a file that is neither image nor PDF (the TUI drawer's contract,
 * `state/issue-chat.ts` `withImagePlaceholders`; copied because that module reaches node-only
 * code). The line persists in the story and rides its first prompt.
 */

import type { BridgeClient } from "./bridge.ts"
import { t } from "./i18n/index.ts"

/** `MAX_UPLOAD_BYTES` in the bridge: bigger files are refused there. */
export const MAX_ATTACHMENT_BYTES = 500 * 1024 * 1024
/** One frame's share of a file: small enough that the socket's other traffic is not held up behind it. */
export const PART_BYTES = 1024 * 1024

export function attachmentLabel(path: string, index: number): string {
  if (/\.pdf$/i.test(path)) return `pdf[${index}]`
  return /\.(png|jpe?g|gif|webp)$/i.test(path) ? `images[${index}]` : `files[${index}]`
}

/** One past the highest index in the draft, so a deleted middle line can't mint a duplicate label. */
export function nextPlaceholderIndex(body: string): number {
  let max = -1
  for (const m of body.matchAll(/^(?:images|pdf|files)\[(\d+)\]:/gm)) {
    const n = Number.parseInt(m[1] as string, 10)
    if (n > max) max = n
  }
  return max + 1
}

export function withImagePlaceholders(body: string, paths: readonly string[]): string {
  let next = body.replace(/\s+$/, "")
  let index = nextPlaceholderIndex(body)
  for (const path of paths) {
    const line = `${attachmentLabel(path, index)}: ${path}`
    next = next.length > 0 ? `${next}\n${line}` : line
    index += 1
  }
  return next
}

function base64(bytes: Uint8Array): string {
  let binary = ""
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

/** Stores one file on the machine running rove, in parts when it is more than one frame's worth. */
export async function storeAttachment(client: BridgeClient, file: File): Promise<{ path: string; kind: string }> {
  // Before reading it: a file the bridge would refuse must not be sent at all.
  if (file.size > MAX_ATTACHMENT_BYTES) throw new Error(t("pages.attachTooLarge", { name: file.name }))
  const meta = { mime: file.type, name: file.name }
  const read = async (from: number, to: number) => base64(new Uint8Array(await file.slice(from, to).arrayBuffer()))
  if (file.size <= PART_BYTES) return client.request("attachment.put", { ...meta, data: await read(0, file.size) })
  let upload: string | undefined
  for (let offset = 0; ; ) {
    const end = Math.min(offset + PART_BYTES, file.size)
    const res = await client.request<{ upload?: string; path?: string; kind?: string }>("attachment.part", {
      ...meta,
      ...(upload ? { upload } : {}),
      offset,
      data: await read(offset, end),
      done: end === file.size,
    })
    if (res.path !== undefined) return { path: res.path, kind: res.kind ?? "file" }
    upload = res.upload
    offset = end
  }
}

/** Stores one file; resolves to its path on the machine running rove. */
export async function putAttachment(client: BridgeClient, file: File): Promise<string> {
  return (await storeAttachment(client, file)).path
}
