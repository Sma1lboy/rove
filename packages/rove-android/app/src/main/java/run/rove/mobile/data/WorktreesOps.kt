package run.rove.mobile.data

import kotlinx.serialization.json.decodeFromJsonElement
import run.rove.mobile.domain.*

// Typed ops for the worktrees page (docs/IOS.md: worktrees.list / worktrees.remove / task.land).

/** Always asks the remotes: the page exists to show what is pushed and merged. */
suspend fun RoveRepository.worktrees(network: Boolean = true): List<WorktreeProject> =
    wireJson.decodeFromJsonElement<WorktreesResult>(bridge.request("worktrees.list", args("network" to network))).projects

/** A dirty worktree is refused with code `DIRTY_WORKTREE` unless `force`. */
suspend fun RoveRepository.removeWorktree(path: String, force: Boolean): WorktreeRemoveResult =
    wireJson.decodeFromJsonElement(bridge.request("worktrees.remove", args("path" to path, "force" to force)))

suspend fun RoveRepository.landWorktree(taskId: String, strategy: String): WorktreeLandResult =
    wireJson.decodeFromJsonElement(bridge.request("task.land", args("taskId" to taskId, "strategy" to strategy)))
