/**
 * Image-id allocation for `graphics.write`. Graphics protocols key images by a
 * number global to the TERMINAL, so panes picking their own would collide; the
 * daemon sees every pane, so it hands them out. 24-bit because a virtual
 * placement carries the id in a cell's 8-bit-per-channel foreground colour.
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
      // After 16M ids the old ones are long evicted from the terminal's finite
      // image store, so their ownership records are stale too.
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
