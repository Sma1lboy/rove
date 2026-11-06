#!/usr/bin/env bun
// Uploader CLI for kit.sma1lboy.me. Reads PROMO_KIT_TOKEN (minted on the site's 上传令牌 page;
// CF_ACCESS_CLIENT_ID/SECRET are optional) from ~/.env.
//   bun run kit push <video.mp4> --title "..." --copy copy.md [--cover cover.jpg] [--id slug]
//   bun run kit copy <id> --copy copy.md [--title "..."]
//   bun run kit rm <id>
//   bun run kit ls
// copy.md: one post per block, blocks separated by a line containing only ---
import { homedir } from "node:os"
import { basename, extname } from "node:path"
import { parseArgs } from "node:util"
import { xLength, X_MAX } from "./src/xcount.ts"

for (const line of (await Bun.file(`${homedir()}/.env`).text().catch(() => "")).split("\n")) {
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
    parts.push(await call(`/api/upload?${q}&uploadId=${uploadId}&part=${n}`, { method: "PUT", body: f.slice(off, off + PART) }))
  }
  await call(`/api/upload/complete?${q}&uploadId=${uploadId}`, { method: "POST", body: JSON.stringify({ parts }) })
  console.log(`\r  ${key} 100%`)
}

// Minimal MP4 probe: duration from moov/mvhd, codec = first sample-entry fourcc inside moov.
export function probe(buf: Uint8Array) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const box = (start: number, end: number, type: string): [number, number] | undefined => {
    for (let i = start; i + 8 <= end; ) {
      let size = dv.getUint32(i), hdr = 8
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

function readPosts(text: string) {
  const posts = text.split(/^---\s*$/m).map((s) => s.trim()).filter(Boolean)
  posts.forEach((p, i) => {
    const n = xLength(p)
    console.log(`  post ${i + 1}: ${n}/${X_MAX}${n > X_MAX ? "  !! over X limit" : ""}`)
  })
  return posts
}

if (import.meta.main) {
  const { values: o, positionals: [cmd, arg] } = parseArgs({
    args: Bun.argv.slice(2),
    allowPositionals: true,
    options: { title: { type: "string" }, copy: { type: "string" }, cover: { type: "string" }, id: { type: "string" } },
  })
  if (!process.env.PROMO_KIT_TOKEN) throw new Error("PROMO_KIT_TOKEN missing (put it in ~/.env)")

  if (cmd === "push") {
    if (!arg || !o.title || !o.copy) throw new Error("usage: kit push <video.mp4> --title ... --copy copy.md [--cover img] [--id slug]")
    const id = (o.id || basename(arg, extname(arg))).toLowerCase().replace(/[^\w-]+/g, "-")
    const f = Bun.file(arg)
    const meta = probe(new Uint8Array(await f.arrayBuffer()))
    if (!meta) throw new Error(`${arg}: not an MP4 (no moov/mvhd box)`)
    const warn = [
      !/\.mp4$/i.test(arg) && "not .mp4",
      !/^avc/.test(meta.codec) && `codec ${meta.codec}, X wants H.264`,
      meta.duration > 140 && `duration ${meta.duration}s > 2:20`,
      f.size > 512 * 1024 * 1024 && "size > 512MB",
    ].filter(Boolean)
    if (warn.length) console.warn(`  !! X may reject this video: ${warn.join("; ")}`)
    const posts = readPosts(await Bun.file(o.copy).text())
    const video = { key: `${id}/video.mp4`, size: f.size, ...meta }
    await upload(arg, video.key, "video/mp4")
    let cover
    if (o.cover) {
      cover = `${id}/cover${extname(o.cover).toLowerCase()}`
      await upload(o.cover, cover, Bun.file(o.cover).type)
    }
    await call(`/api/items/${id}`, { method: "PUT", body: JSON.stringify({ title: o.title, video, cover, posts }) })
    console.log(`pushed ${BASE}/#/${id}`)
  } else if (cmd === "copy") {
    if (!arg || !o.copy) throw new Error("usage: kit copy <id> --copy copy.md [--title ...]")
    const posts = readPosts(await Bun.file(o.copy).text())
    await call(`/api/items/${arg}`, { method: "PATCH", body: JSON.stringify({ posts, title: o.title }) })
    console.log(`updated ${BASE}/#/${arg}`)
  } else if (cmd === "rm") {
    if (!arg) throw new Error("usage: kit rm <id>")
    await call(`/api/items/${arg}`, { method: "DELETE" })
    console.log(`removed ${arg}`)
  } else if (cmd === "ls") {
    for (const it of (await call("/api/items")).items) console.log(`${it.id}\t${it.title}\t${it.posts.length} post(s)`)
  } else {
    console.log("commands: push | copy | rm | ls  (see top of kit.ts)")
  }
}
