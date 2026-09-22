/**
 * Tiny zero-dependency path glob matcher.
 *
 * Filters discovered worktree paths (`kobe adopt --glob`, the Adopt tab). Not
 * `Bun.Glob`: `import "bun"` doesn't resolve under Vitest.
 *
 * Supported syntax (POSIX-ish, path-segment aware):
 *   - `*`  — any run of chars except `/`
 *   - `**` — any run of chars including `/`
 *   - `?`  — a single char except `/`
 * Everything else is matched literally (regex metachars are escaped).
 *
 * A `**` on its own segment followed by `/` matches ZERO or more directories
 * (the separator is folded in), so `a/**` + `/b` matches `a/b` too.
 */

import { basename } from "node:path"

/** Translate a glob into an anchored RegExp. */
export function globToRegExp(glob: string): RegExp {
  let re = ""
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === "*") {
      if (glob[i + 1] === "*") {
        // Segment globstar folds its trailing `/` so `a/**/b` matches `a/b`;
        // elsewhere `**` is "any run including `/`".
        const segmentStart = i === 0 || glob[i - 1] === "/"
        if (segmentStart && glob[i + 2] === "/") {
          re += "(?:.*/)?"
          i += 2 // consume the second `*` and the trailing `/`
        } else {
          re += ".*"
          i++
        }
      } else {
        re += "[^/]*"
      }
    } else if (c === "?") {
      re += "[^/]"
    } else if (c && "\\^$.|+()[]{}".includes(c)) {
      re += `\\${c}`
    } else {
      re += c
    }
  }
  return new RegExp(`^${re}$`)
}

/**
 * Match a path against a glob, trying both the full path and its
 * basename — so a bare `feature-*` matches `/work/feature-login` without
 * the caller typing the directory. Returns false (never throws) on an
 * unparseable pattern.
 */
export function matchPathGlob(glob: string, p: string): boolean {
  let re: RegExp
  try {
    re = globToRegExp(glob)
  } catch {
    return false
  }
  return re.test(p) || re.test(basename(p))
}
