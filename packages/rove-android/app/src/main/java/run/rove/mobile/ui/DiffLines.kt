package run.rove.mobile.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import run.rove.mobile.R
import run.rove.mobile.domain.*

private val Gutter = 46.dp

@Composable private fun DiffLineKind.color(): Color = when (this) {
    DiffLineKind.Added -> Rove.c.success
    DiffLineKind.Removed -> Rove.c.error
    DiffLineKind.Hunk -> Rove.c.accent
    DiffLineKind.Meta -> Rove.c.muted
    DiffLineKind.Context -> Rove.c.ink
}

@Composable private fun DiffLineKind.wash(): Color = when (this) {
    DiffLineKind.Added -> Rove.c.success.copy(alpha = 0.14f)
    DiffLineKind.Removed -> Rove.c.error.copy(alpha = 0.13f)
    DiffLineKind.Hunk -> Rove.c.inset
    DiffLineKind.Meta, DiffLineKind.Context -> Color.Transparent
}

/** A unified diff (or file text) as numbered mono rows; the whole body scrolls sideways as one block, like iOS. */
@Composable fun DiffLines(lines: List<DiffLine>, modifier: Modifier = Modifier) {
    val measurer = rememberTextMeasurer()
    val density = LocalDensity.current
    val code = Rove.mono(12).copy(lineHeight = 1.2.em)
    // Width that holds the longest line, so every row's wash reaches the same edge.
    val charWidth = remember(density) { with(density) { (measurer.measure("0".repeat(100), Rove.mono(12)).size.width / 100f).toDp() } }
    val longest = lines.maxOfOrNull { it.text.length } ?: 0
    BoxWithConstraints(modifier.background(Rove.c.surface)) {
        val width = maxOf(Gutter + 10.dp + charWidth * (longest + 2), maxWidth)
        Box(Modifier.fillMaxSize().horizontalScroll(rememberScrollState())) {
            LazyColumn(Modifier.width(width).fillMaxHeight(), contentPadding = PaddingValues(bottom = 80.dp)) {
                items(lines, key = { it.id }) { line ->
                    Row(Modifier.fillMaxWidth().background(line.kind.wash()).padding(vertical = if (line.kind == DiffLineKind.Hunk) 4.dp else 1.dp),
                        verticalAlignment = Alignment.CenterVertically) {
                        Text(line.number?.toString().orEmpty(), Modifier.width(Gutter), color = Rove.c.muted,
                            style = Rove.mono(11).copy(lineHeight = 1.2.em), textAlign = TextAlign.End, maxLines = 1)
                        Spacer(Modifier.width(6.dp))
                        Text(line.text.ifEmpty { " " }, color = line.kind.color(), style = code, softWrap = false,
                            maxLines = 1, overflow = TextOverflow.Clip)
                    }
                }
            }
        }
    }
}

/** What a `diff.file` result that is not a plain diff or file reads like (iOS `DiffFileState`); null for `diff` and `code`. */
@Composable internal fun diffStateText(r: DiffContent): Pair<String, String>? {
    val size = r.sizeBytes?.let(DiffParse::fileSize)
    return when (r.kind) {
        "binary" -> stringResource(if (r.image == true) R.string.diff_image else R.string.diff_binary) to
            listOfNotNull(size, stringResource(R.string.diff_no_text_preview)).joinToString(" · ")
        "empty" -> stringResource(R.string.diff_no_changes) to stringResource(R.string.diff_empty_detail)
        "patch-note" -> {
            val n = r.note
            val from = n?.from ?: "?"
            val to = n?.to ?: "?"
            when (n?.kind) {
                "binary" -> stringResource(R.string.diff_binary_changed) to
                    listOfNotNull(size, stringResource(R.string.diff_no_text_diff)).joinToString(" · ")
                "mode" -> stringResource(R.string.diff_mode_changed) to stringResource(R.string.diff_mode_detail, from, to)
                "rename" -> stringResource(R.string.diff_renamed) to stringResource(R.string.diff_rename_detail, from, to)
                "empty-file" -> stringResource(if (n?.change == "deleted") R.string.diff_empty_deleted else R.string.diff_empty_added) to
                    stringResource(R.string.diff_no_lines)
                else -> stringResource(R.string.diff_changed) to stringResource(R.string.diff_no_hunks)
            }
        }
        else -> null
    }
}
