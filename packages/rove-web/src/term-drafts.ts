/** The unsent message of each task tab's composer. It outlives the composer (switching tabs unmounts it), and a quote lands in it from outside. */

const drafts = new Map<string, string>()
const listeners = new Set<() => void>()

export const draftKey = (taskId: string, tabId: string): string => `${taskId}/${tabId}`

export const getDraft = (key: string): string => drafts.get(key) ?? ""

export function setDraft(key: string, text: string): void {
  if (text === "") drafts.delete(key)
  else drafts.set(key, text)
  for (const listener of listeners) listener()
}

export function subscribeDrafts(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** `quote` after whatever is already typed, a blank line apart. */
export function appendQuote(key: string, quote: string): void {
  const typed = getDraft(key).trimEnd()
  setDraft(key, typed === "" ? quote : `${typed}\n\n${quote}`)
}
