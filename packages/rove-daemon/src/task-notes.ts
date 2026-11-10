/**
 * A task's notes and checklist: what its owner keeps beside the work (`rove api todo`, the web Files
 * panel's Notes tab). Plain data on the task, so the TUI, the web and a phone all read the same copy.
 * Edits are ops applied by the daemon, so two clients adding at once both land.
 */

export interface TaskTodo {
  /** `t<N>`, never reused within a task while a later item exists. */
  readonly id: string
  readonly text: string
  readonly done: boolean
}

export type TodoOp =
  | { readonly op: "add"; readonly text: string }
  | { readonly op: "check"; readonly id: string; readonly done: boolean }
  | { readonly op: "edit"; readonly id: string; readonly text: string }
  | { readonly op: "remove"; readonly id: string }

export const MAX_TODOS = 100
export const MAX_TODO_TEXT = 500
export const MAX_NOTES = 20_000

export class TodoRefusedError extends Error {
  constructor(
    readonly code: "TODO_NOT_FOUND" | "TODO_LIMIT" | "TODO_EMPTY" | "TODO_TOO_LONG" | "NOTES_TOO_LONG",
    message: string,
  ) {
    super(message)
    this.name = "TodoRefusedError"
  }
}

/** One line, trimmed: a todo is a label, not a paragraph. */
function cleanText(raw: string): string {
  const text = raw.replace(/\s+/g, " ").trim()
  if (text.length === 0) throw new TodoRefusedError("TODO_EMPTY", "a todo needs some text")
  if (text.length > MAX_TODO_TEXT) {
    throw new TodoRefusedError("TODO_TOO_LONG", `a todo is at most ${MAX_TODO_TEXT} characters`)
  }
  return text
}

function nextId(todos: readonly TaskTodo[]): string {
  const top = todos.reduce((max, todo) => Math.max(max, Number(todo.id.slice(1)) || 0), 0)
  return `t${top + 1}`
}

/** `todos` after `ops`, in order; a refused op throws and the caller keeps its list. */
export function applyTodoOps(todos: readonly TaskTodo[], ops: readonly TodoOp[]): TaskTodo[] {
  const list = [...todos]
  const find = (id: string): number => {
    const at = list.findIndex((todo) => todo.id === id)
    if (at < 0) throw new TodoRefusedError("TODO_NOT_FOUND", `no todo ${id}`)
    return at
  }
  for (const op of ops) {
    if (op.op === "add") {
      if (list.length >= MAX_TODOS) throw new TodoRefusedError("TODO_LIMIT", `a task holds at most ${MAX_TODOS} todos`)
      list.push({ id: nextId(list), text: cleanText(op.text), done: false })
    } else if (op.op === "check") {
      const at = find(op.id)
      list[at] = { ...(list[at] as TaskTodo), done: op.done }
    } else if (op.op === "edit") {
      const at = find(op.id)
      list[at] = { ...(list[at] as TaskTodo), text: cleanText(op.text) }
    } else {
      list.splice(find(op.id), 1)
    }
  }
  return list
}

export function checkNotes(notes: string): string {
  if (notes.length > MAX_NOTES)
    throw new TodoRefusedError("NOTES_TOO_LONG", `notes are at most ${MAX_NOTES} characters`)
  return notes
}

/** A stored list read back: anything malformed is dropped, an empty result is `undefined`. */
export function coerceTodos(value: unknown): TaskTodo[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out: TaskTodo[] = []
  for (const item of value.slice(0, MAX_TODOS)) {
    const v = item as { id?: unknown; text?: unknown; done?: unknown } | null
    if (typeof v?.id === "string" && /^t\d+$/.test(v.id) && typeof v.text === "string" && v.text.trim().length > 0) {
      out.push({ id: v.id, text: v.text.slice(0, MAX_TODO_TEXT), done: v.done === true })
    }
  }
  return out.length > 0 ? out : undefined
}

/** The `2/5` a row shows: done over all, or null with no todos. */
export function todoCount(todos: readonly TaskTodo[] | undefined): { done: number; total: number } | null {
  if (!todos || todos.length === 0) return null
  return { done: todos.filter((todo) => todo.done).length, total: todos.length }
}

/** Parse the wire form of `ops`; anything off is a refusal of the whole call. */
export function parseTodoOps(value: unknown): TodoOp[] {
  if (!Array.isArray(value)) throw new TodoRefusedError("TODO_EMPTY", "ops must be a list")
  return value.map((raw) => {
    const v = raw as { op?: unknown; id?: unknown; text?: unknown; done?: unknown } | null
    const id = typeof v?.id === "string" ? v.id : ""
    const text = typeof v?.text === "string" ? v.text : ""
    if (v?.op === "add") return { op: "add", text }
    if (v?.op === "edit") return { op: "edit", id, text }
    if (v?.op === "remove") return { op: "remove", id }
    if (v?.op === "check" && typeof v.done === "boolean") return { op: "check", id, done: v.done }
    throw new TodoRefusedError("TODO_EMPTY", "each op is add, check, edit or remove")
  })
}
