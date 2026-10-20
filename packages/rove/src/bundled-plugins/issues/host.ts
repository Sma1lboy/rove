/**
 * This plugin's only line to Rove: the page host, bound by the factory before
 * any page renders. Runtime imports from the host's source are banned here
 * (`test/architecture/bundled-plugins.test.ts`); types are free.
 */

import type { PageHost } from "../../tui-react/pages/host-api"

let bound: PageHost | undefined

export function bindHost(host: PageHost): void {
  bound = host
}

export function host(): PageHost {
  if (!bound) throw new Error("issues: the page host is not bound yet")
  return bound
}

/** A host function resolved at call time, so a module can name it before the factory runs. */
export function hostFn<F extends (...args: never[]) => unknown>(pick: (h: PageHost) => F): F {
  return ((...args: Parameters<F>) => pick(host())(...args)) as F
}
