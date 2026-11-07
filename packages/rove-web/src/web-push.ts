/**
 * "Notify when this page is closed": the service worker (`public/sw.js`) plus a Web Push subscription
 * the bridge keeps under this page's token (`push.*` ops). Push needs a secure page (https, or
 * localhost); on iPhone and iPad it also needs the page installed to the home screen.
 */

import type { BridgeClient } from "./bridge.ts"
import type { AppModel } from "./model.ts"

export type PushState = "unsupported" | "blocked" | "off" | "on"

export function pushSupported(): boolean {
  return window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window
}

const registration = (): Promise<ServiceWorkerRegistration> => navigator.serviceWorker.register("sw.js")

export async function pushState(client: BridgeClient): Promise<PushState> {
  if (!pushSupported()) return "unsupported"
  if (Notification.permission === "denied") return "blocked"
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  if (!sub) return "off"
  const { subscribed } = await client.request<{ subscribed: boolean }>("push.status", { endpoint: sub.endpoint })
  return subscribed ? "on" : "off"
}

/** Call from a click: browsers only ask for permission inside a user gesture. */
export async function enablePush(client: BridgeClient): Promise<PushState> {
  if (!pushSupported()) return "unsupported"
  if ((await Notification.requestPermission()) !== "granted") return "blocked"
  const reg = await registration()
  await navigator.serviceWorker.ready
  const { publicKey } = await client.request<{ publicKey: string }>("push.key")
  let sub = await reg.pushManager.getSubscription()
  // A subscription made for another key (the bridge's push.json was reset) cannot be reused.
  if (sub?.options.applicationServerKey && keyOf(sub.options.applicationServerKey) !== publicKey) {
    await sub.unsubscribe()
    sub = null
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64url(publicKey) })
  await client.request("push.subscribe", { subscription: sub.toJSON() })
  return "on"
}

export async function disablePush(client: BridgeClient): Promise<PushState> {
  const sub = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription()
  if (sub) {
    await client.request("push.unsubscribe", { endpoint: sub.endpoint })
    await sub.unsubscribe()
  }
  return "off"
}

/**
 * The page's own desktop notice, through the service worker when there is one so it shares the push's
 * tag: whichever arrives second replaces the first.
 */
export async function showTaskNotice(taskId: string, kind: string, title: string, body: string): Promise<void> {
  const options = { body, tag: `task:${taskId}:${kind}`, icon: "icon-192.png", data: { taskId } }
  const reg = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : undefined
  if (reg) await reg.showNotification(`Rove — ${title}`, options)
  else new Notification(`Rove — ${title}`, options)
}

/** A notification click selects its task: from the worker on an open page, or `?task=` on a fresh one. */
export function followTaskLinks(model: AppModel): () => void {
  const params = new URLSearchParams(window.location.search)
  const fromUrl = params.get("task")
  if (fromUrl) {
    params.delete("task")
    const rest = params.toString()
    history.replaceState(null, "", `${window.location.pathname}${rest ? `?${rest}` : ""}${window.location.hash}`)
    model.selectWhenListed(fromUrl)
  }
  if (!("serviceWorker" in navigator)) return () => {}
  const onMessage = (event: MessageEvent) => {
    const data = event.data as { type?: unknown; taskId?: unknown } | null
    if (data?.type === "rove.openTask" && typeof data.taskId === "string" && data.taskId) {
      model.selectWhenListed(data.taskId)
    }
  }
  navigator.serviceWorker.addEventListener("message", onMessage)
  return () => navigator.serviceWorker.removeEventListener("message", onMessage)
}

function fromB64url(text: string): Uint8Array {
  const raw = atob(text.replace(/-/g, "+").replace(/_/g, "/"))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

function keyOf(key: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(key)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}
