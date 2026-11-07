export const en = {
  voice: {
    say: "Say",
    stop: "Stop {time}",
    release: "Release {time}",
    working: "Hearing…",
    hint: "Dictate: tap to start and stop, or hold to talk and let go",
    tipInsert: "Let go to insert · slide up to send",
    tipSend: "Let go to send",
    hold: "Hold to talk",
    type: "Type instead",
    offline: "Voice is off: run scripts/voice/asr_server.py on this host",
  },
}

export const zh: typeof en = {
  voice: {
    say: "说",
    stop: "停 {time}",
    release: "松手 {time}",
    working: "在听…",
    hint: "口述：点一下开始、再点一下结束，或按住说话、松手结束",
    tipInsert: "松手插入 · 上滑发送",
    tipSend: "松手发送",
    hold: "按住说话",
    type: "打字",
    offline: "语音未启动：在这台机器上运行 scripts/voice/asr_server.py",
  },
}
