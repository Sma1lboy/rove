#!/usr/bin/env bun
// Uploader CLI for kit.sma1lboy.me. Reads PROMO_KIT_TOKEN (minted on the site's 上传令牌 page;
// CF_ACCESS_CLIENT_ID/SECRET are optional) from ~/.env.
//   bun run kit push <file> [file…] --title "..." --copy copy.md [--kind 功能发布] [--lang zh|en] [--cover cover.jpg] [--id slug]
//     files: .mp4 videos and .png/.jpg/.webp/.gif images, in the order X should show them (X takes up to 4 per post)
//   bun run kit copy <id> [--copy copy.md] [--title "..."] [--kind ...] [--lang zh|en]
//   bun run kit rm <id>
//   bun run kit ls
// copy.md: one post per block, blocks separated by a line containing only ---
import { homedir } from "node:os"
import { basename, extname } from "node:path"
import { parseArgs } from "node:util"
import { X_MAX, xLength } from "./src/xcount.ts"

for (const line of (
  await Bun.file(`${homedir()}/.env`)
    .text()
    .catch(() => "")
).split("\n")) {
  const m = line.match(/^\s*(?:export\s+)?([A-Z_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "")
}
const BASE = process.env.KIT_URL || "https://kit.sma1lboy.me"
const PART = Number(process.env.KIT_PART_MB || 50) * 1024 * 1024

const headers: Record<string, string> = { authorization: `Bearer ${process.env.PROMO_KIT_TOKEN}` }
if (process.env.CF_ACCESS_CLIENT_ID) {
  headers["cf-access-client-id"] = process.env.CF_ACCESS_CLIENT_ID
  headers["cf-access-client-secret"] = process.env.CF_ACCESS_CLIENT_SECRET!
}

async function call(path: string, init: RequestInit = {}) {
  const r = await fetch(BASE + path, { ...init, headers: { ...headers, ...(init.headers as any) } })
  if (!r.ok) throw new Error(`${init.method || "GET"} ${path} -> ${r.status} ${await r.text()}`)
  return r.json()
}

async function upload(file: string, key: string, type: string) {
  const f = Bun.file(file)
  const q = `key=${encodeURIComponent(key)}`
  const { uploadId } = await call(`/api/upload?${q}&type=${encodeURIComponent(type)}`, { method: "POST" })
  const parts = []
  for (let off = 0, n = 1; off < f.size; off += PART, n++) {
    process.stdout.write(`\r  ${key} ${Math.round((off / f.size) * 100)}%`)
    parts.push(
      await call(`/api/upload?${q}&uploadId=${uploadId}&part=${n}`, { method: "PUT", body: f.slice(off, off + PART) }),
    )
  }
  await call(`/api/upload/complete?${q}&uploadId=${uploadId}`, { method: "POST", body: JSON.stringify({ parts }) })
  console.log(`\r  ${key} 100%`)
}

// Minimal MP4 probe: duration from moov/mvhd, codec = first sample-entry fourcc inside moov.
export function probe(buf: Uint8Array) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const box = (start: number, end: number, type: string): [number, number] | undefined => {
    for (let i = start; i + 8 <= end; ) {
      let size = dv.getUint32(i),
        hdr = 8
      if (size === 1) (size = Number(dv.getBigUint64(i + 8))), (hdr = 16)
      else if (size === 0) size = end - i
      if (size < hdr) return
      if (String.fromCharCode(...buf.subarray(i + 4, i + 8)) === type) return [i + hdr, i + size]
      i += size
    }
  }
  const moov = box(0, buf.length, "moov")
  const mvhd = moov && box(moov[0], moov[1], "mvhd")
  if (!moov || !mvhd) return null
  const v1 = buf[mvhd[0]] === 1
  const scale = dv.getUint32(mvhd[0] + (v1 ? 20 : 12))
  const dur = v1 ? Number(dv.getBigUint64(mvhd[0] + 24)) : dv.getUint32(mvhd[0] + 16)
  const text = new TextDecoder("latin1").decode(buf.subarray(moov[0], moov[1]))
  const codec = text.match(/avc1|avc3|hvc1|hev1|av01|vp09|mp4v/)?.[0] ?? "unknown"
  return { duration: Math.round((dur / scale) * 100) / 100, codec }
}

const IMAGE: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
}
/** What a file is by its extension, or null for one the kit does not take. */
export function classify(path: string): { kind: "video" | "image"; mime: string } | null {
  const ext = extname(path).toLowerCase()
  if (ext === ".mp4") return { kind: "video", mime: "video/mp4" }
  return IMAGE[ext] ? { kind: "image", mime: IMAGE[ext] } : null
}

function readPosts(text: string) {
  const posts = text
    .split(/^---\s*$/m)
    .map((s) => s.trim())
    .filter(Boolean)
  posts.forEach((p, i) => {
    const n = xLength(p)
    console.log(`  post ${i + 1}: ${n}/${X_MAX}${n > X_MAX ? "  !! over X limit" : ""}`)
  })
  return posts
}

if (import.meta.main) {
  const {
    values: o,
    positionals: [cmd, ...args],
  } = parseArgs({
    args: Bun.argv.slice(2),
    allowPositionals: true,
    options: {
      title: { type: "string" },
      copy: { type: "string" },
      cover: { type: "string" },
      id: { type: "string" },
      kind: { type: "string" },
      lang: { type: "string" },
    },
  })
  const arg = args[0]
  if (!process.env.PROMO_KIT_TOKEN) throw new Error("PROMO_KIT_TOKEN missing (put it in ~/.env)")

  if (cmd === "push") {
    if (!arg || !o.title || !o.copy)
      throw new Error("usage: kit push <file> [file…] --title ... --copy copy.md [--cover img] [--id slug]")
    const id = (o.id || basename(arg, extname(arg))).toLowerCase().replace(/[^\w-]+/g, "-")
    if (args.length > 4) console.warn(`  !! ${args.length} files: X takes at most 4 per post`)
    const posts = readPosts(await Bun.file(o.copy).text())
    const media = []
    for (const [n, file] of args.entries()) {
      const what = classify(file)
      if (!what) throw new Error(`${file}: not a video (.mp4) or an image (.png .jpg .webp .gif)`)
      const f = Bun.file(file)
      const ext = extname(file).toLowerCase()
      // A lone video keeps the key older pages and links already use.
      const key = args.length === 1 && what.kind === "video" ? `${id}/video.mp4` : `${id}/${n + 1}${ext}`
      if (what.kind === "video") {
        const meta = probe(new Uint8Array(await f.arrayBuffer()))
        if (!meta) throw new Error(`${file}: not an MP4 (no moov/mvhd box)`)
        const warn = [
          !/^avc/.test(meta.codec) && `codec ${meta.codec}, X wants H.264`,
          meta.duration > 140 && `duration ${meta.duration}s > 2:20`,
          f.size > 512 * 1024 * 1024 && "size > 512MB",
        ].filter(Boolean)
        if (warn.length) console.warn(`  !! X may reject ${file}: ${warn.join("; ")}`)
        media.push({ key, size: f.size, kind: what.kind, ...meta })
      } else {
        const cap = ext === ".gif" ? 15 : 5
        if (f.size > cap * 1024 * 1024) console.warn(`  !! X may reject ${file}: larger than ${cap} MB`)
        media.push({ key, size: f.size, kind: what.kind })
      }
      await upload(file, key, what.mime)
    }
    // Kept beside media[] so a page that predates images still plays the video.
    const video = media.find((m) => m.kind === "video")
    let cover
    if (o.cover) {
      cover = `${id}/cover${extname(o.cover).toLowerCase()}`
      await upload(o.cover, cover, Bun.file(o.cover).type)
    }
    const lang = o.lang ?? (/[\u4e00-\u9fff]/.test(posts.join("")) ? "zh" : "en")
    const kind = o.kind ?? "功能发布"
    await call(`/api/items/${id}`, {
      method: "PUT",
      body: JSON.stringify({ title: o.title, media, video, cover, posts, kind, lang }),
    })
    console.log(`pushed ${BASE}/#/${id}`)
  } else if (cmd === "copy") {
    if (!arg) throw new Error("usage: kit copy <id> [--copy copy.md] [--title ...] [--kind ...] [--lang zh|en]")
    const posts = o.copy ? readPosts(await Bun.file(o.copy).text()) : undefined
    await call(`/api/items/${arg}`, {
      method: "PATCH",
      body: JSON.stringify({ posts, title: o.title, kind: o.kind, lang: o.lang }),
    })
    console.log(`updated ${BASE}/#/${arg}`)
  } else if (cmd === "rm") {
    if (!arg) throw new Error("usage: kit rm <id>")
    await call(`/api/items/${arg}`, { method: "DELETE" })
    console.log(`removed ${arg}`)
  } else if (cmd === "ls") {
    for (const it of (await call("/api/items")).items)
      console.log(`${it.id}\t${it.kind ?? "-"}\t${it.lang ?? "-"}\t${it.title}\t${it.posts.length} post(s)`)
  } else {
    console.log("commands: push | copy | rm | ls  (see top of kit.ts)")
  }
}
