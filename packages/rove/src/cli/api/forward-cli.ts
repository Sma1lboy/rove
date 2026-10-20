/**
 * `rove api … --machine <alias>`: the CLI half of running a verb on another
 * machine. `--machine` is a transport flag like `--envelope`, read and removed
 * before the verb's own flags are parsed.
 */

import type { ApiParams } from "@sma1lboy/rove-daemon/daemon/protocol"
import { VerbArgs } from "./flags.ts"
import type { Flags, VerbSpec } from "./types.ts"

/** `--machine X` / `--machine=X` lifted out of `argv`; the rest is the verb's own. */
export function takeMachineFlag(argv: readonly string[]): { machine?: string; rest: string[] } {
  const rest: string[] = []
  let machine: string | undefined
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--machine") {
      machine = argv[i + 1]
      i += 1
    } else if (arg.startsWith("--machine=")) {
      machine = arg.slice("--machine=".length)
    } else {
      rest.push(arg)
    }
  }
  return { machine: machine || undefined, rest }
}

/**
 * The verb's flags as `api.invoke` params. A prompt file is read HERE: the
 * file, or stdin, belongs to this process, not to the machine running the verb.
 */
export function forwardParams(verb: VerbSpec, flags: Flags): ApiParams {
  if (!flags.has("prompt-file") || !verb.flags.some((f) => f.name === "prompt")) return Object.fromEntries(flags)
  const text = new VerbArgs(verb, flags).promptText()
  const params = Object.fromEntries([...flags].filter(([name]) => name !== "prompt-file"))
  return text === undefined ? params : { ...params, prompt: text }
}
