// X (twitter-text v3) weighted length: URLs count 23, code points in the
// Latin/punctuation ranges count 1, everything else (CJK, emoji) counts 2.
// ponytail: only http(s):// and www. URLs are detected; X also linkifies bare
// domains with a known TLD (rove.dev). Add a TLD list if that ever matters.
const URL_RE = /\b(?:https?:\/\/|www\.)\S+/gi
const LIGHT: [number, number][] = [
  [0, 4351],
  [8192, 8205],
  [8208, 8223],
  [8242, 8247],
]
export const X_MAX = 280

export function xLength(text: string): number {
  let n = 0
  const rest = text.normalize("NFC").replace(URL_RE, () => ((n += 23), ""))
  for (const { segment } of new Intl.Segmenter().segment(rest)) {
    const c = segment.codePointAt(0) ?? 0
    const light = LIGHT.some(([a, b]) => c >= a && c <= b)
    n += light && !/\p{Extended_Pictographic}/u.test(segment) ? 1 : 2
  }
  return n
}
