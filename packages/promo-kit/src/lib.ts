export type Video = { key: string; size: number; duration?: number; codec?: string }
/** One attachment of an item: what X calls media. A post takes up to four. */
export type Media = Video & { kind: "video" | "image" }
export type Action = "send" | "download" | "copy"
export type Event = { action: Action; post: number; by: string; at: string }
export type Version = { posts: string[]; by: string; at?: string }
export type Item = {
  id: string
  title: string
  /** Items pushed before images were allowed carry only this. */
  video?: Video
  media?: Media[]
  cover?: string
  posts: string[]
  sends: Event[]
  kind?: string
  lang?: "zh" | "en"
  created?: string
  updated?: string
}

// The list's order and filters. Kept per browser; newest-created first by default.
export type Sort = "created-desc" | "created-asc" | "updated-desc" | "updated-asc"
export const SORTS: Record<Sort, string> = {
  "created-desc": "最新创建",
  "created-asc": "最早创建",
  "updated-desc": "最近更新",
  "updated-asc": "最久没更新",
}
export type View = { sort: Sort; kind: string; lang: "" | "zh" | "en" }
export const VIEW_KEY = "kit.view"
export function loadView(): View {
  const v = { sort: "created-desc", kind: "", lang: "", ...JSON.parse(localStorage.getItem(VIEW_KEY) || "{}") }
  return v.sort in SORTS ? v : { ...v, sort: "created-desc" }
}

export function applyView(items: Item[], v: View): Item[] {
  const field = v.sort.startsWith("created") ? "created" : "updated"
  const dir = v.sort.endsWith("desc") ? -1 : 1
  // ISO strings sort as dates; a missing stamp sorts as oldest.
  return items
    .filter((it) => (!v.kind || it.kind === v.kind) && (!v.lang || it.lang === v.lang))
    .sort((a, b) => dir * (a[field] ?? "").localeCompare(b[field] ?? ""))
}

export function fmtDay(at?: string) {
  const d = at ? new Date(at) : null
  return d && !Number.isNaN(d.getTime()) ? `${d.getMonth() + 1}/${d.getDate()}` : ""
}

export function fmtTime(at?: string) {
  const d = at ? new Date(at) : null
  return d && !Number.isNaN(d.getTime())
    ? d.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : ""
}
export const who = (by: string, me: string) => (by === me ? "你" : by)

export const postJson = (path: string, body: object) =>
  fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
export const logEvent = (id: string, action: Action, post = 0) => postJson(`/api/items/${id}/events`, { action, post })

export const vurl = (key: string) => `/v/${key}`

export const mediaOf = (it: Pick<Item, "video" | "media">): Media[] =>
  it.media?.length ? it.media : it.video ? [{ ...it.video, kind: "video" }] : []

const MIME: Record<string, string> = {
  mp4: "video/mp4",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
}
export const extOf = (key: string) => key.split(".").pop()?.toLowerCase() ?? ""
export const mimeOf = (key: string) => MIME[extOf(key)] ?? "application/octet-stream"

/** "0:42" for one video, "3 张图" for images, "视频 + 2 张图" for a mix. */
export function mediaLabel(list: Media[]) {
  const videos = list.filter((m) => m.kind === "video")
  const images = list.length - videos.length
  const v =
    videos.length === 1 ? fmtDur(videos[0].duration) || "视频" : videos.length > 1 ? `${videos.length} 个视频` : ""
  const i = images > 0 ? `${images} 张图` : ""
  return v && i ? `${v.includes(":") ? `视频 ${v}` : v} + ${i}` : v || i
}

export function fmtDur(s?: number) {
  if (!s) return ""
  const t = Math.round(s)
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`
}
export const fmtSize = (b: number) => `${(b / 1024 / 1024).toFixed(1)} MB`

export async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export const toast = (msg: string, ms = 4000) => dispatchEvent(new CustomEvent("kit-toast", { detail: { msg, ms } }))

// Phone = touch screen whose share sheet takes video files (iOS Safari, Android Chrome).
export const MOBILE =
  matchMedia("(pointer: coarse)").matches &&
  !!navigator.canShare?.({ files: [new File([""], "a.mp4", { type: "video/mp4" })] })

export function videoWarnings(v: Video, dims?: { w: number; h: number }) {
  const w: string[] = []
  if (!/\.mp4$/i.test(v.key)) w.push("不是 mp4 文件")
  if (v.codec && !/^avc/.test(v.codec)) w.push(`编码是 ${v.codec}，X 要求 H.264`)
  if (v.duration && v.duration > 140) w.push(`时长 ${fmtDur(v.duration)}，超过 X 的 2:20 上限`)
  if (v.size > 512 * 1024 * 1024) w.push(`大小 ${fmtSize(v.size)}，超过 X 的 512 MB 上限`)
  const r = dims ? dims.w / dims.h : 0
  if (r && (r > 2.39 || r < 1 / 2.39)) w.push(`画面 ${dims?.w}×${dims?.h}，超出 X 的 1:2.39 – 2.39:1`)
  return w
}

/** Everything X might refuse about an item's attachments. `dims` is the first video's frame, once loaded. */
export function mediaWarnings(list: Media[], dims?: { w: number; h: number }) {
  const w: string[] = []
  if (list.length > 4) w.push(`一共 ${list.length} 个附件，X 一条最多带 4 个`)
  let first = true
  for (const m of list) {
    if (m.kind === "video") {
      w.push(...videoWarnings(m, first ? dims : undefined))
      first = false
    } else {
      const cap = extOf(m.key) === "gif" ? 15 : 5
      if (m.size > cap * 1024 * 1024)
        w.push(`图片 ${m.key.split("/").pop()} 有 ${fmtSize(m.size)}，超过 X 的 ${cap} MB 上限`)
    }
  }
  return w
}

export const primaryBtn =
  "rounded-sm bg-accent px-3.5 py-1.5 text-meta font-semibold text-paper active:scale-97 motion-reduce:active:scale-none disabled:cursor-progress disabled:opacity-50 touch:min-h-11 touch:text-title"
export const linkBtn = "text-meta text-accent hover:underline touch:py-2.5"
export const actionBtn =
  "rounded-sm border border-line px-3 py-1.25 text-meta text-ink hover:border-line-active hover:bg-hover active:scale-97 motion-reduce:active:scale-none disabled:opacity-50 touch:min-h-10"
