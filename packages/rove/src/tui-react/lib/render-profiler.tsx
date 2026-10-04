import { profileTick, renderProfileOn } from "@/lib/render-profile"
import { Profiler, type ReactNode } from "react"

function countCommit(id: string): void {
  profileTick(`commit.${id}`)
}

/** Counts React commits of `children` as `commit.<id>` under `ROVE_RENDER_PROFILE`; a plain fragment otherwise. */
export function RenderProfiler(props: { id: string; children: ReactNode }): ReactNode {
  if (!renderProfileOn) return props.children
  return (
    <Profiler id={props.id} onRender={countCommit}>
      {props.children}
    </Profiler>
  )
}
