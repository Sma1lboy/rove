/** Class recipes for the Chat tab (transcript-view.tsx, markdown-view.tsx). */

export const CHAT = "flex min-h-0 min-w-0 flex-1 flex-col font-sans text-body"
/** Find box and Export, above the thread. */
export const CHAT_BAR = "flex flex-none flex-wrap items-center gap-x-3 gap-y-1 px-3 pb-1.5 font-mono text-meta"
export const CHAT_FIND = "min-w-0 flex-1 basis-32 py-1 text-meta"
export const CHAT_COUNT = "whitespace-nowrap text-muted"
export const CHAT_THREAD = "min-h-0 flex-1 overflow-y-auto px-3 pb-3"
export const CHAT_NOTE = "m-0 px-3 py-2 font-mono text-meta text-subtle"
export const CHAT_TAIL = "m-0 whitespace-pre-wrap px-3 pb-3 font-mono text-meta leading-[1.45] text-muted wrap-anywhere"

/** One message. `flash`: the one a palette hit or a find step just scrolled to. */
export const chatEntryClass = (o: { flash: boolean; current: boolean }): string =>
  `group/entry mt-3 rounded-sm border-l-2 py-0.5 pl-2.5 ${o.flash ? "border-accent bg-accent-soft" : o.current ? "border-line-active" : "border-transparent"}`
export const CHAT_HEAD = "mb-0.5 flex items-center gap-2 font-mono text-meta"
export const chatWho = (role: string): string => (role === "user" ? "text-accent" : "text-muted")
export const CHAT_WHEN = "text-subtle"
/** [ copy ]: shown on hover, and always on a touch screen where there is no hover. */
export const CHAT_COPY = "ml-auto opacity-0 group-hover/entry:opacity-100 focus-visible:opacity-100 touch:opacity-100"

/** A tool call: one line, muted, cut at the edge. */
export const CHAT_TOOL = "m-0 mt-0.5 flex min-w-0 items-baseline gap-1.5 font-mono text-meta text-subtle"
export const CHAT_TOOL_NAME = "flex-none text-muted"
export const CHAT_TOOL_TEXT = "min-w-0 flex-1 truncate"
export const CHAT_TOOL_FAILED = "flex-none text-error"

/** Markdown. */
export const MD = "leading-[1.5] wrap-anywhere"
export const MD_P = "m-0 mb-2 whitespace-pre-wrap last:mb-0"
export const MD_H = "m-0 mt-3 mb-1.5 font-semibold first:mt-0"
export const MD_LIST = "m-0 mb-2 flex flex-col gap-0.5 pl-5 last:mb-0"
export const MD_QUOTE = "m-0 mb-2 border-l-2 border-line pl-2.5 whitespace-pre-wrap text-muted last:mb-0"
export const MD_PRE =
  "m-0 mb-2 overflow-x-auto rounded-sm border-hairline border-line bg-inset px-2.5 py-2 font-mono text-meta leading-[1.45] last:mb-0"
export const MD_CODE = "rounded-xs bg-inset px-1 font-mono text-meta"
export const MD_LINK = "text-accent underline"
export const MD_TABLE = "mb-2 block max-w-full overflow-x-auto border-collapse font-mono text-meta last:mb-0"
export const MD_CELL = "border-hairline border-line px-2 py-0.5 text-left align-top"
export const MD_RULE = "my-2 border-0 border-t border-line"
