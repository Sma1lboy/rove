import { PROJECT_ADD, PROJECT_SESSIONS } from "./rail.ts"

/** A project header's hover actions: that project's Sessions page, then a new task in it. */
export function ProjectActions(props: {
  sessionsTitle: string
  onSessions: () => void
  newTaskTitle: string
  onNewTask: () => void
}) {
  return (
    <>
      <button type="button" className={PROJECT_SESSIONS} title={props.sessionsTitle} onClick={props.onSessions}>
        ≡
      </button>
      <button type="button" className={PROJECT_ADD} title={props.newTaskTitle} onClick={props.onNewTask}>
        +
      </button>
    </>
  )
}
