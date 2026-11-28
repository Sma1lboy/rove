/** Public entry for in-process callers (`rove --web`). Importing this starts nothing. */
export { type RunBridgeOptions, runBridge } from "./run.ts"
export { saveRelayServer } from "./relay.ts"
export { DEFAULT_RELAY_SERVER } from "./cli-args.ts"
export type { WebRoot } from "./web-static.ts"
