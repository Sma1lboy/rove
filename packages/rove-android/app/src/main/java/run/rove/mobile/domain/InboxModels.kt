package run.rove.mobile.domain

import kotlinx.serialization.Serializable
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/** One tab the phone showed: the RECENT section's source; `at` is epoch milliseconds (iOS `Visit`). */
@Serializable data class Visit(val taskId: String, val tabId: String? = null, val at: Double)

/** Title and running flag for a tab RECENT shows. */
data class RecentTab(val title: String, val running: Boolean)

/** Ordering and wording for the Inbox (iOS `InboxLogic`). */
object InboxLogic {
    const val RECENT_LIMIT = 5

    /** Stopped until a person acts: everything except a plain finished turn. */
    fun isBlocking(item: Attention) = item.state != "turn_complete"

    /** One episode per tab, the fresh one replacing the stale. */
    fun key(item: Attention): String {
        if (item.taskId == null && item.label != null) return "${item.state}\u0000${item.label}"
        return "${item.taskId.orEmpty()}\u0000${item.tabId.orEmpty()}"
    }

    fun visitKey(taskId: String, tabId: String?) = "$taskId\u0000${tabId.orEmpty()}"

    /** Blocked episodes first, then oldest first; task order and key break ties. */
    fun sorted(items: List<Attention>, taskOrder: List<String>): List<Attention> {
        val index = HashMap<String, Int>()
        taskOrder.forEachIndexed { i, id -> index.putIfAbsent(id, i) }
        fun order(a: Attention) = a.taskId?.let { index[it] } ?: Int.MAX_VALUE
        return items.sortedWith(compareBy<Attention>({ if (isBlocking(it)) 0 else 1 }, { it.at }, ::order, ::key))
    }

    /** F7: the first pending item, or the one after `lastKey` so repeated presses walk the queue and wrap. */
    fun next(lastKey: String?, sortedItems: List<Attention>): Attention? {
        val openable = sortedItems.filter { it.taskId != null }
        if (openable.isEmpty()) return null
        val at = lastKey?.let { k -> openable.indexOfFirst { key(it) == k } } ?: -1
        return if (at < 0) openable[0] else openable[(at + 1) % openable.size]
    }

    /** The last tabs visited, newest first, one row per (task, tab); pending targets and deleted tasks are skipped. */
    fun recent(visits: List<Visit>, attention: List<Attention>, taskIds: Set<String>, limit: Int = RECENT_LIMIT): List<Visit> {
        val seen = HashSet<String>()
        val out = ArrayList<Visit>()
        for (v in visits.sortedByDescending { it.at }) {
            if (v.taskId !in taskIds) continue
            if (!seen.add(visitKey(v.taskId, v.tabId))) continue
            if (attention.any { it.taskId == v.taskId && (it.tabId == null || it.tabId == v.tabId) }) continue
            out += v
            if (out.size == limit) break
        }
        return out
    }

    /** Fold a visit into the log: newest per target kept, capped so the log stays small. */
    fun appending(visit: Visit, visits: List<Visit>, cap: Int = 30): List<Visit> =
        (listOf(visit) + visits.filterNot { it.taskId == visit.taskId && it.tabId == visit.tabId }).take(cap)

    /** The tab-strip glyph that goes with the state word. */
    fun glyph(state: String) = when (state) {
        "permission_needed" -> "?"
        "rate_limited" -> "◷"
        "error", "routine_failed" -> "!"
        "dead" -> "†"
        "turn_complete" -> "●"
        else -> "○"
    }

    /** `3:14 PM` (with the day when it is not today); null without a usable time. */
    fun resumeTime(iso: String?, now: Instant = Instant.now(), zone: ZoneId = ZoneId.systemDefault(),
                   locale: Locale = Locale.getDefault()): String? {
        val date = runCatching { Instant.parse(iso ?: return null).atZone(zone) }.getOrNull() ?: return null
        val time = DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT).withLocale(locale).format(date)
        val text = if (date.toLocalDate() == now.atZone(zone).toLocalDate()) time
        else "${DateTimeFormatter.ofPattern("MMM d", locale).format(date)} $time"
        // ICU puts a narrow no-break space before AM/PM; the mono face shows it as a gap.
        return text.replace('\u202F', ' ')
    }
}
