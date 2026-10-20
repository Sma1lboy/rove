/** @jsxImportSource @opentui/react */
/**
 * Host capabilities a page needs that only the mounted workspace can perform
 * (they reach terminal tabs and the PTY registry). Provided by `host.tsx`.
 */

import { type ReactNode, createContext, useContext } from "react"
import type { IssueChatStart } from "../workspace/use-issue-chat"

export interface PageServices {
  /** Start an engine session on an issue (`use-issue-chat.ts`); errors surface as toasts. */
  readonly startIssueChat: (request: IssueChatStart) => Promise<void>
}

const UNMOUNTED: PageServices = {
  startIssueChat: async () => {
    throw new Error("no workspace is mounted to start a session in")
  },
}

const PageServicesContext = createContext<PageServices>(UNMOUNTED)

export function PageServicesProvider(props: { value: PageServices; children: ReactNode }) {
  return <PageServicesContext.Provider value={props.value}>{props.children}</PageServicesContext.Provider>
}

export function usePageServices(): PageServices {
  return useContext(PageServicesContext)
}
