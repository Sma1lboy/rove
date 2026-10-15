/**
 * The browser client's files, served next to the WebSocket by `rove --web`.
 * They carry no secrets, so they sit outside the token check (the page cannot
 * hold a token before it loads); Cloudflare Access, when on, still gates them.
 */

import { stat } from "node:fs/promises"
import { resolve, sep } from "node:path"

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
  let file = Bun.file(target)
  if (!isFile) {
    if (pathname.startsWith("/assets/")) return new Response("not found\n", { status: 404 })
    file = Bun.file(resolve(root, "index.html"))
    if (!(await file.exists())) return new Response("web client not built\n", { status: 503 })
  }
  // Hashed asset names never change content; the shell must be re-read so a rebuild is picked up.
  const cache = target.startsWith(resolve(root, "assets") + sep) ? "public, max-age=31536000, immutable" : "no-cache"
  return new Response(req.method === "HEAD" ? null : file, {
    headers: { ...SECURITY_HEADERS, "Content-Type": file.type, "Cache-Control": cache },
  })
}
