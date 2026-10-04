#!/usr/bin/env bun

import { markLegacyInvocation, prepareCliEnvironment, prepareCliStateLayout } from "./rename-compat.ts"

markLegacyInvocation()
prepareCliEnvironment()
prepareCliStateLayout()
await import("./index.ts")
