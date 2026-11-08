/**
 * Learning from the user's fixes. The phone bar keeps the draft as dictation left it and where the takes
 * sit in it; once the message is sent, `voice.learn` diffs that against what went out, and each fix to a
 * term inside a take (Jithub → GitHub) is rewritten in the next takes. The sidecar's `learn.py` decides
 * what counts; the page only says what it kept and offers to undo it.
 */

import type { BridgeClient } from "../bridge.ts"
import { t } from "../i18n/index.ts"
import { toast } from "../ui.ts"

/** The draft right after the last take landed, and every take's [start, end) in it. */
export interface Heard {
  readonly base: string
  readonly spans: readonly (readonly [number, number])[]
}

/** One fix the store kept, opaque here except for what the toast shows; `voice.unlearn` takes it back. */
interface Learned {
  readonly term: string
  readonly spoken: string
}

/**
 * Where the takes are once another lands at [at, end) of `before`. Takes back to back keep their places
 * (shifted past the new one); a draft typed into since the last take starts the record over, since the old
 * spans no longer point at what was heard.
 */
export function afterTake(
  heard: Heard | null,
  before: string,
  next: string,
  at: number,
  end: number,
  take: readonly [number, number],
): Heard {
  const shift = next.length - before.length
  const kept =
    heard?.base === before
      ? heard.spans
          .filter(([s, e]) => e <= at || s >= end)
          .map(([s, e]): readonly [number, number] => (s >= end ? [s + shift, e + shift] : [s, e]))
      : []
  return { base: next, spans: [...kept, take] }
}

/** After a send: what the takes taught, said in a toast that can take it back. Silent when nothing was learned. */
export async function learnFromSend(client: BridgeClient, heard: Heard, sent: string): Promise<void> {
  if (sent === heard.base) return
  let learned: readonly Learned[]
  try {
    const reply = await client.request<{ learned?: Learned[] }>("voice.learn", {
      base: heard.base,
      spans: heard.spans,
      sent,
    })
    learned = reply.learned ?? []
  } catch {
    // Best effort: an older bridge or a sidecar that is down only means this fix is not remembered.
    return
  }
  if (learned.length === 0) return
  const pairs = learned.map((l) => t("voice.learnedPair", { spoken: l.spoken, term: l.term })).join(", ")
  toast(t("voice.learned", { pairs }), "info", {
    label: t("voice.undo"),
    run: () =>
      void client.request("voice.unlearn", { learned }).then(
        () => toast(t("voice.unlearned")),
        () => toast(t("voice.unlearnFailed"), "error"),
      ),
  })
}
