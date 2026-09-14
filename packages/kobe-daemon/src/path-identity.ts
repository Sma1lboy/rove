import path from "node:path"

/** Select by path syntax, not the host: remote POSIX paths also reach Windows clients. */
export function pathSyntax(value: string): typeof path.posix {
  return /^[a-z]:/i.test(value) || /^[/\\]{2}[^/\\]+[/\\][^/\\]+/.test(value) ? path.win32 : path.posix
}

/** Lexical identity only. Callers that require symlink identity must resolve it first. */
export function pathIdentity(value: string): string {
  if (!value || /^[a-z][a-z\d+.-]+:\/\//i.test(value)) return value
  const syntax = pathSyntax(value)
  const local = syntax === path.win32 ? value.replaceAll("/", "\\") : value
  const unprefixed = local.replace(/^\\\\\?\\UNC\\/i, "\\\\").replace(/^\\\\\?\\(?=[a-z]:\\)/i, "")
  const normalized = syntax.normalize(unprefixed)
  const root = syntax.parse(normalized).root
  const trimmed =
    normalized.length > root.length ? normalized.replace(syntax === path.win32 ? /[/\\]+$/ : /\/+$/, "") : normalized
  if (syntax === path.posix) return trimmed
  // Preserve component case: Windows directories can opt into case sensitivity.
  return trimmed.replaceAll("\\", "/").replace(/^[a-z]:/i, (drive) => drive.toUpperCase())
}

export function samePath(left: string | undefined | null, right: string | undefined | null): boolean {
  return !!left && !!right && pathIdentity(left) === pathIdentity(right)
}

/** Descendant suffix in slash form; null for siblings, other drives, or missing paths. */
export function pathWithin(parent: string, candidate: string): string | null {
  if (!parent || !candidate) return null
  const root = pathIdentity(parent)
  const target = pathIdentity(candidate)
  if (root === target) return ""
  const prefix = root.endsWith("/") ? root : `${root}/`
  return target.startsWith(prefix) ? target.slice(prefix.length) : null
}
