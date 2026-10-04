import * as productEnv from "@sma1lboy/rove-daemon/compat-env"

export const ROVE_CONFIG_DIR_BASENAME = productEnv.ROVE_CONFIG_DIR_BASENAME
export const ROVE_PRODUCT_NAME = productEnv.ROVE_PRODUCT_NAME
export const ROVE_STATE_DIR_BASENAME = productEnv.ROVE_STATE_DIR_BASENAME
export type ProductCliName = typeof ROVE_PRODUCT_NAME
