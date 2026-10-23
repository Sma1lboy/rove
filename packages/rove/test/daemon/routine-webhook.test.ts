import { createHmac } from "node:crypto"
import { describe, expect, it } from "vitest"
import { runAutomationOnce } from "../../../rove-daemon/src/daemon/automation-runner.ts"
import {
  newWebhookSecret,
  readWebhookEvent,
  webhookSignatureValid,
} from "../../../rove-daemon/src/daemon/automation-webhook.ts"
import { AUTOMATION_HANDLERS } from "../../../rove-daemon/src/daemon/handlers-automations.ts"
import { NOW, automation, fakeDeps, tempStore } from "./automation-runner-fixtures.ts"

const sign = (secret: string, body: string) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`

const issueBody = (action: string) =>
  JSON.stringify({
    action,
    repository: { full_name: "Sma1lboy/rove" },
    issue: { number: 7, html_url: "https://github.com/Sma1lboy/rove/issues/7" },
  })

describe("webhook signature", () => {
  it("accepts GitHub's sha256 HMAC of the exact body and nothing else", () => {
    const secret = newWebhookSecret()
    const body = issueBody("opened")
    expect(webhookSignatureValid(secret, body, sign(secret, body))).toBe(true)
    expect(webhookSignatureValid(secret, `${body} `, sign(secret, body))).toBe(false)
    expect(webhookSignatureValid("other", body, sign(secret, body))).toBe(false)
    expect(webhookSignatureValid(secret, body, null)).toBe(false)
    expect(webhookSignatureValid(secret, body, "sha256=abc")).toBe(false)
  })
})

describe("readWebhookEvent", () => {
  it("names the event, action, item and link", () => {
    expect(readWebhookEvent("issues", issueBody("opened"))).toEqual({
      name: "issues",
      action: "opened",
      summary: "issues.opened Sma1lboy/rove#7 https://github.com/Sma1lboy/rove/issues/7",
    })
  })

  it("still fires on a body that is not JSON", () => {
    expect(readWebhookEvent(null, "x=1")).toEqual({ name: "unknown", summary: "unknown" })
  })
})

describe("runAutomationOnce on a webhook", () => {
  it("runs the precheck with the event in its env and says what fired it", async () => {
    const store = await tempStore()
    const { deps, created, prompts } = fakeDeps({ store })
    const a = await store.create(
      automation({ precheck: { command: 'test "$ROVE_WEBHOOK_ACTION" = opened', timeoutSeconds: 10 } }),
    )

    const closed = readWebhookEvent("issues", issueBody("closed"))
    expect(await runAutomationOnce(deps, a, { scheduledFor: NOW, trigger: "webhook", event: closed })).toBe(
      "skipped_precheck",
    )
    expect(created).toEqual([])

    const opened = readWebhookEvent("issues", issueBody("opened"))
    expect(await runAutomationOnce(deps, a, { scheduledFor: NOW, trigger: "webhook", event: opened })).toBe(
      "dispatched",
    )
    expect(prompts[0]).toContain(`\n\nFired by webhook: ${opened.summary}\n\nrun the audit`)
    expect(store.runsFor(a.id)[0]).toMatchObject({ trigger: "webhook", event: opened.summary })
  })
})

describe("automation.webhook", () => {
  const handler = AUTOMATION_HANDLERS.find((h) => h.name === "automation.webhook")!

  it("answers without running for an unknown id, a bad signature, a ping and a paused routine", async () => {
    const store = await tempStore()
    const secret = "s3cret"
    const on = await store.create(automation({ webhook: { secret } }))
    const plain = await store.create(automation())
    const paused = await store.create(automation({ webhook: { secret }, enabled: false }))
    const ctx = { automations: store } as never
    const body = issueBody("opened")
    const call = (id: string, event: string, signature: string) =>
      handler.handle({ id, event, body, signature }, ctx) as Promise<{ verdict: string }>

    expect((await call("nope", "issues", sign(secret, body))).verdict).toBe("not_found")
    expect((await call(plain.id, "issues", sign(secret, body))).verdict).toBe("not_found")
    expect((await call(on.id, "issues", sign("wrong", body))).verdict).toBe("bad_signature")
    expect((await call(on.id, "ping", sign(secret, body))).verdict).toBe("pong")
    expect((await call(paused.id, "issues", sign(secret, body))).verdict).toBe("disabled")
    expect(store.runsFor(on.id)).toEqual([])
  })
})
