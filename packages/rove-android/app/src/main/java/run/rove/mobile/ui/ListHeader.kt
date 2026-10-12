package run.rove.mobile.ui

import android.content.Context
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import run.rove.mobile.R
import run.rove.mobile.domain.TaskSortMode

// iOS Tasks/TaskListView.swift header: bell, filter, search, sort, pages, settings (HeaderIcon grammar: muted 17pt glyph in a 36 box).

/** The list's filter / search / sort choices (iOS `repoFilter`, `searching`, `query`, `@AppStorage("taskSortMode")`). */
@Stable internal class ListControls(sort: TaskSortMode = TaskSortMode.Attention, private val persist: (TaskSortMode) -> Unit = {}) {
    var filter by mutableStateOf<String?>(null)
    var searching by mutableStateOf(false)
    var query by mutableStateOf("")
    var sort by mutableStateOf(sort)
        private set

    fun pick(mode: TaskSortMode) { sort = mode; persist(mode) }

    /** Closing the field clears the query, which restores the full list. */
    fun toggleSearch() { searching = !searching; if (!searching) query = "" }
}

private const val PREFS = "list"
private const val SORT_KEY = "taskSortMode"

@Composable internal fun rememberListControls(): ListControls {
    val prefs = LocalContext.current.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val sort = remember { TaskSortMode.of(prefs.getString(SORT_KEY, null)) }
    val persist = remember { { mode: TaskSortMode -> prefs.edit().putString(SORT_KEY, mode.raw).apply() } }
    val saver = remember {
        listSaver<ListControls, Any?>(
            save = { listOf(it.filter, it.searching, it.query) },
            restore = { ListControls(sort, persist).apply { filter = it[0] as String?; searching = it[1] as Boolean; query = it[2] as String } })
    }
    return rememberSaveable(saver = saver) { ListControls(sort, persist) }
}

internal fun repoName(repo: String) = repo.trimEnd('/').substringAfterLast('/')

private enum class HeaderGlyph { Bell, Search, Gear, Filter, Sort, Grid }

/** Outline glyphs: material-icons-core where it has one, the SF Symbol's shape drawn by hand where it does not. */
@Composable private fun GlyphIcon(glyph: HeaderGlyph, tint: Color) {
    when (glyph) {
        HeaderGlyph.Bell -> Icon(Icons.Outlined.Notifications, null, Modifier.size(20.dp), tint)
        HeaderGlyph.Search -> Icon(Icons.Outlined.Search, null, Modifier.size(20.dp), tint)
        HeaderGlyph.Gear -> Icon(Icons.Outlined.Settings, null, Modifier.size(20.dp), tint)
        else -> Canvas(Modifier.size(18.dp)) { drawGlyph(glyph, tint) }
    }
}

private fun DrawScope.drawGlyph(glyph: HeaderGlyph, tint: Color) {
    val u = size.width / 18f
    val width = 1.5f * u
    fun line(x1: Float, y1: Float, x2: Float, y2: Float) =
        drawLine(tint, Offset(x1 * u, y1 * u), Offset(x2 * u, y2 * u), width, StrokeCap.Round)
    when (glyph) {
        HeaderGlyph.Filter -> { line(2f, 4.5f, 16f, 4.5f); line(4.5f, 9f, 13.5f, 9f); line(7f, 13.5f, 11f, 13.5f) }
        HeaderGlyph.Sort -> {
            line(5.5f, 3f, 5.5f, 15f); line(5.5f, 3f, 2.5f, 6f); line(5.5f, 3f, 8.5f, 6f)
            line(12.5f, 3f, 12.5f, 15f); line(12.5f, 15f, 9.5f, 12f); line(12.5f, 15f, 15.5f, 12f)
        }
        HeaderGlyph.Grid -> listOf(2f to 2f, 10f to 2f, 2f to 10f, 10f to 10f).forEach { (x, y) ->
            drawRoundRect(tint, Offset(x * u, y * u), Size(6f * u, 6f * u), CornerRadius(1.5f * u), Stroke(width))
        }
        else -> Unit
    }
}

@Composable private fun HeaderButton(label: String, onClick: () -> Unit, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Box(modifier.defaultMinSize(36.dp, 36.dp).pressable(onClick = onClick).semantics { contentDescription = label },
        contentAlignment = Alignment.Center) { content() }
}

@Composable private fun HeaderMenu(glyph: HeaderGlyph, label: String, tint: Color = Rove.c.muted, content: @Composable ColumnScope.(close: () -> Unit) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        HeaderButton(label, { open = true }) { GlyphIcon(glyph, tint) }
        RoveMenu(open, { open = false }) { content { open = false } }
    }
}

@Composable internal fun RoveMenu(expanded: Boolean, onDismiss: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    DropdownMenu(expanded, onDismiss, containerColor = Rove.c.surface, shape = RoundedCornerShape(Rove.radius),
        tonalElevation = 0.dp, shadowElevation = 6.dp, border = BorderStroke(1.dp, Rove.c.line), content = content)
}

/** Mono menu row; a picker's current choice carries an accent check. */
@Composable internal fun RoveMenuItem(label: String, selected: Boolean? = null, tint: Color = Rove.c.ink, onClick: () -> Unit) {
    DropdownMenuItem({ Text(label, color = tint, style = Rove.mono(14, FontWeight.Medium)) }, onClick,
        trailingIcon = if (selected == true) ({ Icon(Icons.Filled.Check, null, Modifier.size(16.dp), Rove.c.accent) }) else null)
}

/** Trailing controls of the list header, in iOS order. */
@Composable internal fun ListHeaderControls(controls: ListControls, repos: List<String>, unread: Int, onInbox: () -> Unit,
                                            onPage: (Route) -> Unit) {
    // iOS spaces the icons 10 apart; narrower phones give the gap up before the wordmark clips.
    val gap = ((LocalConfiguration.current.screenWidthDp - 364) / 5).coerceIn(0, 10).dp
    Row(horizontalArrangement = Arrangement.spacedBy(gap), verticalAlignment = Alignment.CenterVertically) {
        val tint = if (unread > 0) Rove.c.accent else Rove.c.muted
        HeaderButton(stringResource(R.string.listheader_attention_a11y, unread), onInbox) {
            Row(horizontalArrangement = Arrangement.spacedBy(3.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.width(24.dp), contentAlignment = Alignment.Center) { GlyphIcon(HeaderGlyph.Bell, tint) }
                if (unread > 0) Text("$unread", color = Rove.c.accent, maxLines = 1, style = Rove.mono(13, FontWeight.Bold))
            }
        }
        val filter = controls.filter
        HeaderMenu(HeaderGlyph.Filter, stringResource(R.string.listheader_filter_a11y), if (filter == null) Rove.c.muted else Rove.c.accent) { close ->
            RoveMenuItem(stringResource(R.string.listheader_all_projects), filter == null) { close(); controls.filter = null }
            repos.forEach { repo -> RoveMenuItem(repoName(repo), filter == repo) { close(); controls.filter = repo } }
        }
        HeaderButton(stringResource(R.string.listheader_search_a11y), controls::toggleSearch) {
            GlyphIcon(HeaderGlyph.Search, if (controls.searching) Rove.c.accent else Rove.c.muted)
        }
        val sortLabel = sortLabel(controls.sort)
        HeaderMenu(HeaderGlyph.Sort, stringResource(R.string.listheader_sort_a11y, sortLabel),
            if (controls.sort == TaskSortMode.Attention) Rove.c.muted else Rove.c.accent) { close ->
            TaskSortMode.entries.forEach { mode -> RoveMenuItem(sortLabel(mode), controls.sort == mode) { close(); controls.pick(mode) } }
        }
        HeaderMenu(HeaderGlyph.Grid, stringResource(R.string.listheader_pages_a11y)) { close ->
            RoveMenuItem(stringResource(R.string.listheader_page_board)) { close(); onPage(Route.Board) }
            RoveMenuItem(stringResource(R.string.listheader_page_routines)) { close(); onPage(Route.Routines) }
            RoveMenuItem(stringResource(R.string.listheader_page_issues)) { close(); onPage(Route.Issues) }
            RoveMenuItem(stringResource(R.string.listheader_page_worktrees)) { close(); onPage(Route.Worktrees) }
        }
        HeaderButton(stringResource(R.string.listheader_settings_a11y), { onPage(Route.Settings) }) { GlyphIcon(HeaderGlyph.Gear, Rove.c.muted) }
    }
}

@Composable private fun sortLabel(mode: TaskSortMode) = stringResource(when (mode) {
    TaskSortMode.Attention -> R.string.listheader_sort_attention
    TaskSortMode.Default -> R.string.listheader_sort_default
    TaskSortMode.Recent -> R.string.listheader_sort_recent
    TaskSortMode.Name -> R.string.listheader_sort_name
})

/** Search field under the connection strip: placeholder, `×` clear, focus on open (iOS `searchBar`). */
@Composable internal fun ListSearchBar(controls: ListControls) {
    val focus = remember { FocusRequester() }
    val keyboard = LocalSoftwareKeyboardController.current
    LaunchedEffect(Unit) { focus.requestFocus() }
    val clear = stringResource(R.string.listheader_search_clear)
    Row(Modifier.padding(start = 16.dp, end = 16.dp, bottom = 6.dp).fillMaxWidth().heightIn(min = 44.dp).tile().padding(horizontal = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        BasicTextField(controls.query, { controls.query = it }, Modifier.weight(1f).padding(vertical = 11.dp).focusRequester(focus),
            textStyle = Rove.mono(14).copy(color = Rove.c.ink), singleLine = true, cursorBrush = SolidColor(Rove.c.accent),
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search), keyboardActions = KeyboardActions(onSearch = { keyboard?.hide() }),
            decorationBox = { inner ->
                Box(contentAlignment = Alignment.CenterStart) {
                    if (controls.query.isEmpty()) Text(stringResource(R.string.listheader_search_placeholder), color = Rove.c.muted,
                        style = Rove.mono(14), maxLines = 1)
                    inner()
                }
            })
        if (controls.query.isNotEmpty()) Box(Modifier.defaultMinSize(28.dp, 28.dp).pressable { controls.query = "" }.semantics { contentDescription = clear },
            contentAlignment = Alignment.Center) { Text("×", color = Rove.c.muted, style = Rove.mono(16)) }
    }
}
