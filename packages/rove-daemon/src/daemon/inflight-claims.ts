/**
 * Prompts a `send --if-runnable` has admitted but whose paste the CLI process
 * has not finished yet. The paste happens CLI-side, outside any daemon lock,
 * so should-run reads these as `busy`: two concurrent ticks cannot both pass.
 * In memory on purpose: a daemon restart forgets them, and the expiry bounds a
 * CLI that died between admit and release.
 */

/** Longer than one delivery's worst case (delivery lock wait + submit + engine start). */
export const CLAIM_TTL_MS = 90_000
/** After a landed paste the engine's own `turn-start` has not necessarily arrived yet. */
export const CLAIM_LANDED_GRACE_MS = 15_000

interface Claim {
  readonly taskId: string
  readonly tabId: string | null
  /** An armed delivery already says "busy" from the paste on; no grace needed. */
  readonly covered: boolean
  expiresAt: number
}

export class InflightClaims {
  private readonly claims = new Map<string, Claim>()
  private nextId = 1

  constructor(private readonly now: () => number = Date.now) {}

  /** Synchronous, so an evaluate-then-claim in one handler tick is atomic. */
  claim(taskId: string, tabId: string | null, covered = false): string {
    const id = `c-${this.nextId++}`
    this.claims.set(id, { taskId, tabId, covered, expiresAt: this.now() + CLAIM_TTL_MS })
    return id
  }

  /** A landed, unarmed paste keeps the tab busy a little longer; a failed or armed one frees it at once. */
  release(id: string, landed: boolean): void {
    const claim = this.claims.get(id)
    if (!claim) return
    if (landed && !claim.covered) claim.expiresAt = this.now() + CLAIM_LANDED_GRACE_MS
    else this.claims.delete(id)
  }

  /** An unpinned claim covers any tab, and the reverse; a `--tab new` claim ("new") covers only the rollup. */
  isClaimed(taskId: string, tabId: string | null): boolean {
    const now = this.now()
    for (const [id, claim] of this.claims) {
      if (claim.expiresAt <= now) {
        this.claims.delete(id)
        continue
      }
      if (claim.taskId === taskId && (tabId === null || claim.tabId === null || claim.tabId === tabId)) return true
    }
    return false
  }
}
