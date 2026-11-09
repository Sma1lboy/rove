/** "Report a problem": a Scratch conversation on the default engine, seeded to interview the user and file a Rove issue. */

import { askAgent } from "./ask-agent.ts"
import { t } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"

export function reportProblem(model: AppModel): Promise<void> {
  return askAgent(model, t("settings.feedback.reportPrompt"))
}
