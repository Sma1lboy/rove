/**
 * Password login (`rove --web --set-password`). A right password gets a device token of its own,
 * stored exactly as a `#token=` link's; signing out forgets it here and revokes it on the bridge.
 */

import { forgetToken, saveToken, storedToken } from "./auth.ts"
import { bridgeFetch } from "./relay-transport.ts"

type Fetch = (input: string, init?: RequestInit) => Promise<Response>

export type LoginOutcome =
  | { readonly kind: "ok"; readonly token: string }
  | { readonly kind: "wrong" }
  | { readonly kind: "locked"; readonly minutes: number }
  | { readonly kind: "lockedHost" }
  | { readonly kind: "unreachable" }

/** The bridge's answer to `POST /login`, as the login screen shows it. */
export function loginOutcome(status: number, body: unknown): LoginOutcome {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>
  if (status === 200 && typeof b.token === "string" && /^[A-Za-z0-9_-]{43}$/.test(b.token)) {
    return { kind: "ok", token: b.token }
  }
  if (status === 429) {
    if (b.locked === "global") return { kind: "lockedHost" }
    const seconds = typeof b.retryAfterSeconds === "number" ? b.retryAfterSeconds : 900
    return { kind: "locked", minutes: Math.max(1, Math.ceil(seconds / 60)) }
  }
  if (status === 401) return { kind: "wrong" }
  return { kind: "unreachable" }
}

/** True when the bridge has a password set; without one `/login` is just the app shell. */
export async function passwordLoginOn(fetchFn: Fetch = bridgeFetch): Promise<boolean> {
  try {
    const res = await fetchFn("/login", { headers: { Accept: "application/json" }, cache: "no-store" })
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("application/json")) return false
    const body = (await res.json()) as { password?: unknown }
    return body.password === true
  } catch {
    return false
  }
}

export async function submitPassword(password: string, fetchFn: Fetch = bridgeFetch): Promise<LoginOutcome> {
  try {
    const res = await fetchFn("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
      credentials: "omit",
    })
    const outcome = loginOutcome(res.status, await res.json().catch(() => null))
    if (outcome.kind === "ok") saveToken(outcome.token)
    return outcome
  } catch {
    return { kind: "unreachable" }
  }
}

/** Forget this browser's token and revoke it on the bridge (a no-op there for the shared token). */
export async function signOut(fetchFn: Fetch = bridgeFetch): Promise<void> {
  const token = storedToken()
  forgetToken()
  if (!token) return
  await fetchFn("/logout", { method: "POST", headers: { Authorization: `Bearer ${token}` } }).catch(() => {})
}
