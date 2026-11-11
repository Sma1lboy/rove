import type { ButtonHTMLAttributes } from "react"
import { TOGGLE_DISABLED, chipClass } from "./composer.ts"

/** A composer chip that is on or off (Worktree, Engine there): the accent while on, pressed state for a reader. */
export function ComposerToggle({
  on,
  ...rest
}: { on: boolean } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "type">) {
  return <button type="button" className={`${chipClass(on)} ${TOGGLE_DISABLED}`} aria-pressed={on} {...rest} />
}
