/**
 * The `feedback` verb group — GitHub issue filing, the one group that reaches
 * an EXTERNAL service rather than the daemon. One file per `VerbGroup`,
 * mirroring the taxonomy `rove api schema --group feedback` prints — though it
 * is each spec's own `group` field, not this file, that decides where a verb
 * lists. Specs spread back into the {@link VERBS} table, so schema/help/validation
 * see one canonical list.
 */

import { DEFAULT_FEEDBACK_KIND, FEEDBACK_KINDS } from "../../lib/feedback.ts"
import { feedback } from "./handlers-fanout.ts"
import type { VerbSpec } from "./types.ts"

export const FEEDBACK_VERBS: readonly VerbSpec[] = [
  {
    name: "feedback",
    group: "feedback",
    summary:
      "File a GitHub issue on the Rove repo through `gh`, with an environment block appended. Returns { filed, url, number? }; when `gh` is missing or signed out, `filed` is false and `url` is a prefilled new-issue link to open.",
    flags: [
      { name: "title", type: "string", required: true, placeholder: "T", description: "Issue title." },
      { name: "body", type: "string", required: true, placeholder: "TEXT", description: "Issue body." },
      {
        name: "kind",
        type: "string",
        default: DEFAULT_FEEDBACK_KIND,
        placeholder: FEEDBACK_KINDS.join("|"),
        description: "bug (label bug), idea (enhancement) or question.",
      },
    ],
    offline: true,
    handler: feedback,
  },
]
