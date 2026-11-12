/** The delete / remove confirm dialogs a task row opens. */

export const en = {
  cancel: "cancel",
  /** A project row is a saved repo, not a worktree — `d` un-saves it. */
  forgetProjectTitle: 'Remove project "{title}"?',
  forgetProjectBody:
    "Forgets it from the projects list. The repo, its branches, worktrees, and any tasks under it stay on disk — re-add it with `rove add`.",
  forgetProjectConfirm: "remove",
  deleteTitle: 'Remove session "{title}"?',
  /** A `dir` task is one conversation in a folder the user owns: name it so, not "task". */
  deleteTitleDir: 'Remove session "{title}"?',
  /** A `dir` task pins the user's own directory; deletion never touches it. */
  deleteBodyDir: "Ends this session and closes all its tabs. Nothing on disk changes: the folder and its files stay.",
  /** A project's main checkout has a conversation but is not itself deletable: the project stays listed. */
  deleteBodyMain:
    "Ends this session and closes all its tabs. The project stays in your list and nothing on disk changes: the repo, its branches and worktrees stay.",
  deleteBodyTask: "Ends this session, closes all its tabs and removes its worktree folder. The git branch stays.",
  deleteBodyTaskBranch:
    "Ends this session, closes all its tabs and removes its worktree folder, and its git branch if it is merged. An unmerged branch stays.",
  deleteConfirm: "remove",
  /** The delete dialog when the task has child tasks (it replaces the plain confirm); the default keeps them. */
  childrenTitle: '"{title}" has {count} child tasks',
  childrenBody:
    "Promote moves them up one level and keeps their worktrees and sessions. Remove with children removes them too.",
  childrenPromote: "promote children",
  childrenCascade: "remove with children",
  childrenBodyMain:
    "Ends this session and closes its tabs; nothing on disk changes. Its child tasks keep running unless you delete them too.",
  childrenKeepMain: "remove session",
  childrenCascadeMain: "remove with children",
  forceDeleteTitle: '"{title}" has uncommitted changes',
  forceDeleteConfirm: "force remove",
  /** Rows an older Rove added by itself for worktrees made outside it. */
  legacyAdoptTitle: "Remove {count} sessions Rove added by itself?",
  legacyAdoptBody:
    "An older Rove added a session whenever a worktree was created outside it. It no longer does. These look like leftovers:\n{list}\n\nAn agent can list them, remove the ones you confirm, and take out any old Rove worktree hook still in your settings.",
  legacyAdoptMore: "… and {count} more",
  legacyAdoptClean: "ask an agent",
  legacyAdoptLater: "not now",
  legacyAdoptNever: "don't ask again",
  legacyAdoptSessionTitle: "Remove leftover sessions",
  legacyAdoptPrompt:
    "An older Rove version added sessions to the sidebar by itself whenever a git worktree was created outside Rove. These look like leftovers:\n\n{list}\n\nShow me this list and ask which ones to remove, then wait for my answer. For each one I confirm, first run `git -C <path> status --short`. If it has uncommitted changes, tell me and ask again. Otherwise run `rove api delete --task-id <id> --wait`. Remove nothing I did not confirm, and never pass --force.\n\nThen look for the hook that older version installed. Check my engine settings files, both the global ones and the ones in each repo above (for Claude Code: ~/.claude/settings.json, <repo>/.claude/settings.json and <repo>/.claude/settings.local.json), for any hook whose command runs `rove hook worktree-created`. Show me each entry you find and its file, and remove it only after I confirm. Leave every other hook as it is.",
  legacyAdoptFailed: "Couldn't start the cleanup session: {message}",
}

export const zh: typeof en = {
  cancel: "取消",
  forgetProjectTitle: "从列表中移除项目「{title}」？",
  forgetProjectBody:
    "只是把它从项目列表里忘掉。仓库、分支、worktree 以及它下面的任务都会留在磁盘上——之后可以用 `rove add` 重新加回来。",
  forgetProjectConfirm: "移除",
  deleteTitle: "移除会话「{title}」？",
  deleteTitleDir: "移除会话「{title}」？",
  deleteBodyDir: "结束这个会话，关闭它的所有标签页。磁盘上什么都不动：文件夹和里面的文件都会保留。",
  deleteBodyMain:
    "结束这个会话，关闭它的所有标签页。项目仍留在列表里，磁盘上什么都不动：仓库、分支和 worktree 都会保留。",
  deleteBodyTask: "结束这个会话，关闭它的所有标签页，并删除它的 worktree 文件夹。git 分支会保留。",
  deleteBodyTaskBranch:
    "结束这个会话，关闭它的所有标签页，删除它的 worktree 文件夹，以及已合并的 git 分支。未合并的分支会保留。",
  deleteConfirm: "移除",
  childrenTitle: "「{title}」有 {count} 个子任务",
  childrenBody: "提升会把它们上移一级，并保留它们的 worktree 和会话。连同子任务移除会把它们一并移除。",
  childrenPromote: "提升子任务",
  childrenCascade: "连同子任务移除",
  childrenBodyMain:
    "结束这个会话并关闭它的标签页，磁盘上什么都不动。它的子任务会继续运行，除非你也选择把它们一并删除。",
  childrenKeepMain: "移除会话",
  childrenCascadeMain: "连同子任务移除",
  forceDeleteTitle: "「{title}」有未提交的改动",
  forceDeleteConfirm: "强制移除",
  legacyAdoptTitle: "移除 {count} 个 Rove 自己加进来的会话？",
  legacyAdoptBody:
    "旧版 Rove 会在别处创建 worktree 时自动加一个会话，现在已经不会了。下面这些看起来是当时留下的：\n{list}\n\n可以交给 agent：它先列出来，你确认哪些就删哪些，并把设置里还留着的旧版 Rove worktree hook 一起清掉。",
  legacyAdoptMore: "……还有 {count} 个",
  legacyAdoptClean: "交给 agent",
  legacyAdoptLater: "以后再说",
  legacyAdoptNever: "不再提示",
  legacyAdoptSessionTitle: "移除残留会话",
  legacyAdoptPrompt:
    "旧版 Rove 会在 Rove 之外创建 git worktree 时自动往侧栏加会话。下面这些看起来是当时留下的：\n\n{list}\n\n先把这份清单给我看，问我要删哪些，然后等我回答。对我确认的每一个，先运行 `git -C <path> status --short`；有未提交的改动就告诉我并再问一次，没有就运行 `rove api delete --task-id <id> --wait`。我没确认的一个都不要删，也不要加 --force。\n\n然后找一下那个旧版本装的 hook。检查我的引擎设置文件，包括全局的和上面每个仓库里的（Claude Code 是 ~/.claude/settings.json、<repo>/.claude/settings.json 和 <repo>/.claude/settings.local.json），找命令里运行 `rove hook worktree-created` 的 hook。把找到的每一条连同所在文件给我看，我确认后再删。其他 hook 一律不动。",
  legacyAdoptFailed: "清理会话没能启动：{message}",
}
