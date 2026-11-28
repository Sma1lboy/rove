/** The project popover's "+ Open folder…": walks the daemon machine's folders and picks one, or takes a pasted path. */

import { Fragment, useEffect, useRef, useState } from "react"
import { t } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { splitRepoRow, stripTrailingSlash } from "./new-task-paths.ts"
import { Button } from "./ui/button.tsx"
import {
  CHECK,
  CLIP_HEAD,
  DIM,
  EMPTY_NOTE,
  HEADING,
  HINT,
  NAME,
  ROWS,
  RULE,
  WIDE_MENU,
  rowClass,
} from "./ui/composer.ts"
import { PALETTE_INPUT } from "./ui/shell.ts"
import { KICKER } from "./ui/text.ts"

interface Listing {
  /** The folder listed, ending in its separator. */
  readonly base: string
  readonly names: readonly string[]
  readonly git: readonly string[]
  /** The typed text itself when it names a real folder. */
  readonly dir: string | null
}

const UP = "\0up"
const USE = "\0use"
const USE_TYPED = "\0use-typed"
const BACK = "\0back"

/** A pasted path rather than a filter: the bridge normalizes quotes, `file://` and `\\?\` itself. */
function isPasted(text: string): boolean {
  return /^(?:[~/'"]|file:|[A-Za-z]:[\\/]|\\\\)/i.test(text.trim())
}

function parentOf(base: string): string {
  const { dir } = splitRepoRow(stripTrailingSlash(base))
  return dir || base
}

export function FolderBrowser(props: {
  model: AppModel
  /** Where it opens, ending in a separator. */
  start: string
  onUse: (path: string) => void
  onBack: () => void
}) {
  const [dir, setDir] = useState(props.start)
  const [text, setText] = useState("")
  const [cursor, setCursor] = useState(0)
  const [list, setList] = useState<Listing | null>(null)
  const pasted = isPasted(text)
  useEffect(() => {
    let stale = false
    props.model.client
      .request<Listing>("fs.subdirs", { path: pasted ? text.trim() : dir + text })
      .then((res) => {
        if (stale) return
        setList(res)
        // `~/` comes back expanded: walk on from the real folder.
        if (!text && res.base && res.base !== dir) setDir(res.base)
      })
      .catch(() => !stale && setList(null))
    return () => {
      stale = true
    }
  }, [props.model, dir, text, pasted])
  const active = useRef<HTMLButtonElement>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-scroll when the cursor or the list moves
  useEffect(() => {
    active.current?.scrollIntoView({ block: "nearest" })
  }, [cursor, list])

  const base = list?.base || dir
  const here = stripTrailingSlash(base)
  const typed = pasted && list?.dir ? list.dir : null
  const rows: { key: string; text: string; dim?: string }[] = [
    ...(typed ? [{ key: USE_TYPED, text: t("newSession.folderUse", { name: typed }) }] : []),
    ...(!text && parentOf(base) !== base ? [{ key: UP, text: "..", dim: t("newSession.folderParent") }] : []),
    ...(list?.names ?? []).map((name) => ({
      key: name,
      text: `${name}/`,
      dim: list?.git.includes(name) ? t("newSession.folderGit") : undefined,
    })),
    // A pasted folder's own row says where it lands; "Use" the listed parent beside it would be a second answer.
    ...(typed ? [] : [{ key: USE, text: t("newSession.folderUse", { name: splitRepoRow(here).base || here }) }]),
    { key: BACK, text: t("newSession.folderBack") },
  ]
  const actions = rows.findIndex((row) => row.key === USE || row.key === BACK)
  const at = Math.min(cursor, rows.length - 1)
  const empty = list !== null && list.names.length === 0 && !typed

  const go = (next: string) => {
    setDir(next)
    setText("")
    setCursor(0)
  }
  const open = (key: string) => {
    if (key === UP) return go(parentOf(base))
    if (key === USE || key === USE_TYPED || key === BACK) return pick(key)
    go(base + key + (base.endsWith("\\") ? "\\" : "/"))
  }
  const pick = (key: string) => {
    if (key === BACK) return props.onBack()
    if (key === UP) return go(parentOf(base))
    if (key === USE_TYPED && typed) return props.onUse(typed)
    if (key === USE) return props.onUse(here)
    props.onUse(base + key)
  }

  return (
    <div className={WIDE_MENU}>
      <Button
        variant="row"
        className={`${HEADING} ${KICKER} flex min-w-0 gap-2 text-muted`}
        tabIndex={-1}
        title={base}
        onClick={props.onBack}
      >
        <span className="flex-none">‹ {t("newSession.openFolderHeading")}</span>
        <span className={CLIP_HEAD}>
          <bdi>{base}</bdi>
        </span>
      </Button>
      <input
        className={PALETTE_INPUT}
        // biome-ignore lint/a11y/noAutofocus: the browser's only field
        autoFocus
        spellCheck={false}
        placeholder={t("newSession.folderFilter")}
        value={text}
        onChange={(e) => {
          setCursor(0)
          setText(e.target.value)
        }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return
          const row = rows[at]
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault()
            setCursor(Math.max(0, Math.min(rows.length - 1, at + (e.key === "ArrowDown" ? 1 : -1))))
          } else if (e.key === "Enter") {
            e.preventDefault()
            if (row) pick(row.key)
          } else if (e.key === "Escape") {
            e.preventDefault()
            e.stopPropagation()
            props.onBack()
          } else if (!text && (e.key === "ArrowLeft" || e.key === "Backspace")) {
            e.preventDefault()
            go(parentOf(base))
          } else if ((e.key === "ArrowRight" && !text) || e.key === "Tab") {
            // Only a folder row opens; the action rows are not places.
            if (!row || row.key.startsWith("\0")) return
            e.preventDefault()
            open(row.key)
          }
        }}
      />
      <div className={ROWS}>
        {rows.map((row, i) => (
          <Fragment key={row.key}>
            {i === actions && (
              <>
                {empty && <p className={`${EMPTY_NOTE} text-muted`}>{t("newSession.folderEmpty")}</p>}
                <div className={RULE} />
              </>
            )}
            <Button
              variant="row"
              ref={i === at ? active : undefined}
              tabIndex={-1}
              title={row.key.startsWith("\0") ? undefined : base + row.key}
              className={rowClass({ cursor: i === at })}
              onMouseMove={() => setCursor(i)}
              // A click walks into a folder; "Use" picks where you are.
              onClick={() => open(row.key)}
            >
              <span className={CHECK} />
              <span className={NAME}>{row.text}</span>
              {row.dim && <span className={`${DIM} text-muted`}>{row.dim}</span>}
            </Button>
          </Fragment>
        ))}
      </div>
      <p className={`${HINT} text-subtle touch:hidden`}>{t("newSession.folderHint")}</p>
    </div>
  )
}
