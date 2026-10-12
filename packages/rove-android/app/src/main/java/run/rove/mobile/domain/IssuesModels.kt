package run.rove.mobile.domain

import kotlinx.serialization.Serializable
import java.time.Instant

// GitHub issues through `gh` (iOS `WorkItem*` + `WorkItemLogic`); every field defaults so an older bridge never fails a list.
@Serializable data class WorkItem(
    val number: Int,
    val title: String = "",
    val state: String = "",
    val url: String = "",
    val updatedAt: String = "",
    val author: String? = null,
    val labels: List<String> = emptyList(),
)
@Serializable data class WorkItemsPayload(val items: List<WorkItem> = emptyList())
@Serializable data class WorkItemLink(val number: Int, val taskId: String)
@Serializable data class WorkItemLinksPayload(val links: List<WorkItemLink> = emptyList())
@Serializable data class WorkItemStartResult(val taskId: String)
/** `engines.list` row with the flag the issue sheet filters on; the shared `Engine` model does not carry it. */
@Serializable data class IssueEngine(val id: String, val name: String = "", val builtin: Boolean = false)
@Serializable data class IssueEnginesPayload(val engines: List<IssueEngine> = emptyList())

object IssueLogic {
    /** `gh` failures arrive as `kind: message`; returns the kind when it names a known fix, else null. */
    fun failureKind(message: String): String? =
        message.substringBefore(": ", "").takeIf { it in setOf("no-remote", "gh-missing", "auth") }

    fun linkedTask(item: WorkItem, links: List<WorkItemLink>): String? = links.firstOrNull { it.number == item.number }?.taskId

    /** The remembered repo while it still exists, else the first one. */
    fun currentRepo(repos: List<String>?, stored: String): String =
        if (repos.isNullOrEmpty()) "" else if (stored in repos) stored else repos[0]

    /** `3d`, `4h`, `12m`, `30s` since [iso]; null when the time does not parse. */
    fun age(iso: String, nowMs: Long): String? {
        val at = runCatching { Instant.parse(iso).toEpochMilli() }.getOrNull() ?: return null
        val s = (maxOf(0L, nowMs - at) / 1000).toInt()
        return when {
            s < 60 -> "${s}s"
            s < 3600 -> "${s / 60}m"
            s < 86400 -> "${s / 3600}h"
            else -> "${s / 86400}d"
        }
    }

    /** `author · 3d ago · [bug] [ui] [p1]`: who and when, then the first three labels. */
    fun meta(item: WorkItem, ago: String?): String {
        val who = listOfNotNull(item.author, ago).filter { it.isNotEmpty() }.joinToString(" · ")
        val labels = item.labels.take(3).joinToString(" ") { "[$it]" }
        return listOf(who, labels).filter { it.isNotEmpty() }.joinToString(" · ")
    }
}
