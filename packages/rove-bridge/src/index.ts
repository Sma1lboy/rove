/** Public entry for in-process callers (`rove --web`). Importing this starts nothing. */
export { type RunBridgeOptions, runBridge, saveRelayServer } from "./run.ts"
export { DEFAULT_RELAY_SERVER } from "./cli-args.ts"
export type { WebRoot } from "./web-static.ts"
