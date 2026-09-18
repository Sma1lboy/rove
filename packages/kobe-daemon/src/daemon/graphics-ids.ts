/**
 * Image-id allocation for the `graphics.write` broadcast.
 *
 * Terminal graphics protocols key an image by a number that is global to the
 * TERMINAL, not to the pane that produced it: two panes left to pick their
 * own would both pick 1 and overwrite each other's picture. The daemon is the
 * only process that sees every pane, so it is the only place the number can be
 * handed out — that is the whole of this module.
 *
 * Ids are 24-bit because that is the width a caller can address: a virtual
 * placement carries the id in a cell's 8-bit-per-channel foreground colour.
 *
 * Product-neutral by construction: nothing here knows, or can know, what the
 * bytes behind an id are — an image viewer, a chart pane and a browser all
 * allocate from the same counter.
 */

/** Largest id addressable through an 8-bit-per-channel foreground colour. */
const MAX_IMAGE_ID = 0xff_ff_ff

/** Per-tab image ids, so a caller can REPLACE its own picture instead of
 *  leaking a fresh id per frame — and cannot replace anybody else's. */
export class GraphicsImageIds {
  /** tab key → ids this tab owns. */
  private readonly owned = new Map<string, Set<number>>()
  private next = 1

  /** `taskId` + `tabId` as one map key. */
  static key(taskId: string, tabId: string): string {
    return `${taskId}::${tabId}`
  }

  /** Hand this tab a fresh id nobody else holds. */
  allocate(taskId: string, tabId: string): number {
    if (this.next > MAX_IMAGE_ID) {
      // 16M ids into one daemon's life. Every id handed out before the wrap
      // is long since evicted from the terminal's own (finite) image store,
      // so the ownership records are stale too — drop them with the counter
      // rather than carry a map that can only grow.
      this.next = 1
      this.owned.clear()
    }
    const id = this.next++
    const key = GraphicsImageIds.key(taskId, tabId)
    const ids = this.owned.get(key)
    if (ids) ids.add(id)
    else this.owned.set(key, new Set([id]))
    return id
  }

  /** True when this tab may write to `id` — i.e. it allocated it. */
  owns(taskId: string, tabId: string, id: number): boolean {
    return this.owned.get(GraphicsImageIds.key(taskId, tabId))?.has(id) === true
  }

  /** Forget a closed tab's ids. Its pictures go with its cells. */
  clearTab(taskId: string, tabId: string): void {
    this.owned.delete(GraphicsImageIds.key(taskId, tabId))
  }
}
