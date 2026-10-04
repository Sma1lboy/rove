#!/usr/bin/env bun

import { prepareCliStateLayout } from "./startup.ts"

prepareCliStateLayout()
await import("./index.ts")
