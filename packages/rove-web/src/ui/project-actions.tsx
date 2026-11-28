import { t } from "../i18n/index.ts"
import { openSessions } from "../layout.ts"
import { Chevron } from "./chevron.tsx"
import { PROJECT_ADD, PROJECT_NAME, PROJECT_TOGGLE, projectChevron } from "./rail.ts"

export function GroupActions(props: {
  label: string
  repo?: string | undefined
  collapsed: boolean
  onToggle: () => void
  onNewTask?: (() => void) | undefined
}) {
  const { repo, label, collapsed } = props
  const foldLabel = t(collapsed ? "rail.expandGroup" : "rail.collapseGroup", { name: label })
  return (
    <>
      {repo && (
        <button type="button" className={PROJECT_NAME} title={repo} onClick={() => openSessions(repo)}>
          <span className="truncate">{label}</span>
        </button>
      )}
      <button
        type="button"
        className={`${PROJECT_TOGGLE} ${repo ? "min-w-6 shrink-0 justify-center" : "-ml-1"}`}
        aria-label={repo ? foldLabel : undefined}
        aria-expanded={!collapsed}
        title={foldLabel}
        onClick={props.onToggle}
      >
        {!repo && <span className="truncate">{label}</span>}
        <Chevron right={collapsed} className={projectChevron(collapsed)} />
      </button>
      {props.onNewTask && (
        <button type="button" className={PROJECT_ADD} title={t("rail.newTask")} onClick={props.onNewTask}>
          +
        </button>
      )}
    </>
  )
}
