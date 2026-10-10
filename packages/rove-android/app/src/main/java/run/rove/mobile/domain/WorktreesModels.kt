package run.rove.mobile.domain

import kotlinx.serialization.Serializable

// Port of iOS Files/FilesModels.swift (worktree part) + WorktreesLogic.swift.

/** `worktrees.list` row: the daemon's audit row plus the bridge's `taskId`/`taskKind` join. */
@Serializable
data class WorktreeRow(
    val path: String,
    val branch: String = "",
    val dirty: Boolean? = null,
    val roveManaged: Boolean? = null,
    val lastActivityMs: Double? = null,
    val createdAtMs: Double? = null,
    val branchOnRemote: Boolean? = null,
    val verdict: String? = null,
    val verdictReason: String? = null,
    val taskId: String? = null,
    val taskKind: String? = null,
) {
    /** Only a tracked task's own branch can land; an untracked or main/dir worktree cannot. */
    val canLand: Boolean get() = taskId != null && (taskKind ?: "task") == "task"
}

@Serializable data class WorktreeProject(val repo: String, val worktrees: List<WorktreeRow> = emptyList())
@Serializable data class WorktreesResult(val projects: List<WorktreeProject> = emptyList())
@Serializable data class WorktreeResidue(val path: String, val reason: String)
@Serializable data class WorktreeRemoveResult(val removed: Boolean, val residue: WorktreeResidue? = null)
@Serializable data class WorktreeLandResult(val landedOn: String, val commit: String)

enum class WorktreeTone { Quiet, Good, Warn }
enum class WorktreeTagKind { Rove, Dirty, DirtyUnknown, OnRemote, NotPushed, RemoteUnknown, PrOpen, PrMerged, InMain, PrClosed, Idle }

/** A badge on a worktree row; the UI maps `kind` to copy. */
data class WorktreeTag(val kind: WorktreeTagKind, val tone: WorktreeTone)

enum class AgeUnit { Minutes, Hours, Days, Months }
data class WorktreeAge(val value: Int, val unit: AgeUnit)

object WorktreesLogic {
    /** Compact age: minutes, hours, days, months; null when the daemon had no timestamp (0 / missing). */
    fun age(ms: Double?, nowMs: Long = System.currentTimeMillis()): WorktreeAge? {
        if (ms == null || ms <= 0) return null
        val s = maxOf(0.0, (nowMs - ms) / 1000)
        return when {
            s < 3600 -> WorktreeAge(maxOf(1, (s / 60).toInt()), AgeUnit.Minutes)
            s < 86_400 -> WorktreeAge((s / 3600).toInt(), AgeUnit.Hours)
            s < 86_400 * 60 -> WorktreeAge((s / 86_400).toInt(), AgeUnit.Days)
            else -> WorktreeAge((s / (86_400 * 30)).toInt(), AgeUnit.Months)
        }
    }

    /** The row's badges: dirty (or a failed probe), remote, and the staleness verdict when it says more. */
    fun tags(row: WorktreeRow): List<WorktreeTag> = buildList {
        if (row.roveManaged == true) add(WorktreeTag(WorktreeTagKind.Rove, WorktreeTone.Quiet))
        when (row.dirty) {
            true -> add(WorktreeTag(WorktreeTagKind.Dirty, WorktreeTone.Warn))
            null -> add(WorktreeTag(WorktreeTagKind.DirtyUnknown, WorktreeTone.Quiet)) // probe failed: not the same as clean
            false -> {}
        }
        when (row.branchOnRemote) {
            true -> add(WorktreeTag(WorktreeTagKind.OnRemote, WorktreeTone.Good))
            false -> add(WorktreeTag(WorktreeTagKind.NotPushed, WorktreeTone.Warn))
            null -> add(WorktreeTag(WorktreeTagKind.RemoteUnknown, WorktreeTone.Quiet))
        }
        verdictTag(row)?.let(::add)
    }

    /** `dirty` and `fresh` already read from other tags; the rest explain why a row looks stale or done. */
    fun verdictTag(row: WorktreeRow): WorktreeTag? = when (row.verdictReason) {
        "prOpen" -> WorktreeTag(WorktreeTagKind.PrOpen, WorktreeTone.Quiet)
        "prMerged" -> WorktreeTag(WorktreeTagKind.PrMerged, WorktreeTone.Good)
        "inMain" -> WorktreeTag(WorktreeTagKind.InMain, WorktreeTone.Good)
        "prClosed" -> WorktreeTag(WorktreeTagKind.PrClosed, WorktreeTone.Warn)
        "idle" -> WorktreeTag(WorktreeTagKind.Idle, WorktreeTone.Warn)
        else -> null
    }

    fun projectName(repo: String): String = repo.trimEnd('/').substringAfterLast('/')
}
