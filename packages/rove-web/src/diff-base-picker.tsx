/** `[ base: main ▾ ]`: compare the task against any branch, tag or recent commit; a typed ref works too. */

import { useEffect, useState } from "react"
import { t } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { requestRemembered } from "./remembered.ts"
import { SuggestField, type Suggestion } from "./suggest-field.tsx"
import { Button } from "./ui/button.tsx"

interface Refs {
  readonly branches: readonly string[]
  readonly remotes: readonly string[]
  readonly tags: readonly string[]
  readonly commits: readonly { readonly sha: string; readonly subject: string }[]
}

type Choice = { readonly ref: string | null; readonly suggestion: Suggestion }

function choices(refs: Refs | null, base: string, typed: string): Choice[] {
  const all: Choice[] = [
    { ref: null, suggestion: { key: "default", text: base, dim: t("review.baseDefault"), accent: true } },
  ]
  const add = (list: readonly string[], kind: string) => {
    for (const ref of list)
      if (ref !== base) all.push({ ref, suggestion: { key: `${kind}:${ref}`, text: ref, dim: kind } })
  }
  add(refs?.branches ?? [], t("review.baseBranch"))
  add(refs?.remotes ?? [], t("review.baseRemote"))
  add(refs?.tags ?? [], t("review.baseTag"))
  for (const c of refs?.commits ?? []) {
    all.push({ ref: c.sha, suggestion: { key: `commit:${c.sha}`, text: c.sha, dim: c.subject } })
  }
  const q = typed.trim().toLowerCase()
  if (q === "") return all.slice(0, 40)
  const hits = all.filter((c) => `${c.suggestion.text} ${c.suggestion.dim ?? ""}`.toLowerCase().includes(q))
  const exact = (c: Choice) => (c.suggestion.text.toLowerCase() === q ? 0 : 1)
  return hits.sort((a, b) => exact(a) - exact(b)).slice(0, 40)
}

export function DiffBasePicker(props: {
  taskId: string
  model: AppModel
  /** The task's own base. */
  base: string
  /** The ref picked by hand; null = the task's base. */
  custom: string | null
  onPick: (ref: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState("")
  const [refs, setRefs] = useState<Refs | null>(null)
  const client = props.model.client
  useEffect(() => {
    if (!open) return
    let live = true
    requestRemembered<Refs>(client, "diff.refs", { taskId: props.taskId }).then(
      (r) => live && setRefs(r),
      () => {},
    )
    return () => {
      live = false
    }
  }, [open, client, props.taskId])
  const items = choices(refs, props.base, typed)
  const pick = (ref: string | null) => {
    props.onPick(ref)
    setOpen(false)
    setTyped("")
  }
  return (
    <span
      className="relative"
      onKeyDown={(e) => {
        // Typing here must not reach the diff view's one-letter keys (r reloads, s sends, c comments).
        e.stopPropagation()
        if (e.key === "Escape" && open) {
          setOpen(false)
        }
      }}
    >
      <Button
        hit="tight"
        aria-expanded={open}
        title={t("review.baseHint")}
        className={props.custom ? "" : "opacity-60 aria-expanded:opacity-100"}
        onClick={() => setOpen(!open)}
      >
        {t("review.basePicker", { base: props.custom ?? props.base })}
      </Button>
      {open && (
        <div className="absolute top-full left-0 z-3 mt-1 w-64 max-w-full rounded-sm border-hairline border-line-active bg-surface p-1 shadow-popover">
          <SuggestField
            field="diff-base"
            autoFocus
            value={typed}
            onChange={setTyped}
            items={items.map((c) => c.suggestion)}
            open
            placeholder={t("review.basePlaceholder")}
            onPick={(i) => pick(items[i]?.ref ?? null)}
            onEnter={() => pick(typed.trim() === "" ? null : typed.trim())}
          />
        </div>
      )}
    </span>
  )
}
