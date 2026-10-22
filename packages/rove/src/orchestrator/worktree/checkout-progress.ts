/**
 * Git's checkout meter (`Updating files:  45% (123/456)`), which `worktree
 * add` writes to stderr even into a pipe, read as whole percents. Matches the
 * `N% (a/b)` tail, not the label, because the label is translated.
 */

const METER_RE = /(\d{1,3})% \(\d+\/\d+\)/g

/**
 * A stderr chunk handler that calls `onPercent` once per new percent, in
 * order. Chunks may split a meter frame; the unterminated tail waits for the
 * next chunk.
 */
export function checkoutProgressReader(onPercent: (percent: number) => void): (chunk: string) => void {
  let tail = ""
  let last = -1
  return (chunk) => {
    const text = tail + chunk
    const end = Math.max(text.lastIndexOf("\r"), text.lastIndexOf("\n"))
    if (end < 0) {
      tail = text
      return
    }
    tail = text.slice(end + 1)
    let percent = -1
    for (const match of text.slice(0, end).matchAll(METER_RE)) percent = Number(match[1])
    if (percent < 0 || percent > 100 || percent === last) return
    last = percent
    onPercent(percent)
  }
}
