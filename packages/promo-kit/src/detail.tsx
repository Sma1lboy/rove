import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { Activity, SendStatus, Versions } from "./history.tsx"
import {
  type Action,
  type Event,
  type Item,
  MOBILE,
  type Version,
  actionBtn,
  copy,
  fmtDur,
  fmtSize,
  linkBtn,
  logEvent,
  postJson,
  primaryBtn,
  toast,
  videoWarnings,
  vurl,
} from "./lib.ts"
import { X_MAX, xLength } from "./xcount.ts"

type History = { versions: Version[]; events: Event[] }

export function Detail({ item, me, onChange }: { item: Item; me: string; onChange: () => void }) {
  const [history, setHistory] = useState<History>({ versions: [{ posts: item.posts, by: "" }], events: [] })
  const [posts, setPosts] = useState(item.posts)
  const [viewing, setViewing] = useState(-1)
  const [saving, setSaving] = useState(false)
  const [dims, setDims] = useState<{ w: number; h: number }>()
  const warns = videoWarnings(item.video, dims)
  const versions = history.versions
  const current = versions[versions.length - 1].posts
  const dirty = JSON.stringify(posts) !== JSON.stringify(current)
  const shown = viewing < 0 ? versions.length - 1 : viewing

  const loadHistory = useCallback(
    () =>
      fetch(`/api/items/${item.id}/history`)
        .then((r) => (r.ok ? r.json() : null))
        .then((h: History | null) => h && setHistory(h)),
    [item.id],
  )
  useEffect(() => {
    document.title = `${item.title} · Rove 宣发包`
    loadHistory()
  }, [item.title, loadHistory])

  const act = (action: Action, post = 0) => {
    logEvent(item.id, action, post).then(() => {
      loadHistory()
      if (action === "send") onChange()
    })
  }
  const pick = (i: number) => {
    setPosts(versions[i].posts)
    setViewing(i)
  }
  const save = async () => {
    setSaving(true)
    const r = await postJson(`/api/items/${item.id}/versions`, { posts: posts.map((p) => p.trim()) })
    setSaving(false)
    if (!r.ok) return toast(`保存失败：${r.status}，改动还在页面上，稍后再试`, 6000)
    const { versions } = await r.json()
    setHistory((h) => ({ ...h, versions }))
    setPosts(versions[versions.length - 1].posts)
    setViewing(-1)
    toast(`已保存为 v${versions.length}`)
    onChange()
  }

  return (
    <>
      <h1 className="text-display font-semibold">{item.title}</h1>
      <p className="mt-1 mb-2 font-mono text-meta text-subtle">
        {[fmtDur(item.video.duration), fmtSize(item.video.size)].filter(Boolean).join(" · ")}
      </p>
      <SendStatus sends={item.sends} me={me} />

      <div className="mt-5 grid gap-6 xl:grid-cols-2 xl:items-start">
        <section>
          <video
            className="block max-h-[60vh] w-full rounded-md bg-inset"
            src={vurl(item.video.key)}
            poster={item.cover && vurl(item.cover)}
            controls
            playsInline
            preload="metadata"
            onLoadedMetadata={(e) => setDims({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight })}
          />
          {warns.length > 0 && (
            <ul className="mt-3 rounded-sm border border-line px-3 py-2 text-meta text-warning">
              <li className="text-muted">X 可能不收这个视频：</li>
              {warns.map((w) => (
                <li key={w}>! {w}</li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-md border border-line bg-surface">
          <ol>
            {posts.map((p, i) => (
              <Post
                // biome-ignore lint/suspicious/noArrayIndexKey: posts never reorder
                key={i}
                index={i}
                total={posts.length}
                text={p}
                duration={i === 0 ? item.video.duration : undefined}
                onCopy={() => act("copy", i)}
                onChange={(v) => setPosts((ps) => ps.map((x, j) => (j === i ? v : x)))}
              />
            ))}
          </ol>
          {dirty && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line px-4 py-3 text-meta">
              <span className="min-w-0 flex-1 text-muted">
                {viewing >= 0 && viewing < versions.length - 1 ? `正在看 v${viewing + 1}` : "有未保存的修改"}
              </span>
              <button type="button" className={actionBtn} disabled={saving} onClick={save}>
                保存为 v{versions.length + 1}
              </button>
              <button type="button" className={linkBtn} onClick={() => pick(versions.length - 1)}>
                放弃
              </button>
            </div>
          )}
          <SendBar item={item} text={posts[0].trim()} thread={posts.length > 1} onAction={act} />
        </section>
      </div>

      <div className="mt-8 grid gap-6 border-t border-line pt-5 sm:grid-cols-2">
        <Versions versions={versions} viewing={shown} me={me} onPick={pick} />
        <Activity events={history.events} me={me} />
      </div>
    </>
  )
}

function Post(props: {
  index: number
  total: number
  text: string
  duration?: number
  onCopy: () => void
  onChange: (v: string) => void
}) {
  const { index, total, text } = props
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const a = ref.current
    if (!a) return
    a.style.height = "auto"
    a.style.height = `${a.scrollHeight}px`
  }, [text])
  const n = xLength(text.trim())
  const thread = total > 1

  const onCopy = async () => {
    if (!(await copy(text.trim()))) return toast("复制失败，长按文字手动复制")
    props.onCopy()
    toast(index === 0 ? "已复制" : `第 ${index + 1} 条已复制，回复到上一条下面`)
  }

  return (
    <li className="flex gap-3 px-4">
      {thread && (
        <div className="flex w-6 flex-none flex-col items-center">
          <span className={`h-4 w-px ${index > 0 ? "bg-line" : ""}`} />
          <span className="grid size-6 place-items-center rounded-full border border-line font-mono text-meta text-muted">
            {index + 1}
          </span>
          {index < total - 1 && <span className="w-px flex-1 bg-line" />}
        </div>
      )}
      <div className="min-w-0 flex-1 pt-4 pb-3">
        <textarea
          ref={ref}
          rows={1}
          value={text}
          onChange={(e) => props.onChange(e.target.value)}
          aria-label={`第 ${index + 1} 条文案`}
          className="-mx-2 block w-[calc(100%+16px)] resize-none rounded-sm bg-transparent px-2 py-1 text-title leading-relaxed text-ink outline-none hover:bg-hover focus:bg-hover touch:text-display"
        />
        {props.duration !== undefined && (
          <div className="mt-2 inline-flex items-center gap-1.5 rounded-sm border border-line px-2 py-1 font-mono text-meta text-muted">
            ▶ 视频 {fmtDur(props.duration)}
          </div>
        )}
        <div className="mt-2 flex items-center justify-end gap-4">
          <span className={`font-mono text-meta ${n > X_MAX ? "text-error" : "text-subtle"}`} title="按 X 规则：中文 2，链接 23">
            {n}/{X_MAX}
          </span>
          <button type="button" className={linkBtn} onClick={onCopy}>
            复制
          </button>
        </div>
      </div>
    </li>
  )
}

// navigator.share must run inside the tap, so on phones the video is fetched ahead of time.
function useVideoFile(item: Item, enabled: boolean) {
  const [state, setState] = useState<{ file?: File; pct: number; failed?: boolean }>({ pct: 0 })
  useEffect(() => {
    if (!enabled) return
    const ac = new AbortController()
    ;(async () => {
      const r = await fetch(vurl(item.video.key), { signal: ac.signal })
      if (!r.ok || !r.body) throw new Error(String(r.status))
      const reader = r.body.getReader()
      const chunks: BlobPart[] = []
      let got = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value as BlobPart)
        got += value.length
        const pct = Math.round((got / item.video.size) * 100)
        setState((s) => (s.pct === pct ? s : { pct }))
      }
      setState({ file: new File(chunks, `${item.id}.mp4`, { type: "video/mp4" }), pct: 100 })
    })().catch(() => {
      if (!ac.signal.aborted) setState({ pct: 0, failed: true })
    })
    return () => ac.abort()
  }, [item, enabled])
  return state
}

function SendBar(props: { item: Item; text: string; thread: boolean; onAction: (a: Action) => void }) {
  const { item, text, thread } = props
  const media = useVideoFile(item, MOBILE)
  const file = `${item.id}.mp4`
  const dl = `${vurl(item.video.key)}?dl=${encodeURIComponent(file)}`

  const send = async () => {
    if (MOBILE && media.file) {
      const copied = copy(text) // same tap as share; not awaited so share keeps the gesture
      try {
        await navigator.share({ files: [media.file], text })
        props.onAction("send") // only once the share sheet handed it off, not on cancel
        toast((await copied) ? "文案已复制，X 里没带上文字就粘贴" : "X 里没带上文字的话，回来点「复制」", 6000)
      } catch (e) {
        if ((e as Error).name !== "AbortError") toast(`分享失败：${(e as Error).message}。先下载视频再手动发`, 6000)
      }
      return
    }
    props.onAction("send")
    const a = document.createElement("a")
    a.href = dl
    a.download = file
    a.click()
    window.open(`https://x.com/intent/post?text=${encodeURIComponent(text)}`, "_blank", "noopener")
    toast(thread ? "视频在下载。拖进 X 发帖框发出，再在下面逐条回复后几条" : "视频在下载。拖进 X 发帖框，检查后再发", 7000)
  }

  const waiting = MOBILE && !media.file
  const label = !waiting ? "发到 X" : media.failed ? "视频加载失败，先下载" : `准备视频 ${media.pct}%`

  return (
    <div className="sticky bottom-0 flex items-center gap-4 rounded-b-md border-t border-line bg-surface px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))] lg:static lg:pb-3">
      <button type="button" className={`${primaryBtn} touch:flex-1`} disabled={waiting} onClick={send}>
        {label}
      </button>
      <a className={linkBtn} href={dl} download={file} onClick={() => props.onAction("download")}>
        下载视频
      </a>
    </div>
  )
}
