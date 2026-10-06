/** Public entry: the WeChat chat channel module Rove's channel registry loads. */

import type { ChatChannelModule } from "@sma1lboy/rove/src/channels/chat-channel.ts"
import { createWeixinChannel } from "./channel.ts"
import { runWeixinCli } from "./cli.ts"

const weixin: ChatChannelModule = {
  id: "weixin",
  createChannel: createWeixinChannel,
  runCli: runWeixinCli,
}

export default weixin
