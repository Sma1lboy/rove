/**
 * "Report a problem": a Scratch conversation on the default engine, seeded to interview the user and file a Rove issue.
 * With what the user already wrote, the agent starts from that and asks only what it leaves out.
 */

import { askAgent } from "./ask-agent.ts"
import { t } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"

export function reportProblem(model: AppModel, given?: { text: string; kind: string }): Promise<void> {
  const prompt = t("settings.feedback.reportPrompt")
  return askAgent(model, given ? `${prompt}\n\n${t("settings.feedback.reportGiven", given)}` : prompt)
}
