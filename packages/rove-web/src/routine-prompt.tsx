/** A routine's prompt (or script command) as readable text: clamped when long, with a toggle to read it all. */

import { useState } from "react"
import { t } from "./i18n/index.ts"
import { Button } from "./ui/button.tsx"
import { RT_PROMPT, RT_PROMPT_CLAMP } from "./ui/routines.ts"

/** Past this many lines or characters the text starts clamped. */
const LONG_LINES = 6
const LONG_CHARS = 420

export function RoutinePrompt({ text, mono = false }: { text: string; mono?: boolean }) {
  const [open, setOpen] = useState(false)
  const long = text.split("\n").length > LONG_LINES || text.length > LONG_CHARS
  return (
    <div className="flex min-w-0 flex-col items-start gap-1">
      <p className={`${mono ? "mono " : ""}${RT_PROMPT} ${long && !open ? RT_PROMPT_CLAMP : ""}`}>{text}</p>
      {long && (
        <Button variant="link" hit="tight" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {t(open ? "pages.routineShowLess" : "pages.routineShowMore")}
        </Button>
      )}
    </div>
  )
}
