import type { EngineCapabilities, EngineIdentity } from "@/types/engine"
import { codexTerminalPresentation } from "./terminal-presentation"

export const codexCapabilities: EngineCapabilities = {
  preparePromptSubmission: (prompt) => {
    if (/^[\/!]/.test(prompt.trimStart())) return null
    // A trailing space closes mention completion before Tab. Codex trims it on submission.
    return { text: `${prompt} `, key: "\t" }
  },
  terminalPresentation: codexTerminalPresentation,
  // Esc, same as claude — and for the same reason it is written down per
  // engine rather than assumed: codex reads ctrl-C as quit.
  interruptSequence: "\u001b",
}

export const codexIdentity: EngineIdentity = {
  shortName: "Codex",
}
