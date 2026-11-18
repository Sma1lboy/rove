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

test.each(["en", "zh"] as const)("no two %s i18n files declare the same top-level namespace", (locale) => {
  const owners = Object.entries(parts).flatMap(([file, part]) => Object.keys(part[locale]).map((ns) => [ns, file]))
  expect(owners.filter(([ns]) => owners.filter(([other]) => other === ns).length > 1)).toEqual([])
})
