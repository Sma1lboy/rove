/**
 * The TUI's one "start a new chat" dialog (`tui-react/component/new-chat-dialog.tsx`): an engine
 * (or a shell), where it lands (a tab here, a forked child task, a Scratch task in $HOME) and
 * what it starts from (fresh, or this conversation handed over). A fork carries the composer:
 * message, attempts, branch, attachments.
 */

import { useState } from "react"
import { ChipRow } from "./chip-row.tsx"
import { DialogActions, DialogShell, useSubmit } from "./dialogs.tsx"
import { t, useLocale } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { EnginePicker, SHELL, openTab, useEngineChoice } from "./task-dialogs.tsx"
import { tc } from "./tui-copy.ts"

export type NewChatDestination = "tab" | "fork" | "scratch"
export type NewChatContext = "fresh" | "continue"

const DESTINATIONS: readonly NewChatDestination[] = ["tab", "fork", "scratch"]
const ATTEMPTS = ["1", "2", "3", "4"] as const
const MIMES = ["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf"]

interface Attachment {
  readonly path: string
  readonly kind: string
  readonly name: string
}

/** `images[0]: /path` lines, as the TUI appends them to the first prompt. */
function withRefs(prompt: string, attachments: readonly Attachment[]): string {
  if (attachments.length === 0) return prompt
  const refs = attachments.map((a, i) => `${a.kind === "pdf" ? "pdf" : "images"}[${i}]: ${a.path}`).join("\n")
  return `${prompt}\n\n${refs}`
}

async function toBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ""
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

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
  const [attachments, setAttachments] = useState<readonly Attachment[]>([])
  const { busy, error, setError, submit } = useSubmit()

  // Shell rows exist for fresh tabs here and Scratch; a fork or a continued chat is an engine's.
  const shellOk = context === "fresh" && destination !== "fork"
  const pick = choice.engine === SHELL && !shellOk ? "" : choice.engine
  const shell = pick === SHELL
  const fork = destination === "fork"
  const apply = (dest: NewChatDestination, ctx: NewChatContext) => {
    // Scratch is always fresh: asking to continue from there leaves for a tab here.
    const nextDest = dest === "scratch" && ctx === "continue" && destination === "scratch" ? "tab" : dest
    setDestination(nextDest)
    setContext(nextDest === "scratch" ? "fresh" : ctx)
  }

  const attach = async (files: Iterable<File>) => {
    for (const file of files) {
      if (!MIMES.includes(file.type)) continue
      try {
        const res = await model.client.request<{ path: string; kind: string }>("attachment.put", {
          mime: file.type,
          data: await toBase64(file),
        })
        setAttachments((now) => [...now, { path: res.path, kind: res.kind, name: file.name || res.path }])
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    }
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
      else await openTab(model, taskId, { kind: "engine", engine: pick, prompt: first })
    })

  return (
    <DialogShell title={tc("terminal", "tab.newChat.title")} wide>
      <form
        className="dialog-body"
        onKeyDown={(e) => {
          if (e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === "e") {
            e.preventDefault()
            e.stopPropagation()
            const pool = choice.engines.filter((engine) => engine.ready !== false)
            const next = pool[(pool.findIndex((engine) => engine.id === choice.engine) + 1) % pool.length]
            if (next) choice.setEngine(next.id)
          } else if (e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === "f") {
            e.preventDefault()
            e.stopPropagation()
            apply(destination, context === "fresh" ? "continue" : "fresh")
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
          <EnginePicker engines={choice.engines} value={pick} onChange={choice.setEngine} withShell={shellOk} />
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
        {!shell && destination !== "scratch" && (
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
        {attachments.length > 0 && (
          <div className="chips-row" data-field="attachments">
            {attachments.map((a, i) => (
              <button
                type="button"
                key={a.path}
                className="chip-button is-active"
                title={a.path}
                onClick={() => setAttachments((now) => now.filter((x) => x.path !== a.path))}
              >
                {a.kind === "pdf" ? "pdf" : "images"}[{i}] ×
              </button>
            ))}
          </div>
        )}
        <p className="muted newtask-legend">{tc("quickTask", "legend")}</p>
        {error && <p className="error">{error}</p>}
        <DialogActions busy={busy} submitLabel={t("newChat.start")} />
      </form>
    </DialogShell>
  )
}
