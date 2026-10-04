/**
 * Animal-name worktree dirs (a 26-char ULID overflows the terminal pane):
 *
 *   ~/.rove/worktrees/<repo-key>/panda/
 *   ~/.rove/worktrees/<repo-key>/panda-v2/   # if `panda` was recycled
 *
 * Occupied = slugs of active tasks ∪ dirs on disk under managed roots ∪ picks
 * not yet committed. Pick randomly from {@link ANIMAL_NAMES} minus occupied;
 * if exhausted (~410 active worktrees in one repo), suffix `-v2`, `-v3`…
 *
 * `allocate()`/`claim()` serialize on one chain promise and re-read occupied
 * inside it, so concurrent calls see each other's pending picks. In-process
 * serialization suffices: one daemon owns the task store.
 */

import { WorktreeNameTakenError } from "../errors.ts"
import { ANIMAL_NAMES } from "./animal-names.ts"
import { listWorktreeDirNames } from "./paths.ts"

/** Slugs of active tasks; injected so tests needn't build a TaskIndexStore. */
export type ActiveSlugSource = (repo: string) => readonly string[]

export interface SlugAllocatorOptions {
  readonly random?: () => number
  /** Tests use a tiny pool to reach the `-v2` fallback in one cycle. */
  readonly pool?: readonly string[]
}

export class SlugAllocator {
  private readonly random: () => number
  private readonly pool: readonly string[]
  /** Per repo, so different repos can share a short slug. */
  private readonly pendingByRepo = new Map<string, Set<string>>()
  private chain: Promise<void> = Promise.resolve()

  constructor(
    private readonly activeSlugs: ActiveSlugSource,
    options: SlugAllocatorOptions = {},
  ) {
    this.random = options.random ?? Math.random
    this.pool = options.pool ?? ANIMAL_NAMES
    if (this.pool.length === 0) {
      throw new Error("SlugAllocator: animal pool cannot be empty")
    }
  }

  /** Must be followed by {@link commit} (persisted) or {@link cancel};
   *  otherwise the slug stays pending, unpickable, for the process lifetime. */
  async allocate(repo: string): Promise<string> {
    const previous = this.chain
    let release!: () => void
    this.chain = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      return await this.pickLocked(repo)
    } finally {
      release()
    }
  }

  /**
   * CALLER-CHOSEN slug (`add --worktree-name`), checked against the same
   * occupied set. Never falls back to `-v2`: the caller named it so a script
   * can predict the path. Same chain as {@link allocate}.
   */
  async claim(repo: string, slug: string): Promise<string> {
    const previous = this.chain
    let release!: () => void
    this.chain = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      const occupied = await this.occupiedSlugs(repo)
      if (occupied.has(slug)) throw new WorktreeNameTakenError(slug)
      this.addPending(repo, slug)
      return slug
    } finally {
      release()
    }
  }

  /** Persisted: the task store now marks it occupied. */
  commit(repo: string, slug: string): void {
    this.deletePending(repo, slug)
  }

  /** Aborted before persist; same effect as commit, different intent. */
  cancel(repo: string, slug: string): void {
    this.deletePending(repo, slug)
  }

  // --- internals ---

  private async pickLocked(repo: string): Promise<string> {
    const occupied = await this.occupiedSlugs(repo)
    const candidates = this.pool.filter((n) => !occupied.has(n))
    if (candidates.length > 0) {
      const pick = candidates[Math.floor(this.random() * candidates.length)]!
      this.addPending(repo, pick)
      return pick
    }
    // Pool exhausted; unbounded loop, in practice never past v2.
    const base = this.pool[Math.floor(this.random() * this.pool.length)]!
    for (let v = 2; ; v++) {
      const candidate = `${base}-v${v}`
      if (!occupied.has(candidate)) {
        this.addPending(repo, candidate)
        return candidate
      }
    }
  }

  private async occupiedSlugs(repo: string): Promise<Set<string>> {
    const set = new Set<string>(this.pendingByRepo.get(repo) ?? [])
    for (const slug of this.activeSlugs(repo)) {
      if (slug) set.add(slug)
    }
    // Remote listing is an ssh round-trip; awaiting is safe under the chain.
    for (const dir of await listWorktreeDirNames(repo)) {
      set.add(dir)
    }
    return set
  }

  private addPending(repo: string, slug: string): void {
    let pending = this.pendingByRepo.get(repo)
    if (!pending) {
      pending = new Set<string>()
      this.pendingByRepo.set(repo, pending)
    }
    pending.add(slug)
  }

  private deletePending(repo: string, slug: string): void {
    const pending = this.pendingByRepo.get(repo)
    if (!pending) return
    pending.delete(slug)
    if (pending.size === 0) this.pendingByRepo.delete(repo)
  }
}
