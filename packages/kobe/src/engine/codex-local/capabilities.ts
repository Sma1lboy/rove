import type { EngineCapabilities, EngineIdentity } from "@/types/engine"
import { codexTerminalPresentation } from "./terminal-presentation"

export const codexCapabilities: EngineCapabilities = {
  preparePromptSubmission: (prompt) => {
    // Close mention completion before Enter. Codex trims the submitted text.
    return /^[\/!]/.test(prompt.trimStart()) ? prompt : `${prompt} `
  },
  // End flushes Codex's native Windows paste burst without editing its text.
  // Enter alone can join an unfinished burst as a newline.
  beforePromptSubmit: "\x1b[F",
  terminalPresentation: codexTerminalPresentation,
  // Esc, same as claude — and for the same reason it is written down per
  // engine rather than assumed: codex reads ctrl-C as quit.
  interruptSequence: "\u001b",
}

export const codexIdentity: EngineIdentity = {
  shortName: "Codex",
}
