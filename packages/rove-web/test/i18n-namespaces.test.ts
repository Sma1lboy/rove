import { expect, test } from "bun:test"
import * as artifact from "../src/i18n/artifact.ts"
import * as compare from "../src/i18n/compare.ts"
import * as dialogs from "../src/i18n/dialogs.ts"
import * as machines from "../src/i18n/machines.ts"
import * as panel from "../src/i18n/panel.ts"
import * as prompts from "../src/i18n/prompts.ts"
import * as rail from "../src/i18n/rail.ts"
import * as review from "../src/i18n/review.ts"
import * as runLog from "../src/i18n/run-log.ts"
import * as settings from "../src/i18n/settings.ts"
import * as transcript from "../src/i18n/transcript.ts"
import * as usage from "../src/i18n/usage.ts"
import * as workspace from "../src/i18n/workspace.ts"

// The catalogs merge with a shallow Object.assign: a namespace two files both declare is silently replaced by the
// later one, and every key of the earlier one then renders as its raw id (the Diff toolbar once showed `review.scopeMenu`).
test("no two i18n files declare the same top-level namespace", () => {
  const parts = {
    rail,
    workspace,
    dialogs,
    panel,
    settings,
    compare,
    prompts,
    runLog,
    usage,
    transcript,
    machines,
    artifact,
    review,
  }
  for (const locale of ["en", "zh"] as const) {
    const owner = new Map<string, string>()
    for (const [file, part] of Object.entries(parts)) {
      for (const ns of Object.keys(part[locale])) {
        expect(owner.get(ns), `${locale}: "${ns}" is declared in ${owner.get(ns)} and ${file}`).toBeUndefined()
        owner.set(ns, file)
      }
    }
  }
})
