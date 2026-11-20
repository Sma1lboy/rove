/** The page's recent errors in localStorage: a crash, a reload or an upgrade reload keeps what the console said. */

const KEY = "rove.crashLog"
const MAX_ENTRIES = 100
const MAX_ENTRY = 4000

function read(): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]")
    return Array.isArray(raw) ? raw.filter((line): line is string => typeof line === "string") : []
  } catch {
    return []
  }
}

function describe(value: unknown): string {
  if (value instanceof Error) return `${value.message}\n${value.stack ?? ""}`
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function record(kind: string, ...details: unknown[]): void {
  const line = `${new Date().toISOString()} [${kind}] ${details.map(describe).join(" ")}`.slice(0, MAX_ENTRY)
  try {
    localStorage.setItem(KEY, JSON.stringify([...read(), line].slice(-MAX_ENTRIES)))
  } catch {
    // Storage full or blocked: the live console still has it.
  }
}

/** Oldest first, one entry per line block. In devtools: `copy(localStorage["rove.crashLog"])`. */
export function crashLog(): string {
  return read().join("\n")
}

export function captureErrors(): void {
  const original = console.error.bind(console)
  console.error = (...args: unknown[]) => {
    record("error", ...args)
    original(...args)
  }
  window.addEventListener("error", (event) => record("uncaught", event.error ?? event.message))
  window.addEventListener("unhandledrejection", (event) => record("rejection", event.reason))
  // Doesn't bubble: the capture phase sees every canvas in the page.
  document.addEventListener("webglcontextlost", () => record("webgl", "context lost"), true)
}
