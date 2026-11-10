/**
 * The page a relay Worker serves (`rove --web --preset relay`, built to `dist/relay/index.html`).
 * It opens the end-to-end encrypted tunnel, then loads the client from the bridge through it, so
 * the Worker only ever holds this loader and the client always matches the bridge. The link's
 * `#code=` (and `#relay=` when the relay is another origin) are kept in storage; `#token=` is left
 * for the client's own `auth.ts`.
 */

import { RelayTunnelClient } from "@hsinsekai-nanami/client"
import { t } from "./i18n/index.ts"
import { relayTransport } from "./relay-adapters.ts"
import type { RelayTransport } from "./relay-transport.ts"

const STORAGE_KEY = "rove.relay"
const ASSET_URL = /url\((\/assets\/[^)]+)\)/g

interface Pairing {
  readonly server: string
  readonly code: string
}

function status(text: string): void {
  const el = document.getElementById("relay-status")
  if (el) el.textContent = text
}

function pairing(): Pairing | null {
  const params = new URLSearchParams(location.hash.slice(1))
  const code = params.get("code")
  if (code) {
    const found = { server: params.get("relay") ?? location.origin, code }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(found))
    const token = params.get("token")
    history.replaceState(null, "", location.pathname + location.search + (token ? `#token=${token}` : ""))
    return found
  }
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null")
    if (saved && typeof saved === "object" && "server" in saved && "code" in saved) {
      if (typeof saved.server === "string" && typeof saved.code === "string") {
        return { server: saved.server, code: saved.code }
      }
    }
  } catch {
    // Unreadable storage reads as never paired: the page asks for a fresh link.
  }
  return null
}

function failure(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  // A rotated code derives another room, so it looks exactly like the computer being offline.
  if (/\b(4404|1011)\b|timed out|auth/i.test(message)) return t("relay.offline")
  return t("relay.failed", { error: message })
}

async function blobUrl(transport: RelayTransport, path: string, type: string): Promise<string> {
  const res = await transport.fetch(path)
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`)
  return URL.createObjectURL(new Blob([await res.arrayBuffer()], { type }))
}

/** The bridge's own `index.html`, its script and stylesheets fetched through the tunnel. */
async function loadClient(transport: RelayTransport): Promise<void> {
  const shell = await transport.fetch("/")
  const doc = new DOMParser().parseFromString(await shell.text(), "text/html")
  const script = doc.querySelector('script[type="module"][src]')?.getAttribute("src")
  if (!script) throw new Error(`no client script in the bridge's page (HTTP ${shell.status})`)
  for (const link of doc.querySelectorAll('link[rel="stylesheet"][href]')) {
    const res = await transport.fetch(link.getAttribute("href") ?? "")
    let css = await res.text()
    // Fonts are `/assets/…` paths on the bridge, not on this origin.
    const assets = [...new Set([...css.matchAll(ASSET_URL)].map((m) => m[1] ?? ""))]
    const blobs = await Promise.all(assets.map(async (path) => [path, await blobUrl(transport, path, "")] as const))
    for (const [path, blob] of blobs) css = css.replaceAll(`url(${path})`, `url(${blob})`)
    const style = document.createElement("style")
    style.textContent = css
    document.head.append(style)
  }
  Reflect.set(globalThis, "__roveRelay", transport)
  const el = document.createElement("script")
  el.type = "module"
  el.src = await blobUrl(transport, script, "text/javascript")
  document.head.append(el)
}

async function boot(): Promise<void> {
  const found = pairing()
  if (!found) {
    status(t("relay.unpaired"))
    return
  }
  status(t("relay.connecting"))
  const tunnel = new RelayTunnelClient({ serverUrl: found.server, code: found.code, quiet: true })
  try {
    await tunnel.connect()
    status(t("relay.loading"))
    await loadClient(relayTransport(tunnel))
  } catch (err) {
    status(failure(err))
  }
}

void boot()
