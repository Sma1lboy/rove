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
}
