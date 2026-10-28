/**
 * Pictures, files and videos a person sends the bot. iLink hands over only a
 * CDN reference: the bytes are AES-128-ECB ciphertext on WeChat's CDN and the
 * item carries the key. They are saved to disk so the agent can open them by
 * path. Wire format as in Tencent's MIT-licensed `@tencent-weixin/openclaw-weixin`.
 */

import { createDecipheriv } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { FetchFn, IlinkCdnMedia, IlinkItem, IlinkMessage } from "./ilink.ts"

export const CDN_BASE_URL = "https://novac2c.cdn.weixin.qq.com/c2c"
const MAX_BYTES = 100 * 1024 * 1024
const DOWNLOAD_TIMEOUT_MS = 60_000

const ITEM_IMAGE = 2
const ITEM_FILE = 4
const ITEM_VIDEO = 5

export type MediaKind = "image" | "file" | "video"

export interface MediaRef {
  readonly kind: MediaKind
  readonly media: IlinkCdnMedia
  /** base64; absent = the bytes are stored in the clear. */
  readonly aesKey?: string
  readonly fileName?: string
}

export interface SavedMedia {
  readonly kind: MediaKind
  readonly path: string
}

function mediaRef(item: IlinkItem): MediaRef | null {
  const ref = (kind: MediaKind, media: IlinkCdnMedia | undefined, aesKey?: string, fileName?: string) =>
    media && (media.full_url || media.encrypt_query_param)
      ? { kind, media, ...(aesKey ? { aesKey } : {}), ...(fileName ? { fileName } : {}) }
      : null
  switch (item.type) {
    case ITEM_IMAGE: {
      const image = item.image_item
      const hexKey = image?.aeskey ? Buffer.from(image.aeskey, "hex").toString("base64") : undefined
      return ref("image", image?.media, hexKey ?? image?.media?.aes_key)
    }
    case ITEM_FILE:
      return ref("file", item.file_item?.media, item.file_item?.media?.aes_key, item.file_item?.file_name)
    case ITEM_VIDEO:
      return ref("video", item.video_item?.media, item.video_item?.media?.aes_key)
    default:
      return null
  }
}

/** Every picture, file and video in the message; with none, the media of the message it quotes. */
export function messageMedia(message: IlinkMessage): MediaRef[] {
  const items = message.item_list ?? []
  const own = items.map(mediaRef).filter((ref) => ref !== null)
  if (own.length > 0) return own
  for (const item of items) {
    const quoted = item.ref_msg?.message_item && mediaRef(item.ref_msg.message_item)
    if (quoted) return [quoted]
  }
  return []
}

/** Images send base64(16 raw bytes); files and videos base64(32 hex chars). */
function aesKeyBytes(aesKey: string): Buffer {
  const decoded = Buffer.from(aesKey, "base64")
  if (decoded.length === 16) return decoded
  const hex = decoded.toString("ascii")
  if (/^[0-9a-fA-F]{32}$/.test(hex)) return Buffer.from(hex, "hex")
  throw new Error(`unusable media key (${decoded.length} bytes)`)
}

export async function downloadMedia(ref: MediaRef, fetchFn: FetchFn, cdnBaseUrl = CDN_BASE_URL): Promise<Buffer> {
  const url =
    ref.media.full_url ??
    `${cdnBaseUrl}/download?encrypted_query_param=${encodeURIComponent(ref.media.encrypt_query_param ?? "")}`
  const res = await fetchFn(url, { method: "GET", signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`CDN answered ${res.status}`)
  if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) throw new Error("larger than 100 MB")
  const bytes = Buffer.from(await res.arrayBuffer())
  if (bytes.length > MAX_BYTES) throw new Error("larger than 100 MB")
  if (!ref.aesKey) return bytes
  const decipher = createDecipheriv("aes-128-ecb", aesKeyBytes(ref.aesKey), null)
  return Buffer.concat([decipher.update(bytes), decipher.final()])
}

function imageExtension(bytes: Buffer): string {
  if (bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return "png"
  if (bytes.subarray(0, 3).toString("ascii") === "GIF") return "gif"
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP")
    return "webp"
  return "jpg"
}

/** `stem` keeps names unique; a sent file keeps its own name after it, minus anything path-like. */
function fileNameFor(ref: MediaRef, bytes: Buffer, stem: string): string {
  if (ref.kind === "image") return `${stem}.${imageExtension(bytes)}`
  if (ref.kind === "video") return `${stem}.mp4`
  const own = (ref.fileName ?? "").replace(/[/\\\0]/g, "_").replace(/^\.+/, "")
  return own ? `${stem}-${own}` : `${stem}.bin`
}

/**
 * Download every media item of `message` into `dir`. A failed item is
 * reported, never thrown: the message's text still goes through.
 */
export async function saveInboundMedia(
  message: IlinkMessage,
  dir: string,
  stem: string,
  fetchFn: FetchFn,
  cdnBaseUrl = CDN_BASE_URL,
): Promise<{ readonly saved: SavedMedia[]; readonly failed: Array<{ kind: MediaKind; reason: string }> }> {
  const saved: SavedMedia[] = []
  const failed: Array<{ kind: MediaKind; reason: string }> = []
  const refs = messageMedia(message)
  for (const [i, ref] of refs.entries()) {
    try {
      const bytes = await downloadMedia(ref, fetchFn, cdnBaseUrl)
      mkdirSync(dir, { recursive: true, mode: 0o700 })
      const path = join(dir, fileNameFor(ref, bytes, refs.length > 1 ? `${stem}-${i + 1}` : stem))
      writeFileSync(path, bytes, { mode: 0o600 })
      saved.push({ kind: ref.kind, path })
    } catch (err) {
      failed.push({ kind: ref.kind, reason: err instanceof Error ? err.message : String(err) })
    }
  }
  return { saved, failed }
}
