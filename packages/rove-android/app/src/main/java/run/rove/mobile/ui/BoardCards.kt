package run.rove.mobile.ui

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import run.rove.mobile.R
import run.rove.mobile.domain.*

// iOS Pages/BoardCards.swift: the phone layout, one column's cards on screen at a time.

@Composable internal fun columnTitle(key: BoardColumn) = stringResource(when (key) {
    BoardColumn.Backlog -> R.string.board_column_backlog
    BoardColumn.InProgress -> R.string.board_column_in_progress
    BoardColumn.Parked -> R.string.board_column_parked
    BoardColumn.Done -> R.string.board_column_done
})

/** Content-sized mono tiles that scroll sideways when there are many (iOS `ChoiceTiles`, `fill: false`). */
@Composable internal fun <T> BoardTiles(options: List<T>, selection: T, label: @Composable (T) -> String, onSelect: (T) -> Unit) {
    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        options.forEach { option ->
            val on = option == selection
            Box(Modifier.heightIn(min = 40.dp).selectableTile(on).pressable { onSelect(option) }, contentAlignment = Alignment.Center) {
                Text(label(option), Modifier.padding(horizontal = 12.dp), color = if (on) Rove.c.accent else Rove.c.ink,
                    style = Rove.mono(13, if (on) FontWeight.SemiBold else FontWeight.Normal), maxLines = 1)
            }
        }
    }
}

/** Phone column switch: four mono tiles, `backlog 3 · in progress 2 · parked 0 · done 5`. */
@Composable fun BoardColumnTabs(columns: List<BoardColumnData>, selection: BoardColumn, onSelect: (BoardColumn) -> Unit) {
    BoardTiles(BoardColumn.entries, selection, { key ->
        "${columnTitle(key)} ${columns.firstOrNull { it.key == key }?.total ?: 0}"
    }, onSelect)
}

@Composable private fun EmptyLines(key: BoardColumn) {
    val (title, detail) = when (key) {
        BoardColumn.Backlog -> R.string.board_empty_backlog to R.string.board_empty_backlog_hint
        BoardColumn.InProgress -> R.string.board_empty_in_progress to R.string.board_empty_in_progress_hint
        BoardColumn.Parked -> R.string.board_empty_parked to R.string.board_empty_parked_hint
        BoardColumn.Done -> R.string.board_empty_done to R.string.board_empty_done_hint
    }
    EmptyState(stringResource(title), stringResource(detail), Modifier.padding(top = 6.dp))
}

/** One column's cards as a vertical list; capped columns end in `+N more`. */
internal fun LazyListScope.boardColumnItems(column: BoardColumnData, task: (String) -> TaskRow?, open: (Story) -> Unit) {
    if (column.stories.isEmpty()) item(key = "empty:${column.key}") { EmptyLines(column.key) }
    items(column.stories, key = { "story:${it.id}" }) { story ->
        Box(Modifier.padding(bottom = 8.dp)) { StoryCard(story, story.link?.let(task)) { open(story) } }
    }
    if (column.hiddenCount > 0) item(key = "more") {
        Text(stringResource(R.string.board_more, column.hiddenCount), Modifier.padding(top = 2.dp), color = Rove.c.muted,
            style = Rove.mono(12))
    }
}

/**
 * One story: `#id` and title, the first line of its description, and for a linked story the task's status tag with its
 * engine. A link whose task is not in the feed yet reads `linked`.
 */
@Composable fun StoryCard(story: Story, task: TaskRow?, open: () -> Unit) {
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(Rove.radius)).pressable(onClick = open).tile()
        .padding(horizontal = 14.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("#${story.id}", Modifier.alignByBaseline(), color = Rove.c.muted, style = Rove.mono(12, FontWeight.Medium))
            Text(story.title, Modifier.alignByBaseline().weight(1f), color = Rove.c.ink, maxLines = 2,
                overflow = TextOverflow.Ellipsis, style = Rove.face(15, FontWeight.SemiBold))
        }
        BoardCardLogic.firstLine(story.detail)?.let {
            Text(it, color = Rove.c.muted, maxLines = 1, overflow = TextOverflow.Ellipsis, style = Rove.face(13))
        }
        if (story.linked) Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            if (task != null) {
                StatusTag(task.group)
                task.engine?.let { Text(it.name.lowercase(), color = Rove.c.muted, style = Rove.mono(11)) }
            } else Text(stringResource(R.string.board_linked), color = Rove.c.muted, style = Rove.mono(11))
        }
    }
}
