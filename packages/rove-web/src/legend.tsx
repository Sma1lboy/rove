/** A `·`-separated legend (the TUI's catalogue writes its key lines that way) drawn as spaced segments, so the separator never shows. */
export function Legend({ text }: { readonly text: string }) {
  return (
    <span className="legend">
      {text
        .split("·")
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => (
          <span key={part}>{part}</span>
        ))}
    </span>
  )
}
