/**
 * A pasted link's page title and icon, for the composer's link badge. The bridge fetches the page because the
 * browser can't read another origin's HTML; only the title and icon go back, never the body.
 */

import { BridgeError } from "../protocol.ts"
import type { OpTable } from "./types.ts"

const READ_MAX = 512 * 1024
const TITLE_MAX = 200
// ponytail: a hostname check, not resolved IPs; a name that resolves to a private address still gets fetched.
const PRIVATE = /^(localhost|.*\.local|.*\.internal|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[)/i

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " }

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (whole, code: string) => {
    if (code[0] !== "#") return ENTITIES[code.toLowerCase()] ?? whole
    const n = code[1] === "x" || code[1] === "X" ? Number.parseInt(code.slice(2), 16) : Number(code.slice(1))
    return Number.isFinite(n) ? String.fromCodePoint(n) : whole
  })
}

/** The page's `<title>` (else `og:title`) and its icon link (else `/favicon.ico`), resolved against `base`. */
export function readHead(html: string, base: URL): { title: string; icon: string } {
  const raw =
    /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] ??
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i.exec(html)?.[1] ??
    ""
  const title = decodeEntities(raw).replace(/\s+/g, " ").trim().slice(0, TITLE_MAX)
  const links = html.match(/<link[^>]+rel=["'][^"']*\bicon["'][^>]*>/gi) ?? []
  // A raster icon first: an SVG one may recolor itself for the viewer's color scheme and vanish on the badge.
  const link = links.find((tag) => !/\.svg|svg\+xml|mask-icon|fluid-icon|apple-touch/i.test(tag)) ?? links[0]
  const href = link && /href=["']([^"']+)["']/i.exec(link)?.[1]
  return { title, icon: new URL(href ? decodeEntities(href) : "/favicon.ico", base).href }
}

async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader()
  if (!reader) return ""
  const chunks: Uint8Array[] = []
  let size = 0
  while (size < READ_MAX) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    size += value.length
  }
  void reader.cancel()
  return new TextDecoder().decode(Buffer.concat(chunks))
}

const ICON_MAX = 64 * 1024

/** The icon as a `data:` URL: the web app's CSP loads no other origin's images, and the phone never asks that site. */
async function iconData(href: string): Promise<string> {
  try {
    const res = await fetch(href, { signal: AbortSignal.timeout(4000) })
    const type = res.headers.get("content-type") ?? ""
    if (!res.ok || !type.startsWith("image/")) return ""
    const bytes = Buffer.from(await res.arrayBuffer())
    return bytes.length > ICON_MAX ? "" : `data:${type.split(";")[0]};base64,${bytes.toString("base64")}`
  } catch {
    // No icon: the badge shows its title alone.
    return ""
  }
}

export const linkOps: OpTable = {
  "link.preview": {
    kind: "read",
    destructive: false,
    wraps: "fetch of a public http(s) page (its <title> and icon as a data: URL, for a link badge)",
    async run(a) {
      let url: URL
      try {
        url = new URL(String(a.url))
      } catch {
        throw new BridgeError("BAD_ARGS", "url is not a URL")
      }
      if (!/^https?:$/.test(url.protocol) || PRIVATE.test(url.hostname)) {
        throw new BridgeError("BAD_ARGS", "only public http(s) links are previewed")
      }
      const res = await fetch(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(6000),
        headers: { "user-agent": "Mozilla/5.0 (compatible; Rove link preview)", accept: "text/html" },
      }).catch(() => {
        throw new BridgeError("FETCH_FAILED", `could not reach ${url.host}`)
      })
      const html = (res.headers.get("content-type") ?? "").includes("html") ? await readCapped(res) : ""
      const head = readHead(html, new URL(res.url || url.href))
      // An error page's title ("Page not found") would label the badge wrongly: it keeps the host.
      return { title: res.ok ? head.title : "", icon: await iconData(head.icon) }
    },
  },
}
