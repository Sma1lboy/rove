/**
 * Pictures, files and videos to and from WeChat. iLink moves only CDN
 * references: the bytes are AES-128-ECB ciphertext on WeChat's CDN and the
 * message item carries the key. Inbound media is saved to disk so the agent
 * can open it by path; outbound media is encrypted and uploaded before its
 * item is sent. Wire format as in Tencent's MIT-licensed `@tencent-weixin/openclaw-weixin`.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { basename, extname, join } from "node:path"
import {
  type FetchFn,
  type IlinkCdnMedia,
  type IlinkClient,
  type IlinkItem,
  type IlinkMessage,
  classifyIlink,
  describeIlink,
} from "./ilink.ts"

export const CDN_BASE_URL = "https://novac2c.cdn.weixin.qq.com/c2c"
const MAX_BYTES = 100 * 1024 * 1024
const DOWNLOAD_TIMEOUT_MS = 60_000
const UPLOAD_TIMEOUT_MS = 60_000
const UPLOAD_ATTEMPTS = 3

const ITEM_IMAGE = 2
const ITEM_FILE = 4
const ITEM_VIDEO = 5

export type MediaKind = "image" | "file" | "video"

/** `getuploadurl`'s media_type: a different numbering from the message item types. */
const UPLOAD_TYPE: Record<MediaKind, number> = { image: 1, video: 2, file: 3 }
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"])
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".m4v"])

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

/** Pictures and videos by extension; anything else (a .md, a .pdf, a zip) goes as a file. */
export function attachmentKind(path: string): MediaKind {
  const ext = extname(path).toLowerCase()
  return IMAGE_EXTENSIONS.has(ext) ? "image" : VIDEO_EXTENSIONS.has(ext) ? "video" : "file"
}

/** POST ciphertext to the CDN; its `x-encrypted-param` header is the download reference. A 4xx is final. */
async function postToCdn(fetchFn: FetchFn, url: string, body: Buffer): Promise<string> {
  let last: unknown
  for (let attempt = 1; attempt <= UPLOAD_ATTEMPTS; attempt++) {
    try {
      const res = await fetchFn(url, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: new Uint8Array(body),
        signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
      })
      const why = res.headers.get("x-error-message") ?? `status ${res.status}`
      if (res.status >= 400 && res.status < 500)
        throw Object.assign(new Error(`CDN refused the upload: ${why}`), { final: true })
      if (res.status !== 200) throw new Error(`CDN upload failed: ${why}`)
      const param = res.headers.get("x-encrypted-param")
      if (!param) throw new Error("CDN upload answered without x-encrypted-param")
      return param
    } catch (err) {
      if ((err as { final?: boolean }).final) throw err
      last = err
    }
  }
  throw last instanceof Error ? last : new Error(String(last))
}

/** Encrypt and upload the file at `path` for `to`; the message item that shows it. */
export async function uploadAttachment(
  client: Pick<IlinkClient, "uploadUrl" | "fetchFn">,
  to: string,
  path: string,
  cdnBaseUrl = CDN_BASE_URL,
): Promise<Record<string, unknown>> {
  const kind = attachmentKind(path)
  const plain = readFileSync(path)
  if (plain.length > MAX_BYTES) throw new Error(`${basename(path)} is larger than 100 MB`)
  const key = randomBytes(16)
  const filekey = randomBytes(16).toString("hex")
  const cipher = createCipheriv("aes-128-ecb", key, null)
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()])
  const ticket = await client.uploadUrl({
    filekey,
    media_type: UPLOAD_TYPE[kind],
    to_user_id: to,
    rawsize: plain.length,
    rawfilemd5: createHash("md5").update(plain).digest("hex"),
    filesize: encrypted.length,
    aeskey: key.toString("hex"),
  })
  if (classifyIlink(ticket) !== "ok") throw new Error(`iLink refused the upload: ${describeIlink(ticket)}`)
  const url =
    ticket.upload_full_url?.trim() ||
    (ticket.upload_param
      ? `${cdnBaseUrl}/upload?encrypted_query_param=${encodeURIComponent(ticket.upload_param)}&filekey=${encodeURIComponent(filekey)}`
      : "")
  if (!url) throw new Error("iLink gave no upload address")
  const media = {
    encrypt_query_param: await postToCdn(client.fetchFn, url, encrypted),
    // Outbound keys go as base64 of the hex string, as WeChat's own client sends them.
    aes_key: Buffer.from(key.toString("hex")).toString("base64"),
    encrypt_type: 1,
  }
  if (kind === "image") return { type: ITEM_IMAGE, image_item: { media, mid_size: encrypted.length } }
  if (kind === "video") return { type: ITEM_VIDEO, video_item: { media, video_size: encrypted.length } }
  return { type: ITEM_FILE, file_item: { media, file_name: basename(path), len: String(plain.length) } }
}
