/**
 * The `feedback` verb group — GitHub Discussions integration, the one group
 * that reaches an EXTERNAL service rather than the daemon. One file per
 * `VerbGroup`, mirroring the taxonomy `rove api schema --group feedback`
 * prints — though it is each spec's own `group` field, not this file, that
 * decides where a verb lists. Specs spread back into the {@link VERBS} table, so
 * schema/help/validation see one canonical list.
 */

import { DEFAULT_FEEDBACK_CATEGORY_SLUG } from "../../lib/feedback.ts"
import { F } from "./flags.ts"
import { feedback } from "./handlers-fanout.ts"
import type { VerbSpec } from "./types.ts"

export const FEEDBACK_VERBS: readonly VerbSpec[] = [
  {
    name: "feedback",
    group: "feedback",
    summary: "Create a GitHub Discussion in the Rove repo's Feedback category through `gh`.",
    flags: [
      { name: "title", type: "string", required: true, placeholder: "T", description: "Discussion title." },
      { name: "body", type: "string", required: true, placeholder: "TEXT", description: "Discussion body." },
      {
        name: "category",
        type: "string",
        default: DEFAULT_FEEDBACK_CATEGORY_SLUG,
        placeholder: "SLUG",
        description: "Discussion category slug.",
      },
    ],
    offline: true,
    handler: feedback,
  },
]
