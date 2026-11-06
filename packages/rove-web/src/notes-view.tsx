/** The Files panel's Notes tab: this task's checklist and free-text notes, kept on the task so every client sees them. */

import { useEffect, useRef, useState } from "react"
import type { TaskRow } from "rove-bridge/protocol"
import { prefillEngine } from "./engine-prefill.ts"
import { t, useLocale } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { openTodos, todoPrompt } from "./task-todos.ts"
import { toast } from "./ui.ts"
import { Button } from "./ui/button.tsx"
import { NOTE_AREA, NOTE_FIELD, todoTextClass } from "./ui/notes.ts"

type Op =
  | { readonly op: "add"; readonly text: string }
  | { readonly op: "check"; readonly id: string; readonly done: boolean }
  | { readonly op: "edit"; readonly id: string; readonly text: string }
  | { readonly op: "remove"; readonly id: string }

/** The notes box saves this long after the last keystroke, and at once when it loses focus. */
const SAVE_MS = 700

export function NotesView({ model, task }: { model: AppModel; task: TaskRow }) {
  useLocale()
  const todos = task.todos ?? []
  const [draft, setDraft] = useState("")
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  const [notes, setNotes] = useState(task.notes ?? "")
  const focused = useRef(false)
  const saved = useRef(task.notes ?? "")
  const timer = useRef<number | null>(null)

  // Another client's edit shows here while this box is not being typed in.
  useEffect(() => {
    if (focused.current) return
    saved.current = task.notes ?? ""
    setNotes(task.notes ?? "")
  }, [task.notes])
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    },
    [],
  )

  const send = (body: { ops?: readonly Op[]; notes?: string }) =>
    model.client.request("task.notes", { taskId: task.id, ...body }).catch((err) => toast(String(err), "error"))
  const saveNotes = (value: string) => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
    if (value === saved.current) return
    saved.current = value
    void send({ notes: value })
  }
  const add = () => {
    const text = draft.trim()
    if (text === "") return
    setDraft("")
    void send({ ops: [{ op: "add", text }] })
  }
  const commitEdit = () => {
    if (!editing) return
    const text = editing.text.trim()
    const before = todos.find((todo) => todo.id === editing.id)?.text
    setEditing(null)
    if (text === "") void send({ ops: [{ op: "remove", id: editing.id }] })
    else if (text !== before) void send({ ops: [{ op: "edit", id: editing.id, text }] })
  }
  const prompt = todoPrompt(task)

  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2 font-mono text-meta"
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="flex flex-col gap-0.5">
        {todos.map((todo) => (
          <div key={todo.id} className="flex items-start gap-2 py-0.5">
            <Button
              hit="tight"
              className={todo.done ? "text-subtle" : undefined}
              aria-label={t(todo.done ? "files.todoUncheck" : "files.todoCheck", { text: todo.text })}
              onClick={() => void send({ ops: [{ op: "check", id: todo.id, done: !todo.done }] })}
            >
              {todo.done ? "[x]" : "[ ]"}
            </Button>
            {editing?.id === todo.id ? (
              <input
                className={NOTE_FIELD}
                value={editing.text}
                maxLength={500}
                // biome-ignore lint/a11y/noAutofocus: the field opens from a click on the text it edits
                autoFocus
                aria-label={t("files.todoEdit")}
                onChange={(e) => setEditing({ id: todo.id, text: e.target.value })}
                onBlur={commitEdit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitEdit()
                  else if (e.key === "Escape") setEditing(null)
                }}
              />
            ) : (
              <Button
                variant="row"
                className={todoTextClass(todo.done)}
                title={t("files.todoEdit")}
                onClick={() => setEditing({ id: todo.id, text: todo.text })}
              >
                {todo.text}
              </Button>
            )}
            <Button
              hit="tight"
              className="text-subtle"
              aria-label={t("files.todoRemove", { text: todo.text })}
              onClick={() => void send({ ops: [{ op: "remove", id: todo.id }] })}
            >
              ×
            </Button>
          </div>
        ))}
        <input
          className={NOTE_FIELD}
          value={draft}
          maxLength={500}
          placeholder={t("files.todoAdd")}
          aria-label={t("files.todoAdd")}
          autoComplete="off"
          enterKeyHint="done"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add()
          }}
        />
      </div>
      <div className="flex justify-end">
        <Button
          disabled={!prompt}
          title={prompt ? t("files.todoSendHint", { count: openTodos(task).length }) : t("files.todoNoneOpen")}
          onClick={() => prompt && void prefillEngine(model, task.id, prompt)}
        >
          {t("files.todoSend")}
        </Button>
      </div>
      <textarea
        className={NOTE_AREA}
        value={notes}
        maxLength={20000}
        spellCheck={false}
        placeholder={t("files.notesPlaceholder")}
        aria-label={t("files.notesLabel")}
        onFocus={() => {
          focused.current = true
        }}
        onChange={(e) => {
          setNotes(e.target.value)
          if (timer.current !== null) window.clearTimeout(timer.current)
          const value = e.target.value
          timer.current = window.setTimeout(() => saveNotes(value), SAVE_MS)
        }}
        onBlur={(e) => {
          focused.current = false
          saveNotes(e.target.value)
        }}
      />
    </div>
  )
}
