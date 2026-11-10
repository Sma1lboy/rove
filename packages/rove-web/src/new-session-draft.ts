/** The New session composer's unsent draft, kept for a reload of this browser tab as the open composer is. */

const PROMPT_KEY = "rove.web.newSession.prompt"
export const ATTACHMENTS_KEY = "rove.web.newSession.attachments"

// The unsent prompt outlives the view: picking a task unmounts the composer, as switching chats does on claude.ai.
let draft = sessionStorage.getItem(PROMPT_KEY) ?? ""

export function promptDraft(): string {
  return draft
}

export function keepDraft(text: string): void {
  draft = text
  try {
    sessionStorage.setItem(PROMPT_KEY, text)
  } catch {
    // Storage blocked: the draft lives as long as the page.
  }
}
