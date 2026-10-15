/**
 * The TUI's one "start a new chat" dialog (`tui-react/component/new-chat-dialog.tsx`): an engine
 * (or a shell), where it lands (a tab here, a forked child task, a Scratch task in $HOME) and
 * what it starts from (fresh, or this conversation handed over). A fork carries the composer:
 * message, attempts, branch, attachments.
 */

import { useState } from "react"
import { AttachmentChips, useAttachments, withRefs } from "./attachments.tsx"
import { ChipRow } from "./chip-row.tsx"
import { DialogActions, DialogShell, useSubmit } from "./dialogs.tsx"
import { t, useLocale } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { ATTEMPTS } from "./quick-start-dialog.tsx"
import { cycleStop } from "./tab-stops.ts"
import { EnginePicker, SHELL, isPane, openTab, paneIdOf, useEngineChoice, usePanes } from "./task-dialogs.tsx"
import { tc } from "./tui-copy.ts"

export type NewChatDestination = "tab" | "fork" | "scratch"
export type NewChatContext = "fresh" | "continue"

const DESTINATIONS: readonly NewChatDestination[] = ["tab", "fork", "scratch"]

/**
 * The fork composer's Tab order (the TUI composer's prompt → attempts → engine → branch), then the
 * destination chip: here the composer shares a dialog with the picker, so Tab must still reach it.
 */
const FORK_STOPS = ["message", "attempts", "engine", "fork-base", "destination"] as const

export function NewChatDialog(props: {
  model: AppModel
  taskId: string
  destination?: NewChatDestination
  context?: NewChatContext
}) {
  useLocale()
  const { model, taskId } = props
  const choice = useEngineChoice(model)
  const [destination, setDestination] = useState<NewChatDestination>(props.destination ?? "tab")
  const [context, setContext] = useState<NewChatContext>(props.context ?? "fresh")
  const [prompt, setPrompt] = useState("")
  const [attempts, setAttempts] = useState("1")
  const task = model.tasks.get()?.tasks.find((row) => row.id === taskId)
  const [baseRef, setBaseRef] = useState(task?.branch ?? "main")
  const { busy, error, setError, submit } = useSubmit()
  const { attachments, attach, remove } = useAttachments(model, setError)

  // Shell rows exist for fresh tabs here and Scratch; a fork or a continued chat is an engine's.
  const shellOk = context === "fresh" && destination !== "fork"
  // Plugin panes, like the TUI picker, only run in a fresh tab here.
  const paneOk = destination === "tab" && context === "fresh"
  const panes = usePanes(model)
  const pick = (choice.engine === SHELL && !shellOk) || (isPane(choice.engine) && !paneOk) ? "" : choice.engine
  const shell = pick === SHELL
  const pane = isPane(pick)
  const fork = destination === "fork"
  const apply = (dest: NewChatDestination, ctx: NewChatContext) => {
    // Scratch is always fresh: asking to continue from there leaves for a tab here.
    const nextDest = dest === "scratch" && ctx === "continue" && destination === "scratch" ? "tab" : dest
    setDestination(nextDest)
    setContext(nextDest === "scratch" ? "fresh" : ctx)
  }

  const handoff = async (): Promise<string> => {
    const res = await model.client.request<{ kind: string; prompt?: string; engine?: string }>("tab.handoff", {
      taskId,
      tabId: model.selection.get().tabId ?? undefined,
    })
    if (res.kind === "handoff" && res.prompt) return res.prompt
    throw new Error(
      res.kind === "no-transcript"
        ? tc("terminal", "tab.noTranscriptToHandOff", { engine: res.engine ?? "" })
        : tc("terminal", "tab.nothingToFork"),
    )
  }

  const create = () =>
    submit(async () => {
      const lead = context === "continue" ? await handoff() : ""
      const message = withRefs(prompt.trim(), attachments)
      const first = [lead, message].filter(Boolean).join("\n\n")
      if (destination === "scratch") {
        const made = await model.client.request<{ taskId: string }>("task.openScratch", shell ? {} : { engine: pick })
        if (shell) await openTab(model, made.taskId, { kind: "shell" })
        else model.selectWhenListed(made.taskId)
      } else if (fork) {
        if (!task) throw new Error(tc("terminal", "tab.tabGone"))
        if (!prompt.trim()) throw new Error(t("taskops.forkNeedsMessage"))
        const res = await model.client.request<{ taskIds: string[] }>("tab.forkTask", {
          repo: task.repo,
          baseBranch: baseRef.trim() || task.branch,
          prompt: first,
          ...(pick ? { engine: pick } : {}),
          ...(Number(attempts) > 1 ? { count: Number(attempts) } : {}),
        })
        const created = res.taskIds[0]
        if (created) model.selectWhenListed(created)
      } else if (shell) await openTab(model, taskId, { kind: "shell" })
      else if (pane) {
        const { selection } = model
        const host = selection.get().taskId === taskId ? selection.get().tabId : null
        const opened = await model.client.request<{ tabId: string }>("plugin.paneOpen", {
          taskId,
          pane: paneIdOf(pick),
          ...(host ? { tabId: host } : {}),
        })
        await model.refreshTabsNow()
        model.select(taskId, opened.tabId)
      } else await openTab(model, taskId, { kind: "engine", engine: pick, prompt: first })
    })

  return (
    <DialogShell title={tc("terminal", "tab.newChat.title")} wide>
      <form
        className="dialog-body"
        onKeyDown={(e) => {
          if (e.key === "Tab" && !e.ctrlKey && !e.metaKey && !e.altKey && (fork || !e.shiftKey)) {
            // Fork: the composer's field cycle. Otherwise the picker's: next destination (Shift+Tab stays the browser's).
            e.preventDefault()
            e.stopPropagation()
            if (fork) cycleStop(e.currentTarget, FORK_STOPS, e.shiftKey ? -1 : 1)
            else apply(DESTINATIONS[(DESTINATIONS.indexOf(destination) + 1) % DESTINATIONS.length] ?? "tab", context)
          } else if (e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === "e") {
            e.preventDefault()
            e.stopPropagation()
            const pool = choice.engines.filter((engine) => engine.ready !== false)
            const next = pool[(pool.findIndex((engine) => engine.id === choice.engine) + 1) % pool.length]
            if (next) choice.setEngine(next.id)
          } else if (e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === "f") {
            e.preventDefault()
            e.stopPropagation()
            apply(destination, context === "fresh" ? "continue" : "fresh")
          } else if (
            e.key === "Enter" &&
            fork &&
            (e.target as HTMLElement).closest("[data-field=attempts], [data-field=engine]")
          ) {
            // The composer's chip rows have no text cursor, so Enter there creates (as the TUI).
            e.preventDefault()
            e.currentTarget.requestSubmit()
          }
        }}
        onSubmit={(e) => {
          e.preventDefault()
          void create()
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          void attach(Array.from(e.dataTransfer.files))
        }}
      >
        <div className="field">
          <span className="kicker">{tc("terminal", "tab.newChat.engine")}</span>
          <EnginePicker
            engines={choice.engines}
            value={pick}
            onChange={choice.setEngine}
            withShell={shellOk}
            panes={paneOk ? panes : []}
          />
        </div>
        <div className="field">
          <span className="kicker">{tc("terminal", "tab.newChat.destLabel")}</span>
          <ChipRow
            label={tc("terminal", "tab.newChat.destLabel")}
            field="destination"
            value={destination}
            onChange={(id) => apply(id as NewChatDestination, context)}
            choices={DESTINATIONS.map((id) => ({
              id,
              label: tc("terminal", `tab.newChat.dest${id === "tab" ? "Tab" : id === "fork" ? "Fork" : "Scratch"}`),
            }))}
          />
        </div>
        <div className="field">
          <span className="kicker">{tc("terminal", "tab.newChat.ctxLabel")} · ctrl+f</span>
          <ChipRow
            label={tc("terminal", "tab.newChat.ctxLabel")}
            field="context"
            value={context}
            onChange={(id) => apply(destination, id === "continue" ? "continue" : "fresh")}
            choices={(["fresh", "continue"] as const).map((id) => ({
              id,
              label: tc("terminal", `tab.newChat.ctx${id === "fresh" ? "Fresh" : "Continue"}`),
            }))}
          />
        </div>
        {fork && (
          <>
            <div className="field">
              <span className="kicker">{tc("quickTask", "attemptsLabel")}</span>
              <ChipRow
                label={tc("quickTask", "attemptsLabel")}
                field="attempts"
                value={attempts}
                onChange={setAttempts}
                choices={ATTEMPTS.map((n) => ({ id: n, label: n }))}
              />
            </div>
            <label className="field">
              <span className="kicker">{t("taskops.forkBranch")}</span>
              <input
                className="input"
                data-field="fork-base"
                spellCheck={false}
                value={baseRef}
                onChange={(e) => setBaseRef(e.target.value)}
              />
            </label>
          </>
        )}
        {!shell && !pane && destination !== "scratch" && (
          <label className="field">
            <span className="kicker">{t("newChat.prompt")}</span>
            <textarea
              className="input textarea"
              data-field="message"
              // biome-ignore lint/a11y/noAutofocus: the dialog's main field
              autoFocus
              rows={4}
              placeholder={t("newChat.promptPlaceholder")}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onPaste={(e) => {
                const files = Array.from(e.clipboardData.files)
                if (files.length === 0) return
                e.preventDefault()
                void attach(files)
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit()
              }}
            />
          </label>
        )}
        <AttachmentChips attachments={attachments} onRemove={remove} />
        <p className="muted newtask-legend">{tc("quickTask", "legend")}</p>
        {error && <p className="error">{error}</p>}
        <DialogActions busy={busy} submitLabel={t("newChat.start")} />
      </form>
    </DialogShell>
  )
}
