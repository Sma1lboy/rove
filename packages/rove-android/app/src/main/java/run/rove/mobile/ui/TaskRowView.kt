package run.rove.mobile.ui

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.scale
import androidx.compose.foundation.Canvas
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathFillType
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import run.rove.mobile.R
import run.rove.mobile.domain.*

// iOS Tasks/TaskRowView.swift + TaskRowMarks.swift. Plugin row tokens are not modelled on Android, so the title line has none.

internal enum class MarkTone { Success, Error, Accent, Muted }
internal data class Mark(val text: String, val tone: MarkTone)

/** Pure formatting for the marks on a row (iOS `TaskRowMarks`). */
internal object TaskRowMarks {
    const val PINNED = "▴"

    /** `+N/−N` when the daemon counted lines; `?` when git failed; nothing otherwise. */
    fun changes(c: TaskChanges?): List<Mark> {
        if (c == null) return emptyList()
        if (c.unreadable == true) return listOf(Mark("?", MarkTone.Muted))
        if ((c.added ?: 0) <= 0 && (c.deleted ?: 0) <= 0) return emptyList()
        return listOf(Mark("+${c.added ?: 0}", MarkTone.Success), Mark("/", MarkTone.Muted), Mark("−${c.deleted ?: 0}", MarkTone.Error))
    }

    /** `↑N/↓N` ahead (muted) / behind (accent); only the non-zero side is drawn. */
    fun aheadBehind(c: TaskChanges?): List<Mark> {
        if (c == null || c.unreadable == true) return emptyList()
        val out = mutableListOf<Mark>()
        c.ahead?.takeIf { it > 0 }?.let { out += Mark("↑$it", MarkTone.Muted) }
        c.behind?.takeIf { it > 0 }?.let {
            if (out.isNotEmpty()) out += Mark("/", MarkTone.Muted)
            out += Mark("↓$it", MarkTone.Accent)
        }
        return out
    }

    /** The bridge's `prChip` wins; an older bridge sends none, so the same rules run over `pr`. */
    fun chipKind(row: TaskRow): String? = row.prChip ?: row.pr?.let(::chipKind)

    fun chipKind(pr: TaskPR): String? = when {
        pr.mergeable.orEmpty().uppercase() == "CONFLICTING" -> "conflict"
        pr.checkState.lowercase() == "failing" -> "failing"
        pr.checkState.lowercase() == "passing" -> "passing"
        else -> null
    }

    /** `≠` conflict / `✗` failing (error), `✓` passing (success); muted when the PR status is stale. */
    fun prMark(kind: String?, stale: Boolean): Mark? {
        val (text, tone) = when (kind) {
            "conflict" -> "≠" to MarkTone.Error
            "failing" -> "✗" to MarkTone.Error
            "passing" -> "✓" to MarkTone.Success
            else -> return null
        }
        return Mark(text, if (stale) MarkTone.Muted else tone)
    }
}

@Composable private fun MarkTone.color(): Color = when (this) {
    MarkTone.Success -> Rove.c.success
    MarkTone.Error -> Rove.c.error
    MarkTone.Accent -> Rove.c.accent
    MarkTone.Muted -> Rove.c.muted
}

/** Mono segments on one line, each in its own tone (iOS `MarkText`). */
@Composable private fun MarkText(segments: List<Mark>) {
    val colors = segments.map { it.tone.color() }
    Text(buildAnnotatedString {
        segments.forEachIndexed { i, s -> withStyle(SpanStyle(color = colors[i])) { append(s.text) } }
    }, maxLines = 1, softWrap = false, style = Rove.mono(11, FontWeight.Medium))
}

/** `#12 ✓`: the PR number in muted mono, then the check / conflict mark (iOS `PRTag`). */
@Composable private fun PRTag(number: Int?, mark: Mark?) {
    Row(horizontalArrangement = Arrangement.spacedBy(3.dp), verticalAlignment = Alignment.CenterVertically) {
        if (number != null) Text("#$number", color = Rove.c.muted, maxLines = 1, softWrap = false, style = Rove.mono(11, FontWeight.Medium))
        if (mark != null) MarkText(listOf(mark))
    }
}

/** `ab…yz`: the longest middle cut of [text] that [fits]; the head keeps floor(n/2) characters, the tail the rest. */
internal fun middleEllipsis(text: String, fits: (String) -> Boolean): String {
    if (fits(text)) return text
    fun cut(n: Int) = text.take(n / 2) + "…" + text.takeLast(n - n / 2)
    var lo = 0
    var hi = text.length - 1
    while (lo < hi) {
        val mid = (lo + hi + 1) / 2
        if (fits(cut(mid))) lo = mid else hi = mid - 1
    }
    return cut(lo)
}

@Composable private fun MiddleEllipsisText(text: String, style: TextStyle, color: Color, modifier: Modifier = Modifier) {
    val measurer = rememberTextMeasurer()
    BoxWithConstraints(modifier) {
        val max = constraints.maxWidth
        val shown = remember(text, style, max) {
            middleEllipsis(text) { measurer.measure(it, style, softWrap = false, maxLines = 1).size.width <= max }
        }
        Text(shown, color = color, style = style, maxLines = 1, softWrap = false)
    }
}

/** accentSoft wash + 0.97 scale on press, critically damped (iOS `RowButtonStyle`). */
@OptIn(ExperimentalFoundationApi::class)
@Composable private fun Modifier.rowPress(onClick: () -> Unit, onLongClick: () -> Unit): Modifier {
    val haptics = LocalHapticFeedback.current
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    val scale by animateFloatAsState(if (pressed) 0.97f else 1f, spring(dampingRatio = 1f, stiffness = 600f), label = "rowPress")
    val wash = if (pressed) Rove.c.accentSoft else Color.Transparent
    return scale(scale).background(wash, RoundedCornerShape(Rove.smallRadius)).combinedClickable(source, null, onClick = onClick,
        onLongClick = { haptics.performHapticFeedback(HapticFeedbackType.LongPress); onLongClick() })
}

/** Age text on its own scope: the once-a-second clock invalidates this alone, not the row. */
@Composable private fun RowAge(receipt: Receipt, now: State<Long>) {
    Text(TaskAge.label(TaskAge.ms(receipt, now.value)), color = Rove.c.muted, maxLines = 1, style = Rove.mono(13))
}

/**
 * Web `EngineIcon`: the engine's brand mark before the title, in its brand colours (the row's ink where the brand is
 * black or white); a ring for an engine that declares none. The engine's name stays in the right column.
 */
@Composable fun EngineMark(icon: EngineIcon?, modifier: Modifier = Modifier) {
    val ink = Rove.c.ink
    val ring = Rove.c.muted
    val paths = remember(icon) {
        icon?.paths?.mapNotNull { p ->
            runCatching {
                PathParser().parsePathString(p.d).toPath().apply { if (p.evenodd) fillType = PathFillType.EvenOdd } to
                    p.fill?.let { Color(android.graphics.Color.parseColor(it)) }
            }.getOrNull()
        }.orEmpty()
    }
    val box = remember(icon) { icon?.viewBox?.trim()?.split(Regex("[\\s,]+"))?.mapNotNull { it.toFloatOrNull() }?.takeIf { it.size == 4 } }
    Canvas(modifier.size(16.dp)) {
        if (paths.isEmpty() || box == null) {
            drawCircle(ring, radius = size.minDimension * 4.5f / 14f, style = Stroke(size.minDimension * 1.2f / 14f))
            return@Canvas
        }
        val (x, y, w, h) = box
        val k = size.minDimension / maxOf(w, h)
        withTransform({
            translate((size.width - w * k) / 2f, (size.height - h * k) / 2f)
            scale(k, k, Offset.Zero)
            translate(-x, -y)
        }) { paths.forEach { (path, fill) -> drawPath(path, fill ?: ink) } }
    }
}

/** Line 1: pin mark + title. Line 2: status tag, branch, marks. Right column: age over engine. Nothing wraps. */
@Composable fun TaskRowView(row: TaskRow, receipt: Receipt, now: State<Long>, icon: EngineIcon? = null, onLongClick: () -> Unit = {},
                            onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().rowPress(onClick, onLongClick).padding(horizontal = 12.dp, vertical = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f).padding(end = 8.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(5.dp), verticalAlignment = Alignment.CenterVertically) {
                if (row.engine != null) EngineMark(icon, Modifier.padding(end = 2.dp))
                if (row.pinned) {
                    val pinned = stringResource(R.string.list_pinned)
                    Text(TaskRowMarks.PINNED, Modifier.semantics { contentDescription = pinned }, color = Rove.c.accent,
                        style = Rove.mono(13, FontWeight.Bold))
                }
                Text(row.displayTitle, color = Rove.c.ink, maxLines = 1, overflow = TextOverflow.Ellipsis, style = Rove.face(16, FontWeight.Medium))
            }
            DetailLine(row)
        }
        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(5.dp)) {
            RowAge(receipt, now)
            row.engine?.let { Text(it.name.lowercase(), color = Rove.c.muted, maxLines = 1, style = Rove.mono(11)) }
        }
    }
}

@Composable private fun DetailLine(row: TaskRow) {
    val changes = TaskRowMarks.changes(row.changes)
    val drift = TaskRowMarks.aheadBehind(row.changes)
    val branchStyle = Rove.mono(12)
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
        if (row.deleting) Text(stringResource(R.string.list_deleting), color = Rove.c.muted, style = Rove.mono(11, FontWeight.Medium))
        else StatusTag(TaskOrdering.group(row.group))
        if (row.kind == "main") Text(stringResource(R.string.list_main_checkout), color = Rove.c.muted, maxLines = 1, style = branchStyle)
        else if (row.branch.isNotEmpty()) MiddleEllipsisText(row.branch, branchStyle, Rove.c.muted, Modifier.weight(1f, fill = false))
        // Fixed-size marks keep their glyphs; the branch is what gives way.
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
            if (changes.isNotEmpty()) MarkText(changes)
            if (drift.isNotEmpty()) MarkText(drift)
            val mark = TaskRowMarks.prMark(TaskRowMarks.chipKind(row), row.prChipStale)
            if (row.pr != null) PRTag(row.pr.number, mark) else if (mark != null) MarkText(listOf(mark))
        }
    }
}
