/*
 * Rove's service worker: only Web Push. The bridge sends {taskId, kind, title} when a task finishes,
 * needs you or fails while no page is on screen (rove-bridge/src/push.ts). Every push shows a
 * notification (browsers penalise silent ones); its tag is the page's own, so the page's notice for
 * the same edge replaces it instead of stacking. A click focuses an open page and selects the task,
 * or opens one at `?task=<id>`.
 */

const GLYPH = { done: "✓", needs_input: "?", error: "✕" }

self.addEventListener("install", () => self.skipWaiting())
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()))

self.addEventListener("push", (event) => {
  let message = {}
  try {
    message = event.data ? event.data.json() : {}
  } catch {
    // Not ours: still show something rather than nothing.
  }
  const taskId = typeof message.taskId === "string" ? message.taskId : ""
  const kind = typeof message.kind === "string" ? message.kind : "done"
  const title = typeof message.title === "string" && message.title ? message.title : "Rove"
  event.waitUntil(
    self.registration.showNotification(`Rove — ${title}`, {
      body: GLYPH[kind] ?? "",
      tag: `task:${taskId}:${kind}`,
      icon: "icon-192.png",
      data: { taskId },
    }),
  )
})

/** Select `taskId` in an open page, or open one on it. Its own function so it can be exercised directly. */
async function openTask(taskId) {
  const pages = await self.clients.matchAll({ type: "window", includeUncontrolled: true })
  const page = pages.find((client) => new URL(client.url).origin === self.location.origin)
  if (page) {
    // Focus needs the click's user activation; without it the page still selects the task.
    await page.focus().catch(() => undefined)
    page.postMessage({ type: "rove.openTask", taskId })
    return
  }
  const url = new URL(self.registration.scope)
  if (taskId) url.searchParams.set("task", taskId)
  await self.clients.openWindow(url.href)
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  event.waitUntil(openTask(event.notification.data?.taskId ?? ""))
})
