import type { ButtonHTMLAttributes } from "react"

/** A track and a knob, accent when on. `flex-none`: in a flex row it keeps its size beside a long label. */
const TRACK =
  "group relative h-4.5 w-7.5 flex-none justify-self-center rounded-full border-hairline border-line bg-inset transition-[background,border-color] duration-120 ease-[ease] aria-checked:border-accent aria-checked:bg-accent motion-reduce:transition-none"
const KNOB =
  "absolute top-0.5 left-0.5 size-3 rounded-full bg-muted transition-[transform,background] duration-120 ease-[ease] group-aria-checked:[transform:translateX(12px)] group-aria-checked:bg-paper motion-reduce:transition-none"

/** The on/off switch: a `role="switch"` button, so `on` is announced as aria-checked. Name it with `aria-label`. */
export function Switch({
  on,
  ...rest
}: { on: boolean } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "role" | "className" | "aria-checked">) {
  return (
    <button type="button" role="switch" aria-checked={on} className={TRACK} {...rest}>
      <span className={KNOB} />
    </button>
  )
}
