/**
 * The mod element-tree contract, re-exported so clients reach it through the
 * daemon package like every other wire type. One source: the SDK's `./contract`.
 */
export {
  MOD_KEY_PATTERN,
  MOD_PANE_ID_PATTERN,
  type ModNode,
  type ModPaneView,
  type ModTone,
  parseModUiPayload,
  validateModTree,
} from "@sma1lboy/rove-plugin-sdk/contract"
