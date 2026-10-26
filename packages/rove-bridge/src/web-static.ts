/**
 * The browser client's files, served next to the WebSocket by `rove --web`.
 * They carry no secrets, so they sit outside the token check (the page cannot
 * hold a token before it loads); Cloudflare Access, when on, still gates them.
 */

import { stat } from "node:fs/promises"
import { extname, resolve, sep } from "node:path"
import { gzipSync } from "node:zlib"

export interface WebRoot {
  /** Directory holding the built client (`index.html` + `assets/`). */
  readonly root: string
}

/**
 * The page keeps the bridge token in localStorage, so script and connection
 * sources are pinned to this origin; nothing may frame it.
 */
const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
}

/** Text types worth compressing; fonts, images and audio are compressed already. */
const COMPRESSIBLE = new Set([".html", ".js", ".mjs", ".css", ".json", ".svg", ".map", ".txt"])

/** Gzipped bodies by path, valid while the file's mtime and size hold. */
const gzipped = new Map<string, { mtimeMs: number; size: number; body: Uint8Array }>()

async function gzipFile(path: string): Promise<Uint8Array> {
  const s = await stat(path)
  const hit = gzipped.get(path)
  if (hit && hit.mtimeMs === s.mtimeMs && hit.size === s.size) return hit.body
  const body = gzipSync(await Bun.file(path).bytes())
  gzipped.set(path, { mtimeMs: s.mtimeMs, size: s.size, body })
  return body
}

/** A static response, or null when `req` is not a static GET/HEAD. */
export async function serveWebFile(web: WebRoot, req: Request): Promise<Response | null> {
  if (req.method !== "GET" && req.method !== "HEAD") return null
  const root = resolve(web.root)
  let pathname: string
  try {
    pathname = decodeURIComponent(new URL(req.url).pathname)
  } catch {
    return new Response("bad path\n", { status: 400 })
  }
  const target = resolve(root, `.${pathname}`)
  if (target !== root && !target.startsWith(root + sep)) return new Response("not found\n", { status: 404 })
  const isFile = await stat(target).then(
    (s) => s.isFile(),
    () => false,
  )
  // Client-side routes (and `/`) fall back to the app shell; a missing asset is a real 404.
  let path = target
  if (!isFile) {
    if (pathname.startsWith("/assets/")) return new Response("not found\n", { status: 404 })
    path = resolve(root, "index.html")
    if (!(await Bun.file(path).exists())) return new Response("web client not built\n", { status: 503 })
  }
  const file = Bun.file(path)
  // Hashed asset names never change content; the shell must be re-read so a rebuild is picked up.
  const cache = target.startsWith(resolve(root, "assets") + sep) ? "public, max-age=31536000, immutable" : "no-cache"
  const headers: Record<string, string> = { ...SECURITY_HEADERS, "Content-Type": file.type, "Cache-Control": cache }
  if (!COMPRESSIBLE.has(extname(path))) return new Response(req.method === "HEAD" ? null : file, { headers })
  headers.Vary = "Accept-Encoding"
  if (!acceptsGzip(req.headers.get("accept-encoding") ?? "")) {
    return new Response(req.method === "HEAD" ? null : file, { headers })
  }
  headers["Content-Encoding"] = "gzip"
  return new Response(req.method === "HEAD" ? null : await gzipFile(path), { headers })
}

/** `gzip` listed without `q=0`. */
function acceptsGzip(header: string): boolean {
  return header.split(",").some((part) => {
    const [name, ...params] = part.trim().toLowerCase().split(";")
    return name.trim() === "gzip" && !params.some((p) => /^\s*q=0(\.0*)?\s*$/.test(p))
  })
}
