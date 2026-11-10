/**
 * Live sockets per credential, so a sign-out or a revoked device ends the
 * connection it is still holding. The token is checked once, at the upgrade;
 * without this a revoked device kept a subscribed socket until it went away.
 *
 * Credentials are the `Conn.credential` strings: a device name, or the shared
 * token's marker.
 */

export interface CredentialSocket {
  readonly data: { readonly credential: string }
  close(code?: number, reason?: string): void
}

/** The browser treats this as "signed out, do not reconnect" (4401 = private). */
export const SIGNED_OUT_CLOSE_CODE = 4401

export class CredentialSockets {
  private readonly byCredential = new Map<string, Set<CredentialSocket>>()

  add(ws: CredentialSocket): void {
    const set = this.byCredential.get(ws.data.credential) ?? new Set<CredentialSocket>()
    set.add(ws)
    this.byCredential.set(ws.data.credential, set)
  }

  remove(ws: CredentialSocket): void {
    const set = this.byCredential.get(ws.data.credential)
    if (!set) return
    set.delete(ws)
    if (set.size === 0) this.byCredential.delete(ws.data.credential)
  }

  /** Close every live socket holding `credential`. Returns how many were closed. */
  closeCredential(credential: string, reason = "signed out"): number {
    const set = this.byCredential.get(credential)
    if (!set) return 0
    this.byCredential.delete(credential)
    for (const ws of set) ws.close(SIGNED_OUT_CLOSE_CODE, reason)
    return set.size
  }
}
