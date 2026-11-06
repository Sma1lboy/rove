/** `review` messages: the Issues page's "PRs waiting on me" source. English is the source of truth; `zh: typeof en` keeps the shapes locked together. */
export const en = {
  reviewQueue: {
    sourceIssues: "[ issues ]",
    sourceReviews: "[ PRs waiting on me ]",
    palette: "Review queue",
    title: "PRs waiting on me",
    empty: "No open PR asks for your review in your projects.",
    other: "{count} more in projects Rove doesn't know.",
    draft: "draft",
    fork: "fork",
    checksPassing: "checks passing",
    checksFailing: "checks failing",
    checksPending: "checks running",
    start: "[ review ]",
    preparing: "Fetching #{number}…",
    failed: "Could not start the review of #{number}: {error}",
    gh: {
      missing: "The `gh` CLI is not installed or not on PATH.",
      unauthenticated: "`gh` is not signed in: run `gh auth login` on this Mac.",
      failed: "GitHub could not be read just now. Press r to retry.",
    },
    prompt:
      "Review pull request #{number} in {repo}: {title}\n{url}\n\nThis worktree is at the PR's head ({head}, going into {base}). Read the change against {base} (git diff origin/{base}...HEAD), then tell me what you find: bugs, risks, missing tests, anything unclear. Do not push, comment on or approve the PR; report here.",
  },
}

export const zh: typeof en = {
  reviewQueue: {
    sourceIssues: "[ 议题 ]",
    sourceReviews: "[ 等我评审的 PR ]",
    palette: "评审队列",
    title: "等我评审的 PR",
    empty: "你的项目里没有等你评审的 PR。",
    other: "另有 {count} 个在 Rove 不认识的项目里。",
    draft: "草稿",
    fork: "fork",
    checksPassing: "检查通过",
    checksFailing: "检查未通过",
    checksPending: "检查进行中",
    start: "[ 评审 ]",
    preparing: "正在获取 #{number}…",
    failed: "无法开始评审 #{number}：{error}",
    gh: {
      missing: "没有安装 `gh` 命令行，或不在 PATH 中。",
      unauthenticated: "`gh` 未登录：请在这台 Mac 上运行 `gh auth login`。",
      failed: "暂时读不到 GitHub。按 r 重试。",
    },
    prompt:
      "评审 {repo} 的拉取请求 #{number}：{title}\n{url}\n\n这个 worktree 在该 PR 的头部（{head}，合入 {base}）。对照 {base} 阅读改动（git diff origin/{base}...HEAD），然后告诉我你的发现：bug、风险、缺失的测试、不清楚的地方。不要推送、评论或批准这个 PR；在这里汇报。",
  },
}
