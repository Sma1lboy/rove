package run.rove.mobile.domain

import java.util.Locale

// Port of iOS Diff/DiffParse.swift + DiffFilesView's ChangeGroup: line numbers match the TUI's `unifiedDiffRows`.

enum class DiffLineKind { Added, Removed, Hunk, Meta, Context }

/** `number` is the gutter number: new-file for added/context rows, old-file for removed rows, null for headers. */
data class DiffLine(val id: Int, val kind: DiffLineKind, val text: String, val number: Int?)

data class DiffCounts(val added: Int, val deleted: Int)

/** One file's slice of a multi-file patch (a directory or whole-worktree diff). */
data class DiffSection(val path: String, val text: String, val added: Int, val deleted: Int)

/** Changed files in one directory; a root file has `dir == ""`. */
data class ChangeGroup(val dir: String, val files: List<DiffFile>)

object DiffParse {
    /** `@@ -a[,b] +c[,d] @@` → (a, c). */
    private fun hunkStarts(line: String): Pair<Int, Int>? {
        if (!line.startsWith("@@ -")) return null
        val parts = line.drop(3).split(' ').filter { it.isNotEmpty() }
        if (parts.size < 2 || !parts[0].startsWith("-") || !parts[1].startsWith("+")) return null
        fun first(s: String) = s.drop(1).split(',').firstOrNull { it.isNotEmpty() }?.toIntOrNull()
        return (first(parts[0]) ?: return null) to (first(parts[1]) ?: return null)
    }

    private fun rows(text: String): List<String> = text.split('\n').let { if (it.last().isEmpty()) it.dropLast(1) else it }

    fun lines(text: String): List<DiffLine> {
        val out = ArrayList<DiffLine>()
        var oldLine = 0
        var newLine = 0
        var inHunk = false
        rows(text).forEachIndexed { i, raw ->
            hunkStarts(raw)?.let { (o, n) ->
                oldLine = o; newLine = n; inHunk = true
                out += DiffLine(i, DiffLineKind.Hunk, raw, null)
                return@forEachIndexed
            }
            if (inHunk) {
                when (raw.firstOrNull()) {
                    '+' -> { out += DiffLine(i, DiffLineKind.Added, raw, newLine); newLine++; return@forEachIndexed }
                    '-' -> { out += DiffLine(i, DiffLineKind.Removed, raw, oldLine); oldLine++; return@forEachIndexed }
                    ' ', null -> { out += DiffLine(i, DiffLineKind.Context, raw, newLine); oldLine++; newLine++; return@forEachIndexed }
                    '\\' -> { out += DiffLine(i, DiffLineKind.Meta, raw, null); return@forEachIndexed }
                    else -> inHunk = false
                }
            }
            out += DiffLine(i, DiffLineKind.Meta, raw, null)
        }
        return out
    }

    /** A plain file as numbered rows. */
    fun codeLines(text: String): List<DiffLine> =
        rows(text).mapIndexed { i, raw -> DiffLine(i, DiffLineKind.Context, raw, i + 1) }

    fun counts(text: String): DiffCounts = lines(text).let { rows ->
        DiffCounts(rows.count { it.kind == DiffLineKind.Added }, rows.count { it.kind == DiffLineKind.Removed })
    }

    /** Split on `diff --git` headers; the path is the b side, which is where a rename now lives. */
    fun sections(patch: String): List<DiffSection> {
        val out = ArrayList<DiffSection>()
        var path: String? = null
        var buf = ArrayList<String>()
        fun flush() {
            path?.let { p ->
                val text = buf.joinToString("\n")
                out += counts(text).let { DiffSection(p, text, it.added, it.deleted) }
            }
            buf = ArrayList()
        }
        for (line in patch.split('\n')) {
            if (line.startsWith("diff --git ")) { flush(); path = bPath(line) }
            buf += line
        }
        flush()
        return out
    }

    /** `diff --git a/x b/y` → `y`; quoted and spaced names fall back to the text after ` b/`. */
    private fun bPath(header: String): String {
        val rest = header.removePrefix("diff --git ")
        val at = rest.lastIndexOf(" b/")
        return if (at >= 0) rest.substring(at + 3).trim('"') else rest
    }

    /** Directory of a worktree-relative path with its trailing slash (`""` for a root file). */
    fun parent(path: String): String = path.substring(0, path.lastIndexOf('/') + 1)

    fun groups(files: List<DiffFile>): List<ChangeGroup> =
        files.groupBy { parent(it.path) }.toSortedMap { a, b -> naturalCompare(a, b) }.map { (dir, group) -> ChangeGroup(dir, group) }

    /** Finder-style order: case-insensitive, digit runs compare as numbers (iOS `localizedStandardCompare`). */
    internal fun naturalCompare(a: String, b: String): Int {
        var i = 0
        var j = 0
        while (i < a.length && j < b.length) {
            if (a[i].isDigit() && b[j].isDigit()) {
                var ie = i; while (ie < a.length && a[ie].isDigit()) ie++
                var je = j; while (je < b.length && b[je].isDigit()) je++
                val x = a.substring(i, ie).trimStart('0')
                val y = b.substring(j, je).trimStart('0')
                val byLength = x.length.compareTo(y.length)
                if (byLength != 0) return byLength
                val byDigits = x.compareTo(y)
                if (byDigits != 0) return byDigits
                i = ie; j = je
            } else {
                val c = a[i].lowercaseChar().compareTo(b[j].lowercaseChar())
                if (c != 0) return c
                i++; j++
            }
        }
        return (a.length - i).compareTo(b.length - j).let { if (it != 0) it else a.compareTo(b) }
    }

    /** `ByteCountFormatter` file style, lowercased: decimal units, one decimal below 10. */
    fun fileSize(bytes: Long): String {
        if (bytes < 1000) return if (bytes == 1L) "1 byte" else "$bytes bytes"
        var value = bytes / 1000.0
        var unit = "kb"
        for (next in listOf("mb", "gb", "tb")) {
            if (value < 1000) break
            value /= 1000; unit = next
        }
        return (if (value < 10) String.format(Locale.ROOT, "%.1f", value).removeSuffix(".0") else Math.round(value).toString()) + " " + unit
    }
}
