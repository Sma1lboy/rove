/** @jsxImportSource @opentui/react */
import { useState } from "react"
import { resolveMainRepoRoot } from "../../state/repos"
import { formatChord } from "../../tui/lib/chord-glyphs"
import { validateRepoPath } from "../../tui/lib/git-snapshot"
import { legendCap } from "../../tui/lib/help-groups"
import { QuickTaskComposer, type QuickTaskResult } from "../component/quick-task-composer"
import { useTheme } from "../context/theme"
import { useT } from "../i18n"
import { useDialog } from "../ui/dialog"
import { quickForkComposerOptions, quickForkDefaultVendor } from "./quick-fork"
import type { WelcomeEnv } from "./welcome-pane"

export function firstTaskRepo(cwd: string): string | null {
  try {
    return validateRepoPath(cwd) === null ? resolveMainRepoRoot(cwd) : null
  } catch {
    return null
  }
}

export function FirstTaskStart(props: { env: WelcomeEnv; onCreate: (repo: string, result: QuickTaskResult) => void }) {
  const { theme } = useTheme()
  const t = useT()
  const dialog = useDialog()
  const [repo] = useState(() => firstTaskRepo(process.cwd()))
  const [opening, setOpening] = useState(false)
  if (repo === null || !props.env.git || props.env.engines.length === 0) return null
  const start = async () => {
    if (opening) return
    setOpening(true)
    try {
      const engines = props.env.engines
      const result = await QuickTaskComposer.show(dialog, {
        ...quickForkComposerOptions(repo, engines, quickForkDefaultVendor(repo, engines), process.cwd()),
        intent: t("onboarding.quickIntent", { key: formatChord(legendCap("task.new") ?? "n") }),
      })
      if (result) props.onCreate(repo, result)
    } finally {
      setOpening(false)
    }
  }
  return (
    <box paddingTop={1} flexDirection="column">
      <box onMouseUp={() => void start()}>
        <text fg={theme.primary}>{t("onboarding.quickStart")}</text>
      </box>
      <text fg={theme.textMuted} wrapMode="word">
        {t("onboarding.quickIntent", { key: formatChord(legendCap("task.new") ?? "n") })}
      </text>
    </box>
  )
}
