package run.rove.mobile.domain

import java.time.Instant

// iOS Tasks/TaskListOrdering.swift, TaskSearch.swift and the TaskListLogic helpers in TaskStore.swift.

/** The list's sort modes, named as in the TUI. `raw` is what the choice is persisted as. */
enum class TaskSortMode(val raw: String) {
    /** What needs a person next: derived group rank, then server rank. The phone's resting order. */
    Attention("attention"),
    /** The daemon's own task order (`order`); what a manual move changes. */
    Default("default"),
    /** `updatedAt` (else `createdAt`) descending. */
    Recent("recent"),
    /** Title A→Z, numbers numeric, case-insensitive. */
    Name("name");

    companion object { fun of(raw: String?) = entries.firstOrNull { it.raw == raw } ?: Attention }
}

/** What the list shows in place of rows, if anything. */
enum class TaskListEmpty { None, Welcome, NoMatches }

/** Case-insensitive subsequence matching with a score, for the list's search field. */
object FuzzyMatch {
    private const val HIT = 16
    private const val CONSECUTIVE = 12
    private const val AT_START = 8
    private const val AT_BOUNDARY = 8
    private const val EXACT = 20

    /** null = [query] is not a subsequence of [text]; higher = better. An empty query matches everything with 0. */
    fun score(query: String, text: String): Int? {
        val q = query.lowercase()
        val h = text.lowercase()
        if (q.isEmpty()) return 0
        if (q.length > h.length) return null
        var best: Int? = null
        for (start in h.indices) {
            if (h[start] != q[0]) continue
            if (h.length - start < q.length) break
            var qi = 0
            var prev = -2
            var s = 0
            var hi = start
            while (hi < h.length && qi < q.length) {
                if (h[hi] == q[qi]) {
                    s += HIT
                    if (hi == prev + 1) s += CONSECUTIVE
                    if (hi == 0) s += AT_START else if (!h[hi - 1].isLetterOrDigit()) s += AT_BOUNDARY
                    if (prev >= 0 && hi > prev + 1) s -= 2 * minOf(hi - prev - 1, 3)
                    prev = hi
                    qi++
                }
                hi++
            }
            if (qi != q.length) continue
            s -= minOf(start, 10)
            if (h.length == q.length) s += EXACT
            best = maxOf(best ?: s, s)
        }
        return best
    }
}

/**
 * Which row fields the search reads. Each field is matched on its own, never joined: a joined string would let
 * `feat/tree` match a `feat/chat` row by spending `tree` on the title next to it.
 */
object RowSearch {
    /** Best field score, or null when no field matches. Title beats branch beats tab title beats repo. */
    fun score(query: String, row: TaskRow, tabTitles: List<String> = emptyList()): Int? {
        val fields = listOf(row.displayTitle to 6, row.branch to 2, row.repoName to 0, row.repo to -4) + tabTitles.map { it to 1 }
        return fields.mapNotNull { (text, bonus) -> if (text.isEmpty()) null else FuzzyMatch.score(query, text)?.plus(bonus) }.maxOrNull()
    }
}

object TaskListLogic {
    fun attentionCount(items: List<Attention>) = items.count { it.unread }

    fun repos(rows: List<TaskRow>) = rows.map { it.repo }.filter { it.isNotEmpty() }.distinct().sorted()

    fun filtered(rows: List<TaskRow>, repo: String?) = if (repo == null) rows else rows.filter { it.repo == repo }

    /**
     * Rows in display order: search score first (only with a query), then `main`, pinned, the rest, then the mode's
     * comparator, then list order. [tabTitles] (task id → its tabs' titles) widens a query to live tab titles.
     */
    fun sorted(rows: List<TaskRow>, mode: TaskSortMode = TaskSortMode.Attention, query: String = "",
               tabTitles: Map<String, List<String>> = emptyMap()) = rank(rows, mode, query, tabTitles, floating = true)

    /**
     * One section per project; rows keep `sorted` order. Project order follows the TUI for default/recent/name: the
     * project's `main` task in stored order, then main-less projects first-seen. `attention` keeps the phone's own rule —
     * most urgent task first. It is taken from ALL rows, so sections do not jump around while a search narrows.
     */
    fun projects(rows: List<TaskRow>, mode: TaskSortMode = TaskSortMode.Attention, query: String = "",
                 tabTitles: Map<String, List<String>> = emptyMap()): List<TaskSection> {
        val sections = sorted(rows, mode, query, tabTitles).groupBy { it.repo }.map { (repo, rs) -> TaskSection(repo, rs) }
        if (sections.size < 2) return sections
        val position = projectOrder(rows, mode).withIndex().associate { it.value to it.index }
        return sections.sortedBy { position[it.repo] ?: Int.MAX_VALUE }
    }

    fun emptiness(loaded: Boolean, total: Int, shown: Int) = when {
        !loaded -> TaskListEmpty.None
        total == 0 -> TaskListEmpty.Welcome
        shown == 0 -> TaskListEmpty.NoMatches
        else -> TaskListEmpty.None
    }

    /** Epoch seconds for the `recent` sort: `updatedAt`, else `createdAt`; 0 when absent or unparseable. */
    fun recentTime(row: TaskRow): Double {
        val raw = listOfNotNull(row.updatedAt, row.createdAt).firstOrNull { it.isNotEmpty() } ?: return 0.0
        return runCatching { Instant.parse(raw).toEpochMilli() / 1000.0 }.getOrDefault(0.0)
    }

    private class Entry(val offset: Int, val row: TaskRow, val score: Int)

    private fun rank(rows: List<TaskRow>, mode: TaskSortMode, query: String, tabTitles: Map<String, List<String>> = emptyMap(),
                     floating: Boolean): List<TaskRow> {
        val q = query.trim()
        val entries = rows.mapIndexedNotNull { i, r ->
            if (q.isEmpty()) Entry(i, r, 0) else RowSearch.score(q, r, tabTitles[r.id].orEmpty())?.let { Entry(i, r, it) }
        }
        val order = Comparator<Entry> { a, b ->
            if (a.score != b.score) return@Comparator b.score.compareTo(a.score)
            if (floating) floatRank(a.row).compareTo(floatRank(b.row)).let { if (it != 0) return@Comparator it }
            compare(a.row, b.row, mode).let { if (it != 0) it else a.offset.compareTo(b.offset) }
        }
        return entries.sortedWith(order).map { it.row }
    }

    /** `main` first (the TUI always pins it), then pinned, then the rest. */
    private fun floatRank(r: TaskRow) = if (r.kind == "main") 0 else if (r.pinned) 1 else 2

    private fun groupIndex(r: TaskRow) = TaskOrdering.groups.indexOf(TaskOrdering.group(r.group))

    /** Negative / 0 / positive; 0 hands the decision to list order. */
    private fun compare(a: TaskRow, b: TaskRow, mode: TaskSortMode): Int = when (mode) {
        TaskSortMode.Attention -> groupIndex(a).compareTo(groupIndex(b)).let { if (it != 0) it else a.rank.compareTo(b.rank) }
        // Rows the daemon gave no `order` sort after the ones it did, in list order.
        TaskSortMode.Default -> when {
            a.order != null && b.order != null -> a.order.compareTo(b.order)
            a.order != null -> -1
            b.order != null -> 1
            else -> 0
        }
        TaskSortMode.Recent -> recentTime(b).compareTo(recentTime(a)).let { if (it != 0) it else idCompare(b.id, a.id) }
        TaskSortMode.Name -> naturalCompare(a.displayTitle.trim(), b.displayTitle.trim()).let { if (it != 0) it else idCompare(a.id, b.id) }
    }

    private fun idCompare(a: String, b: String) = a.compareTo(b, ignoreCase = true)

    /** Case-insensitive, digit runs compared as numbers (`task 2` < `task 10`): iOS `localizedStandardCompare`. */
    internal fun naturalCompare(a: String, b: String): Int {
        val ta = tokens(a)
        val tb = tokens(b)
        for (i in 0 until minOf(ta.size, tb.size)) {
            val x = ta[i]
            val y = tb[i]
            val c = if (x[0].isDigit() && y[0].isDigit()) {
                val nx = x.trimStart('0')
                val ny = y.trimStart('0')
                if (nx.length != ny.length) nx.length.compareTo(ny.length) else nx.compareTo(ny)
            } else x.compareTo(y, ignoreCase = true)
            if (c != 0) return c
        }
        return ta.size.compareTo(tb.size)
    }

    private fun tokens(s: String): List<String> {
        val out = mutableListOf<String>()
        var i = 0
        while (i < s.length) {
            val digit = s[i].isDigit()
            var j = i
            while (j < s.length && s[j].isDigit() == digit) j++
            out += s.substring(i, j)
            i = j
        }
        return out
    }

    private fun projectOrder(rows: List<TaskRow>, mode: TaskSortMode): List<String> {
        val keys = LinkedHashSet<String>()
        if (mode == TaskSortMode.Attention) {
            rank(rows, TaskSortMode.Attention, "", floating = false).forEach { keys += it.repo }
        } else {
            val stored = rank(rows, TaskSortMode.Default, "", floating = false)
            stored.filter { it.kind == "main" }.forEach { keys += it.repo }
            stored.forEach { keys += it.repo }
        }
        return keys.toList()
    }
}
