import { type Event, type Version, fmtTime, who } from "./lib.ts"

const ACTION = { send: "点了发到 X", download: "下载了素材", copy: "复制了文案" }

// The first thing on a detail page: has anyone posted this yet, and have you.
export function SendStatus({ sends, me }: { sends: Event[]; me: string }) {
  const mine = sends.filter((e) => e.by === me).at(-1)
  const others = [...new Map(sends.filter((e) => e.by !== me).map((e) => [e.by, e])).values()]
  if (!sends.length) return <p className="text-meta text-subtle">○ 还没人发过</p>
  return (
    <div className="space-y-0.5 text-meta">
      {mine && <p className="text-warning">! 你在 {fmtTime(mine.at)} 发过了，再发就重复了</p>}
      {others.length > 0 && (
        <p className="text-muted">✓ {others.map((e) => `${e.by}（${fmtTime(e.at)}）`).join("、")} 发过</p>
      )}
    </div>
  )
}

export function Versions(props: { versions: Version[]; viewing: number; me: string; onPick: (i: number) => void }) {
  const last = props.versions.length - 1
  return (
    <section>
      <h2 className="px-2 pb-1 font-mono text-meta font-semibold text-subtle">文案版本</h2>
      <ol>
        {props.versions
          .map((v, i) => ({ v, i }))
          .reverse()
          .map(({ v, i }) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => props.onPick(i)}
                aria-current={props.viewing === i ? "true" : undefined}
                className="flex w-full items-baseline gap-2 rounded-sm px-2 py-1 text-left text-meta hover:bg-hover aria-[current=true]:bg-menu touch:py-2.5"
              >
                <span className="w-7 flex-none font-mono text-muted">v{i + 1}</span>
                <span className="min-w-0 flex-1 truncate text-ink">{who(v.by, props.me)}</span>
                <span className="flex-none font-mono text-subtle">{fmtTime(v.at)}</span>
                {i === last && <span className="flex-none text-accent">当前</span>}
              </button>
            </li>
          ))}
      </ol>
    </section>
  )
}

export function Activity({ events, me }: { events: Event[]; me: string }) {
  return (
    <section>
      <h2 className="px-2 pb-1 font-mono text-meta font-semibold text-subtle">记录</h2>
      {events.length === 0 ? (
        <p className="px-2 text-meta text-subtle">还没有人操作过</p>
      ) : (
        <ol>
          {[...events].reverse().map((e, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: append-only log
            <li key={i} className="flex items-baseline gap-2 px-2 py-1 text-meta">
              <span className="min-w-0 flex-1 truncate">
                <span className="text-ink">{who(e.by, me)}</span>{" "}
                <span className={e.action === "send" ? "text-accent" : "text-muted"}>
                  {e.action === "copy" && e.post > 0 ? `复制了第 ${e.post + 1} 条` : ACTION[e.action]}
                </span>
              </span>
              <span className="flex-none font-mono text-subtle">{fmtTime(e.at)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
