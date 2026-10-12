package run.rove.mobile.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.Icon
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import run.rove.mobile.R
import run.rove.mobile.data.BoardPrefs
import run.rove.mobile.domain.*

private const val GROUP_WAITING = "waiting-on-you"

/** iOS `BoardView`: the Kanban board, one project at a time, four columns, one column's cards on screen (phone layout). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable fun BoardScreen(model: AppModel, back: () -> Unit, open: (Route) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val fallback = stringResource(R.string.board_request_failed)
    val board = remember { BoardModel(model.repository, BoardPrefs(context), scope, fallback) }
    val feed by model.tasks.collectAsStateWithLifecycle()
    // The user's column choice; null follows the default (in progress when it has cards).
    var column by remember { mutableStateOf<BoardColumn?>(null) }
    var drawer by remember { mutableStateOf<Story?>(null) }
    var showNew by remember { mutableStateOf(false) }
    var refreshing by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) { while (true) { board.refresh(); delay(5000) } }

    // Cards whose task needs a person float to the head of IN PROGRESS; `count` counts them.
    val byId = remember(feed.tasks) { feed.tasks.associateBy { it.id } }
    val data = remember(board.issues, byId) {
        board.issues?.let { issues ->
            // An empty feed has not loaded yet, so the link alone decides.
            val exists = if (byId.isEmpty()) null else { id: String -> id in byId }
            BoardLogic.floatingAttention(BoardLogic.columns(issues.issues, exists)) { byId[it]?.group == GROUP_WAITING }
        }
    }
    val attention = data?.count ?: 0

    /** A session was started from the drawer: follow it, or stay and say so for a moment. */
    fun started(outcome: StartOutcome) {
        board.warnings = board.warnings + outcome.warnings
        column = BoardColumn.InProgress
        scope.launch { board.reload() }
        model.refresh()
        if (outcome.follow) open(Route.Task(outcome.openTaskId)) else board.flash(outcome.storyId)
    }

    Column(Modifier.fillMaxSize().background(Rove.c.paper)) {
        ScreenHeader(back = back, trailing = { NewStoryButton(board.repo.isNotEmpty()) { showNew = true } }) {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(stringResource(R.string.board_header), Modifier.alignByBaseline(), color = Rove.c.ink, style = Rove.face(16, FontWeight.SemiBold))
                if (attention > 0) Text(stringResource(R.string.board_need_you, attention), Modifier.alignByBaseline(), color = Rove.c.accent,
                    maxLines = 1, style = Rove.mono(12, FontWeight.Bold))
            }
        }
        PullToRefreshBox(refreshing, {
            scope.launch { refreshing = true; try { board.refresh(force = true) } finally { refreshing = false } }
        }, Modifier.weight(1f)) {
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 6.dp, bottom = 24.dp)) {
                boardContent(board, data?.columns, column, { column = it }, byId::get, { drawer = it },
                    { path -> column = null; scope.launch { board.select(path) } })
            }
        }
    }

    if (showNew) NewStorySheet(model, board.repo, dismiss = { showNew = false },
        created = { column = BoardColumn.Backlog; scope.launch { board.reload() } })
    drawer?.let { story ->
        key(story.id) {
            StoryDrawer(model, board.repo, story, open, dismiss = { drawer = null }, onChanged = { board.reload() }, onStarted = ::started)
        }
    }
}

@Composable private fun NewStoryButton(enabled: Boolean, onClick: () -> Unit) {
    val label = stringResource(R.string.board_new_story_a11y)
    Box(Modifier.size(36.dp).pressable(enabled, onClick).semantics { contentDescription = label }, contentAlignment = Alignment.Center) {
        Icon(Icons.Default.Add, null, Modifier.size(22.dp), tint = if (enabled) Rove.c.muted else Rove.c.line)
    }
}

/** One structural row with the board's 14-point rhythm. */
private fun LazyListScope.block(key: String, content: @Composable () -> Unit) {
    item(key = key) { Box(Modifier.fillMaxWidth().padding(bottom = 14.dp)) { content() } }
}

@Composable private fun LoadingLine() {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        BrailleSpinner(13)
        Text(stringResource(R.string.board_loading), color = Rove.c.muted, style = Rove.mono(13))
    }
}

private fun LazyListScope.boardContent(board: BoardModel, columns: List<BoardColumnData>?, picked: BoardColumn?,
                                       pick: (BoardColumn) -> Unit, task: (String) -> TaskRow?, openStory: (Story) -> Unit,
                                       selectProject: (String) -> Unit) {
    val error = board.error
    if (!board.projectsLoaded) {
        block("loading") { if (error != null) ErrorLine(error) else LoadingLine() }
        return
    }
    if (board.projects.isEmpty()) {
        if (error != null) block("error") { ErrorLine(error) }
        block("no-projects") { EmptyState(stringResource(R.string.board_no_projects), stringResource(R.string.board_no_projects_hint)) }
        return
    }
    block("projects") {
        val labels = BoardCardLogic.projectLabels(board.projects)
        BoardTiles(board.projects, board.repo, { labels[it] ?: it }, selectProject)
    }
    board.notice?.let { id ->
        block("notice") { Text(stringResource(R.string.board_started_notice, id), color = Rove.c.muted, style = Rove.mono(12)) }
    }
    if (board.warnings.isNotEmpty()) block("warnings") {
        Column(Modifier.pressable { board.warnings = emptyList() }, verticalArrangement = Arrangement.spacedBy(4.dp)) {
            board.warnings.forEach {
                ErrorLine(stringResource(if (it.step == StartStep.Link) R.string.board_warn_link else R.string.board_warn_mark, it.storyId, it.reason))
            }
            Kicker(stringResource(R.string.board_dismiss))
        }
    }
    if (error != null) block("error") { ErrorLine(error) }
    val issues = board.issues
    if (issues == null || columns == null) {
        if (error == null) block("loading") { LoadingLine() }
        return
    }
    if (issues.skipped > 0) block("skipped") { ErrorLine(pluralStringResource(R.plurals.board_skipped, issues.skipped, issues.skipped)) }
    if (issues.issues.isEmpty()) {
        block("no-stories") { EmptyState(stringResource(R.string.board_no_stories), stringResource(R.string.board_no_stories_hint)) }
        return
    }
    val key = picked ?: BoardCardLogic.defaultColumn(columns)
    block("columns") { BoardColumnTabs(columns, key, pick) }
    columns.firstOrNull { it.key == key }?.let { boardColumnItems(it, task, openStory) }
}
