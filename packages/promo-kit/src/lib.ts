export type Video = { key: string; size: number; duration?: number; codec?: string }
export type Action = "send" | "download" | "copy"
export type Event = { action: Action; post: number; by: string; at: string }
export type Version = { posts: string[]; by: string; at?: string }
export type Item = { id: string; title: string; video: Video; cover?: string; posts: string[]; sends: Event[]; kind?: string; lang?: "zh" | "en" }

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

export const primaryBtn =
  "rounded-sm bg-accent px-3.5 py-1.5 text-meta font-semibold text-paper active:scale-97 motion-reduce:active:scale-none disabled:cursor-progress disabled:opacity-50 touch:min-h-11 touch:text-title"
export const linkBtn = "text-meta text-accent hover:underline touch:py-2.5"
export const actionBtn =
  "rounded-sm border border-line px-3 py-1.25 text-meta text-ink hover:border-line-active hover:bg-hover active:scale-97 motion-reduce:active:scale-none disabled:opacity-50 touch:min-h-10"
