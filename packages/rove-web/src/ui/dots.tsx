/** Three dots taking turns: a short wait (a take turned into text, a pairing code being made). */
export function Dots() {
  return (
    <span className="inline-flex items-center gap-[3px] align-middle" aria-hidden="true">
      {[0, 160, 320].map((delay) => (
        <i
          key={delay}
          className="block size-1 rounded-full bg-current motion-safe:animate-dot"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  )
}
