/**
 * The page a relay Worker serves (`rove --web --preset relay`, built to `dist/relay/index.html`).
 * It opens the end-to-end encrypted tunnel, then loads the client from the bridge through it, so
 * the Worker only ever holds this loader and the client always matches the bridge. The link's
 * `#code=` (and `#relay=` when the relay is another origin) are kept in storage; `#token=` is left
 * for the client's own `auth.ts`.
 */

import { RelayTunnelClient, type TunnelDiagEvent } from "@hsinsekai-nanami/client"
import { t } from "./i18n/index.ts"
import { relayTransport } from "./relay-adapters.ts"
import { createRelayStatus } from "./relay-status.ts"
import type { RelayTransport } from "./relay-transport.ts"

const STORAGE_KEY = "rove.relay"
/** When this device last loaded rove through the relay: the Details a failure shows. */
const LAST_OK_KEY = "rove.relay.lastOk"
const ASSET_URL = /url\(((?:\/relay-client)?\/assets\/[^)]+)\)/g
// Match claude theme paper tokens (`packages/rove-core/src/theme/claude.json`) before rove-web mounts.
const PAPER_DARK = "#141413"
const PAPER_LIGHT = "#faf9f5"

interface Pairing {
  readonly server: string
  readonly code: string
}

function syncThemeColor(): () => void {
  if (typeof matchMedia !== "function") return () => {}
  const mq = matchMedia("(prefers-color-scheme: light)")
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (!meta) {
    meta = document.createElement("meta")
    meta.name = "theme-color"
    document.head.append(meta)
  }
  const apply = () => {
    meta.content = mq.matches ? PAPER_LIGHT : PAPER_DARK
  }
  apply()
  mq.addEventListener("change", apply)
  return () => mq.removeEventListener("change", apply)
}

function mountSplashStatus() {
  const statusEl = document.getElementById("relay-status")
  const retryEl = document.getElementById("relay-retry")
  retryEl?.addEventListener("click", () => location.reload())
  return createRelayStatus({
    show(text, tone, retryLabel) {
      if (statusEl) {
        statusEl.textContent = text
        statusEl.setAttribute("role", tone === "error" ? "alert" : "status")
        if (tone === "loading") statusEl.removeAttribute("data-tone")
        else statusEl.dataset.tone = tone
        statusEl.dataset.visible = ""
      }
      if (retryEl) {
        if (tone === "error" && retryLabel) {
          retryEl.textContent = retryLabel
          retryEl.hidden = false
        } else {
          retryEl.hidden = true
        }
      }
    },
  })
}

/** The iPhone app's shell (`WebShellView.swift`): it opens its computers sheet on `computers`. */
function iosShell(): { postMessage(body: string): void } | undefined {
  return Reflect.get(globalThis, "webkit")?.messageHandlers?.shell
}

/** What a failed connect knows, for the Details under the error: copyable, so it can be pasted into a report. */
function failureDetails(found: Pairing, err: unknown, diag: TunnelDiagEvent | null): string {
  const close = diag?.type === "disconnect" ? [diag.code, diag.reason].filter((v) => v !== null).join(" ") : ""
  const lines: [string, string][] = [
    [t("relay.detail.relay"), new URL(found.server).host],
    [t("relay.detail.code"), `${found.code.slice(0, 6)}…`],
    [t("relay.detail.error"), err instanceof Error ? err.message : String(err)],
    ...(close ? [[t("relay.detail.close"), close] as [string, string]] : []),
    ...(diag && diag.type !== "connect" && diag.type !== "ready" ? [[t("relay.detail.hint"), diag.hint] as [string, string]] : []),
    [t("relay.detail.at"), new Date().toISOString()],
    [t("relay.detail.lastOk"), localStorage.getItem(LAST_OK_KEY) ?? t("relay.detail.never")],
  ]
  return lines.map(([k, v]) => `${k}: ${v}`).join("\n")
}

/** Under the error: a way to another computer (in the iPhone app) and the Details, with Copy. */
function showFailureActions(details: string): void {
  const shell = iosShell()
  const switchEl = document.getElementById("relay-switch")
  if (switchEl && shell) {
    switchEl.textContent = t("relay.switchComputer")
    switchEl.hidden = false
    switchEl.addEventListener("click", () => shell.postMessage("computers"))
  }
  const detailsEl = document.getElementById("relay-details")
  const text = document.getElementById("relay-detail-text")
  const label = document.getElementById("relay-details-label")
  const copy = document.getElementById("relay-copy")
  if (!detailsEl || !text || !label || !copy) return
  label.textContent = t("relay.details")
  text.textContent = details
  copy.textContent = t("relay.copy")
  copy.addEventListener("click", () => {
    void navigator.clipboard?.writeText(details).then(() => {
      copy.textContent = t("relay.copied")
    })
  })
  // Opened, the details run past the fold: the page scrolls to show them.
  detailsEl.addEventListener("toggle", () => {
    if ((detailsEl as HTMLDetailsElement).open) copy.scrollIntoView({ block: "end", behavior: "smooth" })
  })
  detailsEl.hidden = false
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

const GLIDE_MS = 450
const EASE = "cubic-bezier(0.2, 0, 0, 1)"
/** How long the loader waits for the list's wordmark before it just fades (a link straight into a session has none). */
const WORDMARK_WAIT_MS = 3000

function shownWordmark(): HTMLElement | null {
  const el = document.querySelector<HTMLElement>("[data-wordmark]")
  const box = el?.getBoundingClientRect()
  return el && box && box.width > 0 && box.height > 0 ? el : null
}

/**
 * The loader's centred wordmark glides to the list's once rove-web has drawn it, then hands off to it, with the page
 * fading in underneath (a FLIP between the two rects). rove-web renders over `#root`, so the logo is lifted into an
 * overlay first. No wordmark in time, or reduced motion: the overlay only fades.
 */
function handOff(): void {
  const logo = document.getElementById("relay-logo")
  if (!logo) return
  const from = logo.getBoundingClientRect()
  const overlay = document.createElement("div")
  overlay.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none"
  const ground = document.createElement("div")
  ground.style.cssText = "position:absolute;inset:0;background:var(--rs-paper)"
  logo.style.cssText = `position:fixed;margin:0;left:${from.left}px;top:${from.top}px;transform-origin:0 0`
  overlay.append(ground, logo)
  document.body.append(overlay)
  const started = performance.now()
  const settle = () => {
    // Measured once the app's fonts are in: a fallback face lands the glide at the wrong size.
    const target = document.fonts.status === "loaded" ? shownWordmark() : null
    if (!target && performance.now() - started < WORDMARK_WAIT_MS) {
      requestAnimationFrame(settle)
      return
    }
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches
    const timing = { duration: GLIDE_MS, easing: EASE, fill: "forwards" as const }
    if (target && !still) {
      const to = target.getBoundingClientRect()
      // By width and centre: the two boxes' line heights differ, their text does not.
      const scale = to.width / from.width
      const dx = to.left + to.width / 2 - from.left - (from.width * scale) / 2
      const dy = to.top + to.height / 2 - from.top - (from.height * scale) / 2
      target.style.visibility = "hidden"
      logo.animate({ transform: ["none", `translate(${dx}px, ${dy}px) scale(${scale})`] }, timing)
      ground.animate({ opacity: [1, 0] }, timing).finished.then(() => {
        target.style.visibility = ""
        overlay.remove()
      })
    } else {
      overlay.animate({ opacity: [1, 0] }, { ...timing, duration: 300 }).finished.then(() => overlay.remove())
    }
  }
  requestAnimationFrame(settle)
}

async function blobUrl(transport: RelayTransport, path: string, type: string): Promise<string> {
  const res = await transport.fetch(path)
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`)
  return URL.createObjectURL(new Blob([await res.arrayBuffer()], { type }))
}

/**
 * The bridge's relay build of the client (its `index.html`, script and stylesheets) fetched through the tunnel. A
 * bridge without one answers with its own app shell, whose split script loads only on bridges that predate splitting.
 */
async function loadClient(transport: RelayTransport): Promise<void> {
  const shell = await transport.fetch("/relay-client/index.html")
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
  // Before the script runs: rove-web's first render replaces the splash.
  handOff()
  document.head.append(el)
}

async function boot(): Promise<void> {
  const stopThemeColor = syncThemeColor()
  const splash = mountSplashStatus()
  const found = pairing()
  if (!found) {
    splash.info(t("relay.unpaired"))
    return
  }
  splash.loading(t("relay.connecting"))
  let diag: TunnelDiagEvent | null = null
  const tunnel = new RelayTunnelClient({
    serverUrl: found.server,
    code: found.code,
    quiet: true,
    onDiag: (e) => {
      if (e.type === "disconnect" || e.type === "failed") diag = e
    },
  })
  try {
    await tunnel.connect()
    splash.loading(t("relay.loading"))
    await loadClient(relayTransport(tunnel))
    localStorage.setItem(LAST_OK_KEY, new Date().toISOString())
    stopThemeColor()
    splash.done()
  } catch (err) {
    splash.error(failure(err), t("workspace.retry"))
    showFailureActions(failureDetails(found, err, diag))
  }
}

void boot()
