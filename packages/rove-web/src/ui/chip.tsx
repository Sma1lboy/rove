import type { ReactNode } from "react"
import { cn } from "./cn.ts"
import { TONE, type Tone } from "./tone.ts"

/** A short status or count beside a row's title: mono, meta size, one tone. */
export function Chip({ tone, children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cn("flex-none font-mono text-meta", tone && TONE[tone])}>{children}</span>
}
