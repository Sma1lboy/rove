/**
 * Terminal diagnostics for `rove doctor`. Without the kitty keyboard protocol,
 * ctrl+h / ctrl+j arrive as C0 bytes (0x08 / 0x0a) and the split chords
 * (`ctrl+\`, `ctrl+=`) can't be encoded, so keyboard triage needs the protocol
 * answer first. Doctor has no opentui renderer, so it queries the terminal
 * with the same escape opentui would.
 */

/** Multiplexer nesting from env: one rewrites keys on the way in, a keyboard-report confound. */
export function multiplexerLabel(env: Record<string, string | undefined>): string {
  if (env.TMUX) return "tmux"
  if (env.ZELLIJ) return "zellij"
  if (env.STY) return "screen"
  return "no"
}

/** `TERM=… TERM_PROGRAM=… COLORTERM=…` plus multiplexer nesting, from an injected env. */
export function terminalEnvLines(env: Record<string, string | undefined>): string[] {
  const show = (v: string | undefined): string => (v && v.length > 0 ? v : "(unset)")
  const program = env.TERM_PROGRAM
    ? `${env.TERM_PROGRAM}${env.TERM_PROGRAM_VERSION ? ` v${env.TERM_PROGRAM_VERSION}` : ""}`
    : "(unset)"
  const lines = [
    `terminal: TERM=${show(env.TERM)}  TERM_PROGRAM=${program}  COLORTERM=${show(env.COLORTERM)}`,
    `          running inside a multiplexer: ${multiplexerLabel(env)}`,
  ]
  return lines
}

export type KittyProbeResult =
  | { kind: "supported"; flags: number }
  | { kind: "unsupported" }
  | { kind: "no-response" }
  | { kind: "skipped"; reason: string }

/**
 * The probe writes `CSI ? u` then `CSI c` (DA1) as a fence: every terminal
 * answers DA1, so DA1 without a `CSI ? <flags> u` = unsupported. Null while
 * undecided.
 */
export function parseKittyProbeReply(data: string): KittyProbeResult | null {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching a raw ESC-prefixed terminal reply is the whole point
  const kitty = data.match(/\x1b\[\?(\d+)u/)
  if (kitty?.[1] !== undefined) return { kind: "supported", flags: Number.parseInt(kitty[1], 10) }
  // DA1 reply: CSI ? <params> c
  // biome-ignore lint/suspicious/noControlCharactersInRegex: same — raw DA1 escape reply
  if (/\x1b\[\?[\d;]*c/.test(data)) return { kind: "unsupported" }
  return null
}

/** One doctor line per probe outcome, with the triage hint inline. */
export function kittyProbeLine(result: KittyProbeResult): string {
  switch (result.kind) {
    case "supported":
      return `          kitty keyboard protocol: ✓ answered (flags=${result.flags})`
    case "unsupported":
      return [
        "          kitty keyboard protocol: ✗ not supported — legacy key path",
        "          (ctrl+h/ctrl+j arrive as C0 backspace/linefeed bytes; the",
        "          split chords ctrl+\\ and ctrl+= cannot be encoded at all)",
      ].join("\n")
    case "no-response":
      return "          kitty keyboard protocol: ? no reply (terminal ignored both the kitty query and DA1)"
    case "skipped":
      return `          kitty keyboard protocol: skipped (${result.reason})`
  }
}

/**
 * Only when stdin AND stdout are TTYs, so a pipe gets no escape bytes. Raw
 * mode always restored; hard timeout so a mute terminal can't hang doctor.
 */
async function probeKittyKeyboard(timeoutMs = 300): Promise<KittyProbeResult> {
  const stdin = process.stdin
  if (!stdin.isTTY || !process.stdout.isTTY) return { kind: "skipped", reason: "not an interactive terminal" }

  const wasRaw = stdin.isRaw === true
  let buffer = ""
  return await new Promise<KittyProbeResult>((resolve) => {
    let done = false
    const finish = (result: KittyProbeResult): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      stdin.off("data", onData)
      stdin.pause()
      if (!wasRaw) stdin.setRawMode(false)
      resolve(result)
    }
    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString("latin1")
      const decided = parseKittyProbeReply(buffer)
      if (decided) finish(decided)
    }
    const timer = setTimeout(() => finish({ kind: "no-response" }), timeoutMs)
    stdin.setRawMode(true)
    stdin.resume()
    stdin.on("data", onData)
    process.stdout.write("\x1b[?u\x1b[c")
  })
}

/** The whole `terminal:` doctor section (env lines + live kitty probe). */
export async function terminalDoctorLines(): Promise<string[]> {
  return [...terminalEnvLines(process.env), kittyProbeLine(await probeKittyKeyboard())]
}
