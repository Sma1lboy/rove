/**
 * QR binding: fetch a bot QR, show it, poll until the phone confirms, store
 * the credentials. Output and timing are injected so the flow is tested
 * against recorded iLink answers.
 */

import { type FetchFn, type LoginStatus, fetchLoginQr, pollLoginStatus } from "./ilink.ts"
import type { WeixinAccount, WeixinStore } from "./store.ts"

/** A QR lives for a few minutes; iLink answers `expired` and we fetch another. */
const MAX_QR_REFRESHES = 3
const DEFAULT_TIMEOUT_MS = 8 * 60 * 1000
const POLL_GAP_MS = 1_000

export interface LoginIo {
  /** Show the QR (terminal render + URL) for `url`. */
  showQr(url: string): void
  say(line: string): void
  sleep(ms: number): Promise<void>
  now(): number
}

export type LoginResult =
  | { readonly ok: true; readonly account: WeixinAccount }
  | { readonly ok: false; readonly reason: string }

export async function runQrLogin(
  store: WeixinStore,
  baseUrl: string,
  io: LoginIo,
  fetchFn: FetchFn = fetch,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<LoginResult> {
  let qr = await fetchLoginQr(baseUrl, fetchFn)
  io.say("Scan with WeChat (微信 → 扫一扫), then confirm on the phone:")
  io.showQr(qr.url)
  let pollBase = baseUrl
  let refreshes = 0
  let announcedScan = false
  const deadline = io.now() + timeoutMs
  while (io.now() < deadline) {
    // A dropped poll is retried, not fatal — the phone may still be mid-scan.
    const status = await pollLoginStatus(pollBase, qr.qrcode, fetchFn).catch((): LoginStatus => ({ status: "wait" }))
    switch (status.status) {
      case "scaned":
        if (!announcedScan) io.say("Scanned — confirm on your phone…")
        announcedScan = true
        break
      case "redirect":
        pollBase = status.baseUrl
        break
      case "expired":
        refreshes++
        if (refreshes > MAX_QR_REFRESHES) return { ok: false, reason: "the QR code expired too many times" }
        io.say(`QR expired — here is a new one (${refreshes}/${MAX_QR_REFRESHES}):`)
        qr = await fetchLoginQr(baseUrl, fetchFn)
        pollBase = baseUrl
        announcedScan = false
        io.showQr(qr.url)
        break
      case "confirmed": {
        const previous = store.readAccount()
        const account: WeixinAccount = {
          accountId: status.accountId,
          token: status.token,
          baseUrl: status.baseUrl,
          ownerUserId: status.userId,
          // Re-binding the same bot keeps the people you already allowed.
          allow: previous?.accountId === status.accountId ? previous.allow : [],
          savedAt: new Date(io.now()).toISOString(),
        }
        store.writeAccount(account)
        return { ok: true, account }
      }
      case "wait":
        break
    }
    await io.sleep(POLL_GAP_MS)
  }
  return { ok: false, reason: "timed out waiting for the scan" }
}
