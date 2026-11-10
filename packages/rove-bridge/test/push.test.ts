import { describe, expect, test } from "bun:test"
import { createECDH } from "node:crypto"
import { mkdtempSync, readFileSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { TasksPayload } from "../src/protocol.ts"
import { PushHub, type PushMessage } from "../src/push.ts"
import { b64url } from "../src/web-push.ts"

const ua = createECDH("prime256v1")
ua.generateKeys()
const sub = (endpoint: string) => ({
  endpoint,
  keys: { p256dh: b64url(ua.getPublicKey()), auth: b64url(Buffer.alloc(16, 1)) },
})
const tasks = (states: Record<string, string>) =>
  ({
    tasks: Object.entries(states).map(([id, state]) => ({ id, title: `T ${id}`, activity: { state, forMs: 0 } })),
  }) as unknown as TasksPayload

function hub(opts: { crossTask?: boolean; valid?: (c: string) => boolean; status?: number } = {}) {
  const path = join(mkdtempSync(join(tmpdir(), "rove-push-")), "bridge", "push.json")
  const sent: { endpoint: string; message: PushMessage }[] = []
  let listener: ((p: TasksPayload) => void) | null = null
  const h = new PushHub({
    path,
    feed: {
      subscribe(l) {
        listener = l
        return () => {
          listener = null
        }
      },
    },
    crossTask: () => opts.crossTask ?? true,
    credentialValid: opts.valid ?? (() => true),
    send: async (target, message) => {
      sent.push({ endpoint: target.endpoint, message })
      return opts.status ?? 201
    },
  })
  const push = (states: Record<string, string>) => h.onTasks(tasks(states))
  return { h, path, sent, push, following: () => listener !== null }
}

const FCM = "https://fcm.googleapis.com/fcm/send/a"

describe("PushHub", () => {
  test("keys and subscriptions live in an owner-only file; the task list is read only while someone is subscribed", () => {
    const { h, path, following } = hub()
    expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(following()).toBe(false)
    h.subscribe(sub(FCM), "phone")
    expect(following()).toBe(true)
    expect(JSON.parse(readFileSync(path, "utf8")).subscriptions[0].credential).toBe("phone")
    expect(h.unsubscribe(FCM, "someone-else")).toBe(false)
    expect(h.unsubscribe(FCM, "phone")).toBe(true)
    expect(following()).toBe(false)
  })

  test("the first list only seeds; a task entering done or needs-you is pushed once", async () => {
    const { h, sent, push } = hub()
    h.subscribe(sub(FCM), "phone")
    await push({ a: "turn_complete", b: "running" })
    expect(sent).toEqual([])
    await push({ a: "turn_complete", b: "permission_needed" })
    await push({ a: "turn_complete", b: "permission_needed" })
    expect(sent).toEqual([{ endpoint: FCM, message: { taskId: "b", kind: "needs_input", title: "T b" } }])
  })

  test("nothing is pushed while a page is on screen, or with cross-task notices off", async () => {
    const shown = hub()
    shown.h.subscribe(sub(FCM), "phone")
    await shown.push({ a: "running" })
    shown.h.setVisible("bridge-1", true)
    await shown.push({ a: "turn_complete" })
    expect(shown.sent).toEqual([])
    shown.h.setVisible("bridge-1", false)
    await shown.push({ a: "running" })
    await shown.push({ a: "turn_complete" })
    expect(shown.sent.length).toBe(1)

    const off = hub({ crossTask: false })
    off.h.subscribe(sub(FCM), "phone")
    await off.push({ a: "running" })
    await off.push({ a: "turn_complete" })
    expect(off.sent).toEqual([])
  })

  test("a revoked credential's subscription is dropped unsent, and a push service's 410 drops its own", async () => {
    const revoked = hub({ valid: (c) => c !== "old-phone" })
    revoked.h.subscribe(sub(FCM), "old-phone")
    await revoked.push({ a: "running" })
    await revoked.push({ a: "turn_complete" })
    expect(revoked.sent).toEqual([])
    expect(JSON.parse(readFileSync(revoked.path, "utf8")).subscriptions).toEqual([])

    const gone = hub({ status: 410 })
    gone.h.subscribe(sub(FCM), "phone")
    await gone.push({ a: "running" })
    await gone.push({ a: "error" })
    expect(gone.sent.length).toBe(1)
    expect(gone.h.subscribed(FCM, "phone")).toBe(false)
  })

  test("only a browser push service and well-formed keys can subscribe", () => {
    const { h } = hub()
    expect(() => h.subscribe(sub("https://192.168.1.5/hook"), "phone")).toThrow(/push service/)
    expect(() =>
      h.subscribe({ ...sub(FCM), keys: { p256dh: b64url(Buffer.alloc(65)), auth: b64url(Buffer.alloc(16)) } }, "p"),
    ).toThrow(/P-256/)
    expect(() => h.subscribe({ ...sub(FCM), keys: { p256dh: b64url(ua.getPublicKey()), auth: "AAAA" } }, "p")).toThrow(
      /16 bytes/,
    )
  })
})
