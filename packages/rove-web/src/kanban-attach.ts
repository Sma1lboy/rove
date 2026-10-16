/**
 * Pasted or dropped image/PDF files in a story description: each is stored on the Mac through
 * `attachment.put`, and the body gains an `images[N]: /path` line (the TUI drawer's contract,
 * `state/issue-chat.ts` `withImagePlaceholders`; copied because that module reaches node-only
 * code). The line persists in the story and rides its first prompt.
 */

import type { BridgeClient } from "./bridge.ts"

const MIMES = ["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf"]
/** `MAX_ATTACHMENT_BYTES` in the bridge: bigger files are refused there. */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024

export function attachmentLabel(path: string, index: number): string {
  return /\.pdf$/i.test(path) ? `pdf[${index}]` : `images[${index}]`
}

/** One past the highest index in the draft, so a deleted middle line can't mint a duplicate label. */
export function nextPlaceholderIndex(body: string): number {
  let max = -1
  for (const m of body.matchAll(/^(?:images|pdf)\[(\d+)\]:/gm)) {
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

/** The attachable files of a paste or drop. */
export function attachableFiles(files: FileList | readonly File[] | null | undefined): File[] {
  return Array.from(files ?? []).filter((file) => MIMES.includes(file.type))
}

function base64(bytes: Uint8Array): string {
  let binary = ""
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

/** Stores one file; resolves to its path on the machine running rove. */
export async function putAttachment(client: BridgeClient, file: File): Promise<string> {
  const data = base64(new Uint8Array(await file.arrayBuffer()))
  const res = await client.request<{ path: string }>("attachment.put", { mime: file.type, data })
  return res.path
}
