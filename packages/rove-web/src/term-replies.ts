/**
 * What xterm.js types back at the app. Its parser answers every terminal query
 * it reads, and the page feeds it two kinds of bytes it must not answer:
 * history (the host ring replayed on attach, whose queries were answered when
 * they were live) and queries the PTY host already answers for a client that
 * does not claim to (the bridge opens sessions without `answersQueries`). Either
 * reply lands in the app's stdin as stray input, a shell prompt full of `1;2c`.
 */

// The replies the host sends for the same queries: DA1, DECRQM, OSC 10/11.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching raw terminal replies is the point
const HOST_ANSWERED = /\x1b\[\?[0-9;]*c|\x1b\[\??[0-9;]*\$y|\x1b\](?:10|11);[^\x07\x1b]*(?:\x07|\x1b\\)/g

export interface ReplyGate {
  /** xterm's `onData`: keys and live replies go to the app, replies to replayed history do not. */
  readonly forward: (data: string) => void
  /** Hand history to xterm through `write`, which must pass its parsed-callback to `term.write`. */
  readonly replay: (write: (parsed: () => void) => void) => void
}

export function createReplyGate(send: (data: string) => void): ReplyGate {
  let replaying = 0
  return {
    forward(data) {
      if (replaying > 0) return
      const live = data.replace(HOST_ANSWERED, "")
      if (live) send(live)
    },
    replay(write) {
      replaying++
      // xterm fires this after parsing the chunk and before any later chunk's parse.
      write(() => {
        replaying--
      })
    },
  }
}
