/**
 * `settings.autoRouting.*` — copy for Settings → Auto routing: the table that
 * says which engine, model and reasoning effort each depth runs on, and under
 * it the classifier that chooses a depth for a task.
 *
 * Split out of `./settings.ts`, which owns the rest of the dialog, because
 * this section carries a vocabulary nothing else in that file shares — depths,
 * routing, a third-party classifier, a confidence floor, a stored API key —
 * and because the data-flow sentence in here is a decision record
 * (`docs/design/auto-routing-classifier.md`, hard requirement 4) rather than
 * ordinary copy: it must stay beside the switch it describes.
 *
 * English is the source of truth; `zh: typeof en` mirrors its shape exactly.
 * `./settings.ts` spreads both into its own `en` / `zh`, so the message keys
 * stay `settings.autoRouting.…` — this split is invisible to callers.
 */

export const en = {
  autoRouting: {
    title: "Auto routing",
    hint: "Routing by depth: a task says how deep the work is — swift, standard, deep — and this table says which engine, model and reasoning effort that depth runs on. Pick a depth in the new-task dialog (or `rove api add --tier`) and Rove fills those three fields from the row; you still see them and can change them before the task starts. enter (or click) a row to point it somewhere else, with the same picker a task uses. A row whose target cannot start says why here, not at launch.",
    unconfigured:
      "Auto routing is off: a depth has nowhere to route — its engine is blank. Point it somewhere below, or remove the empty autoRouting.<tier>.engine from state.json.",
    engineDefault: "engine default",
    ready: "● ready",
    unavailable: "! unavailable — {reason}",
    classifierTitle: "Classifier",
    classifierHint:
      "The rows above say what each depth RUNS. This says who CHOOSES one: switch it on and `rove api add --tier auto` reads the task's first message and picks the depth for you. It is off by default, it is never required, and it can never fail a create — no key, no network, a timeout, or an answer it is not confident enough about all leave you on the depth you would have had.",
    classifierDataFlow:
      "! Turning the classifier on sends the task's first message to a third party that is NOT the engine vendor you picked — TypeSafe System One for `jev`, or whatever address you point `custom` at. It reads the text before your engine does. Nothing leaves this machine while it is off.",
    classifierLabel: "Choose with",
    classifierOff: "off",
    classifierCustomLabel: "custom",
    classifierOffHint: "— nothing is sent anywhere",
    classifierJevHint: "— TypeSafe System One, billed to your own key",
    classifierCustomHint: "— your endpoint: POST the text, answer with a depth and a confidence",
    endpointLabel: "Endpoint",
    endpointUnset: "(none — enter one, then set Choose with to custom)",
    endpointTitle: "Custom classifier endpoint",
    endpointField: "URL",
    endpointInvalidTitle: "Not a URL",
    endpointInvalidBody:
      "The endpoint has to start with https://, or http:// for a loopback address (127.0.0.1, localhost, ::1) — over a network, plain http would carry the task's first 1,200 characters in cleartext. Leave it empty to clear it.",
    thresholdLabel: "Confidence floor",
    thresholdHint: "— below this, the depth is left alone",
    thresholdTitle: "Confidence floor",
    thresholdField: "0 to 1",
    thresholdInvalidTitle: "Not a confidence",
    thresholdInvalidBody: "The floor is a number between 0 and 1. 0.5 is the shipped default.",
    keyLabel: "API key",
    keyStored: "stored {hint} — enter to replace, empty to clear",
    keyFromEnv: "from ${env} — the environment wins over a stored key",
    keyNone: "not set — enter to paste one",
    keyTitle: "{env}",
    keyPlaceholder: "paste the key; leave empty to clear the stored one",
    keySaved: "● key stored in ~/.rove/secrets.json (owner-only, never in state.json)",
    keyCustomUnused:
      "● no Authorization header is sent to a custom endpoint — set autoRouting.classifierCustomKeyEnv to the variable holding its key if it needs one",
    keyNoVariableTitle: "No key variable for this endpoint",
    keyNoVariableBody:
      "A custom classifier endpoint is sent no Authorization header until autoRouting.classifierCustomKeyEnv names the variable its key lives in. Set that first — a key stored under a name nothing reads is a key at rest for no purpose.",
    keyWriteFailedTitle: "Key not saved",
    keyWriteFailedBody: "~/.rove/secrets.json could not be written: {reason}",
    keyMissing: "! no key — nothing is chosen and tasks keep their usual depth",
    keyPresentEnv: "● key read from ${env} in this process's environment",
  },
}

export const zh: typeof en = {
  autoRouting: {
    title: "自动路由",
    hint: "按深度路由：任务说明这活有多深——轻快、标准、深入——这张表说明那一档跑在哪个引擎、哪个模型、哪个推理强度上。在新建任务对话框里选一档（或 `rove api add --tier`），Rove 就照那一行填进这三个字段；任务启动前你仍然看得见、改得了。enter（或点击）某一行，用和任务一样的选择器把它指到别处。目标起不来的行会在这里说明原因，而不是等到启动时才炸。",
    unconfigured:
      "自动路由已关闭：有一档无处可去——它的引擎是空的。在下面把它指到某个引擎，或从 state.json 里删掉空的 autoRouting.<tier>.engine。",
    engineDefault: "引擎默认",
    ready: "● 可用",
    unavailable: "! 不可用——{reason}",
    classifierTitle: "分类器",
    classifierHint:
      "上面几行说的是每一档**跑什么**，这里决定**由谁来选**：打开之后，`rove api add --tier auto` 会读任务的第一句话替你选档。默认关着，从来不是必需的，也永远不会让建 task 失败——没 key、断网、超时、或者它自己没把握，都只是让你停在本来就会用的那一档上。",
    classifierDataFlow:
      "! 打开分类器，任务的第一句话会发给一个**不是你选的那个引擎厂商**的第三方——`jev` 是 TypeSafe System One，`custom` 是你自己填的地址。它比你的引擎更早读到这段文字。关着的时候什么都不发。",
    classifierLabel: "选档方式",
    classifierOff: "关",
    classifierCustomLabel: "自定义",
    classifierOffHint: "——不向任何地方发送",
    classifierJevHint: "——TypeSafe System One，走你自己的 key 计费",
    classifierCustomHint: "——你自己的接口：POST 那段文本，返回一个档位加一个置信度",
    endpointLabel: "接口地址",
    endpointUnset: "（未填——先填一个，再把「选档方式」切到自定义）",
    endpointTitle: "自定义分类器接口",
    endpointField: "URL",
    endpointInvalidTitle: "不是一个 URL",
    endpointInvalidBody:
      "接口地址要以 https:// 开头；http:// 只在回环地址（127.0.0.1、localhost、::1）上接受——发到网络上的话，明文 http 会把任务的前 1200 个字符原样带走。留空则清除。",
    thresholdLabel: "置信度下限",
    thresholdHint: "——低于这个值就不动档位",
    thresholdTitle: "置信度下限",
    thresholdField: "0 到 1",
    thresholdInvalidTitle: "不是一个置信度",
    thresholdInvalidBody: "下限是 0 到 1 之间的数。出厂默认 0.5。",
    keyLabel: "API key",
    keyStored: "已存 {hint}——enter 可替换，留空清除",
    keyFromEnv: "来自环境变量 ${env}——环境变量优先于存起来的那个",
    keyNone: "未设置——enter 粘贴一个",
    keyTitle: "{env}",
    keyPlaceholder: "粘贴 key；留空则清除已存的那个",
    keySaved: "● key 存在 ~/.rove/secrets.json（仅本人可读，不会进 state.json）",
    keyCustomUnused:
      "● 自定义接口不会收到 Authorization 头——它若需要凭据，把 autoRouting.classifierCustomKeyEnv 指向存它的变量",
    keyNoVariableTitle: "这个接口还没有 key 变量",
    keyNoVariableBody:
      "在 autoRouting.classifierCustomKeyEnv 指定存 key 的变量之前，自定义分类器接口不会收到任何 Authorization 头。先设那个——存在一个没人读的名字下面的 key，只是白白落在盘上。",
    keyWriteFailedTitle: "key 没存下",
    keyWriteFailedBody: "写不了 ~/.rove/secrets.json：{reason}",
    keyMissing: "! 没有 key——不会替你选档，任务保持原来的档位",
    keyPresentEnv: "● key 来自本进程环境变量 ${env}",
  },
}
