/** A pasted `rove --web` link or bare token → the token; null when it is neither. */
export function tokenFromInput(input: string): string | null {
  const text = input.trim()
  const hash = text.indexOf("#")
  const candidate = hash >= 0 ? new URLSearchParams(text.slice(hash + 1)).get("token") : text
  return candidate && /^[A-Za-z0-9_-]{43}$/.test(candidate) ? candidate : null
}
