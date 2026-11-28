/**
 * Directory drill-down derivation — memoized
 * split + readdir + filter over a typed path, shared by the existing
 * tab's browse-mode repo picker and the clone tab's parent-dir picker.
 * Pure plumbing from `src/lib/path-helpers.ts`.
 */

import { filterSubdirs, listSubdirs, splitPathForDirSuggest } from "@sma1lboy/rove-core/lib/path-helpers.ts"
import { useMemo } from "react"

export function useDerivedDir(value: string) {
  const split = useMemo(() => splitPathForDirSuggest(value), [value])
  const filtered = useMemo(() => filterSubdirs(listSubdirs(split.base), split.filter), [split])
  return { split, filtered }
}
