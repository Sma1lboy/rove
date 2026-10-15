/** English is the source of truth; `zh.ts` must carry exactly these keys and `{placeholders}`. */
export const en = {
  rail: {
    tasks: "tasks",
    inbox: "inbox {count}",
    empty: "no tasks yet",
    emptyHint: "start one in the TUI or with `rove api add`",
    tabs: "{count} tabs",
  },
  workspace: {
    pickTask: "pick a task on the left",
    noTabs: "no open sessions in this task",
    tabNotLive: "this tab has no running session",
    restored: "restored session · read-only until the TUI reopens it",
    exited: "session ended · exit {code}",
    attachFailed: "could not open this session: {message}",
  },
  tab: {
    shell: "shell",
    engine: "engine",
  },
  status: {
    connecting: "connecting",
    open: "connected",
    retrying: "reconnecting · attempt {count}",
    retry: "retry now",
    host: "{host} · rove {version}",
  },
  connect: {
    title: "open the link rove printed",
    body: "Run `rove --web` and open the link it prints, or paste it here.",
    placeholder: "http://127.0.0.1:7878/#token=…",
    submit: "connect",
    invalid: "that is not a `rove --web` link",
    failing: "can't reach rove. Is `rove --web` still running? After `--rotate-token`, open the new link.",
    forget: "forget this link",
  },
}
