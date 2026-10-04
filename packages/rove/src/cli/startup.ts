import { migrateRoveClientStateLayout } from "../state/layout-migration.ts"
import { migrateRenamedStateKeys } from "../state/state-key-migration.ts"

export function prepareCliStateLayout(env: NodeJS.ProcessEnv = process.env): void {
  const result = migrateRoveClientStateLayout(env)
  for (const warning of result.warnings) console.error(`[rove] state migration will retry: ${warning}`)
  migrateRenamedStateKeys()
}
