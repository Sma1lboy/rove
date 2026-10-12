package run.rove.mobile.domain

import kotlinx.serialization.Serializable

@Serializable
data class TaskRow(
    val id: String,
    val title: String = "",
    val branch: String = "",
    val repo: String = "",
    val kind: String = "task",
    val group: String = "unknown",
    val rank: Double = 0.0,
    val pinned: Boolean = false,
    val deleting: Boolean = false,
    val engine: EngineLabel? = null,
    val status: String = "",
    val activity: TaskActivity? = null,
    val pr: TaskPR? = null,
    val order: Int? = null,
    val createdAt: String? = null,
    val updatedAt: String? = null,
    val changes: TaskChanges? = null,
    val prChip: String? = null,
    val prChipStale: Boolean = false,
) {
    val displayTitle get() = title.ifEmpty { branch.ifEmpty { id } }
    val repoName get() = repo.trimEnd('/').substringAfterLast('/')
}
@Serializable data class EngineLabel(val id: String? = null, val name: String)
@Serializable data class TaskActivity(val state: String, val forMs: Double = 0.0)
@Serializable data class TaskPR(val number: Int? = null, val url: String? = null, val lifecycle: String = "",
                                val checkState: String = "", val reviewDecision: String? = null, val mergeable: String? = null)
/** `unreadable` = tracked, but git failed on the Mac. */
@Serializable data class TaskChanges(val added: Int? = null, val deleted: Int? = null, val ahead: Int? = null,
                                     val behind: Int? = null, val unreadable: Boolean? = null)
@Serializable data class Engine(val id: String, val name: String)
/** One attention-inbox item (iOS `AttentionItem`); `at` is ms since epoch. */
@Serializable data class Attention(val taskId: String? = null, val tabId: String? = null, val state: String = "",
                                   val unread: Boolean = false, val at: Double = 0.0, val resumeAt: String? = null,
                                   val label: String? = null)
@Serializable data class Tasks(val tasks: List<TaskRow> = emptyList(), val attention: List<Attention> = emptyList())
@Serializable data class Engines(val engines: List<Engine>)
@Serializable data class Repos(val repos: List<String>)
@Serializable data class TabRow(
    val id: String, val kind: String, val title: String? = null,
    val engineName: String? = null, val alive: Boolean? = null,
) { val displayTitle get() = title ?: engineName ?: kind }
@Serializable data class Tabs(val tabs: List<TabRow>)
@Serializable data class Attachment(val stream: String, val alive: Boolean, val replay: String)
@Serializable data class TermData(val stream: String, val data: String)
@Serializable data class TermExit(val stream: String, val code: Int? = null)
@Serializable data class DiffFile(
    val path: String, val status: String, val scope: String,
    val added: Int? = null, val deleted: Int? = null,
)
@Serializable data class DiffFiles(val base: String? = null, val files: List<DiffFile>)
@Serializable data class DiffContent(val kind: String, val text: String? = null, val message: String? = null,
                                     val origPath: String? = null, val image: Boolean? = null, val sizeBytes: Long? = null,
                                     val note: PatchNote? = null)
@Serializable data class PatchNote(val kind: String, val from: String? = null, val to: String? = null, val change: String? = null)

data class TaskNotice(val taskId: String, val title: String, val body: String)

object TaskOrdering {
    val groups = listOf("waiting-on-you", "landing", "ready-for-review", "working", "idle", "unknown")
    fun group(value: String) = value.takeIf { it in groups } ?: "unknown"
    fun sorted(rows: List<TaskRow>): List<TaskRow> = rows.sortedWith(
        compareBy<TaskRow> { if (it.kind == "main") 0 else if (it.pinned) 1 else 2 }
            .thenBy { groups.indexOf(group(it.group)) }.thenBy { it.rank }
    )

    /** iOS `TaskListLogic.projects`, attention mode: rows in `sorted` order per repo; repos by their most urgent task (main/pinned do not lift a repo). */
    fun sections(rows: List<TaskRow>): List<TaskSection> {
        val byRepo = sorted(rows).groupBy { it.repo }
        val urgency = rows.sortedWith(compareBy<TaskRow> { groups.indexOf(group(it.group)) }.thenBy { it.rank })
        return urgency.map { it.repo }.distinct().map { TaskSection(it, byRepo.getValue(it)) }
    }
}

data class TaskSection(val repo: String, val rows: List<TaskRow>) {
    val name get() = repo.trimEnd('/').substringAfterLast('/')
}

/** A row as last received, and when: the age clock restarts only when the row changes (iOS `TaskStore.receivedAt`). */
data class Receipt(val row: TaskRow, val atMs: Long)

object TaskAge {
    fun receipts(previous: Map<String, Receipt>, rows: List<TaskRow>, nowMs: Long): Map<String, Receipt> =
        rows.associate { row -> row.id to (previous[row.id]?.takeIf { it.row == row } ?: Receipt(row, nowMs)) }

    /** Server `forMs` at receipt plus local elapsed time; null without activity. */
    fun ms(receipt: Receipt, nowMs: Long): Double? =
        receipt.row.activity?.let { it.forMs + maxOf(0L, nowMs - receipt.atMs) }

    fun label(ms: Double?): String {
        if (ms == null) return "—"
        val s = (ms / 1000).toInt()
        return when {
            s < 60 -> "${maxOf(s, 0)}s"
            s < 3600 -> "${s / 60}m"
            s < 86400 -> "${s / 3600}h"
            else -> "${s / 86400}d"
        }
    }
}

fun transitionNotices(previous: List<TaskRow>?, next: List<TaskRow>): List<TaskNotice> {
    val before = previous?.associateBy { it.id } ?: return emptyList()
    return next.mapNotNull { row ->
        val old = before[row.id] ?: return@mapNotNull null
        if (row.deleting) return@mapNotNull null
        val body = when {
            row.group == "waiting-on-you" && old.group != row.group -> "is waiting on you"
            old.group == "working" && row.group in listOf("ready-for-review", "idle") -> "finished working"
            else -> return@mapNotNull null
        }
        TaskNotice(row.id, row.displayTitle, "${row.displayTitle} $body")
    }
}

object Reconnect {
    fun delayMs(attempt: Int): Long = (500L shl attempt.coerceIn(0, 6)).coerceAtMost(30_000)
    fun retryable(httpCode: Int?) = httpCode != 401 && httpCode != 403
}
