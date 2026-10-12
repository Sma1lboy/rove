package run.rove.mobile.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.pulltorefresh.PullToRefreshDefaults
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.delay
import run.rove.mobile.R
import run.rove.mobile.data.Connection
import run.rove.mobile.data.moveTask
import run.rove.mobile.data.tabTitles
import run.rove.mobile.domain.*
import java.util.Locale

// iOS Tasks/TaskListView.swift.

private class Clock(var receipts: Map<String, Receipt> = emptyMap())

private fun two(n: Int) = String.format(Locale.ROOT, "%02d", n)

/** Everything the list can ask of its parent or the bridge; the defaults make a static preview. */
internal data class ListActions(
    val onSelect: (String) -> Unit = {},
    val onRefresh: () -> Unit = {},
    val onCreate: () -> Unit = {},
    val onInbox: () -> Unit = {},
    val onPage: (Route) -> Unit = {},
    val onRepair: () -> Unit = {},
    val onMove: (taskId: String, direction: String) -> Unit = { _, _ -> },
    val onProject: (ProjectRequest) -> Unit = {},
)

@Composable fun TaskListScreen(model: AppModel, onSelect: (String) -> Unit, onCreate: () -> Unit, open: (Route) -> Unit) {
    val tasks by model.tasks.collectAsStateWithLifecycle()
    val host by model.host.collectAsStateWithLifecycle()
    val engines by model.engines.collectAsStateWithLifecycle()
    val connection by model.bridge.state.collectAsStateWithLifecycle()
    val controls = rememberListControls()
    var tabTitles by remember { mutableStateOf<Map<String, List<String>>>(emptyMap()) }
    // Task rows do not carry tab titles; they are read once when the search opens.
    LaunchedEffect(controls.searching) {
        if (controls.searching) tabTitles = model.repository.tabTitles(tasks.tasks.map { it.id })
    }
    var request by remember { mutableStateOf<ProjectRequest?>(null) }
    val actions = ListActions(onSelect, model::refresh, onCreate, { open(Route.Inbox) }, open, model::unpair,
        { id, direction -> model.action { model.repository.moveTask(id, direction); model.refresh() } }, { request = it })
    TaskListContent(tasks, host, connection, engines, controls, tabTitles, actions)
    ProjectSheets(model, request) { request = it }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable internal fun TaskListContent(tasks: Tasks, host: String, connection: Connection, engines: List<Engine>,
                                         controls: ListControls, tabTitles: Map<String, List<String>>, actions: ListActions) {
    val repos = remember(tasks.tasks) { TaskListLogic.repos(tasks.tasks) }
    // A filter whose project disappeared (forgotten, say) stops filtering, as iOS clears it.
    val filter = controls.filter?.takeIf { it in repos }
    LaunchedEffect(repos) { if (controls.filter != null && filter == null) controls.filter = null }
    val query = if (controls.searching) controls.query else ""
    val sections = remember(tasks.tasks, filter, controls.sort, query, tabTitles) {
        TaskListLogic.projects(TaskListLogic.filtered(tasks.tasks, filter), controls.sort, query, if (query.isEmpty()) emptyMap() else tabTitles)
    }
    val shown = sections.sumOf { it.rows.size }
    val loaded = tasks.tasks.isNotEmpty() || connection is Connection.Connected
    val clock = remember { Clock() }
    val receipts = remember(tasks.tasks) {
        TaskAge.receipts(clock.receipts, tasks.tasks, System.currentTimeMillis()).also { clock.receipts = it }
    }
    // The first frame reads the receipt instant itself, so a fresh snapshot shows the server's `forMs` untouched.
    val now = produceState(receipts.values.maxOfOrNull { it.atMs } ?: 0L) {
        while (true) { delay(1000); value = System.currentTimeMillis() }
    }
    var refreshing by remember { mutableStateOf(false) }
    LaunchedEffect(refreshing) { if (refreshing) { delay(1500); refreshing = false } }
    LaunchedEffect(tasks) { refreshing = false }
    val pull = rememberPullToRefreshState()
    Column(Modifier.fillMaxSize().background(Rove.c.paper)) {
        ScreenHeader(trailing = {
            ListHeaderControls(controls, repos, TaskListLogic.attentionCount(tasks.attention), actions.onInbox, actions.onPage)
        }) { Wordmark(19) }
        ConnectionStrip(host, connection, shown, filter) { controls.filter = null }
        if (controls.searching) ListSearchBar(controls)
        PullToRefreshBox(refreshing, { refreshing = true; actions.onRefresh() }, Modifier.weight(1f), state = pull,
            indicator = {
                PullToRefreshDefaults.Indicator(pull, refreshing, Modifier.align(Alignment.TopCenter),
                    containerColor = Rove.c.surface, color = Rove.c.accent)
            }) {
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 16.dp)) {
                sections.forEach { section ->
                    val mainTaskId = tasks.tasks.firstOrNull { it.repo == section.repo && it.kind == "main" }?.id
                    item(key = "repo:${section.repo}") { SectionHeader(section, mainTaskId, actions) }
                    items(section.rows, key = { it.id }) { row ->
                        Box(Modifier.padding(horizontal = 8.dp)) {
                            TaskRowView(row, receipts.getValue(row.id), now) { actions.onSelect(row.id) }
                        }
                    }
                }
                when (TaskListLogic.emptiness(loaded, tasks.tasks.size, shown)) {
                    TaskListEmpty.None -> Unit
                    TaskListEmpty.Welcome -> item(key = "welcome") { Welcome(engines) }
                    TaskListEmpty.NoMatches -> item(key = "noMatches") { NoMatches(controls.query.trim()) }
                }
                if (!loaded) item(key = "loading") { Loading(connection, actions.onRepair) }
            }
        }
        NewTaskBar(actions.onCreate)
    }
}

@Composable private fun connectionWord(connection: Connection): String = when (connection) {
    is Connection.Connected -> stringResource(R.string.list_connected)
    Connection.Connecting -> stringResource(R.string.list_connecting)
    is Connection.Retrying -> stringResource(R.string.list_reconnecting, connection.attempt)
    Connection.Disconnected -> stringResource(R.string.list_offline)
    is Connection.Failed -> stringResource(R.string.list_failed)
}

/** `HOST · CONNECTED` at rest; accent while reconnecting, error red when the link failed. A project filter shows as `<repo> ×`. */
@Composable private fun ConnectionStrip(host: String, connection: Connection, shown: Int, filter: String?, onClearFilter: () -> Unit) {
    val tone = when (connection) {
        is Connection.Connected -> Rove.c.muted
        is Connection.Failed -> Rove.c.error
        else -> Rove.c.accent
    }
    Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, bottom = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Kicker(listOf(host, connectionWord(connection)).filter { it.isNotEmpty() }.joinToString(" · "), Modifier.weight(1f), tone)
        if (filter != null) Kicker("${repoName(filter)} ×", Modifier.pressable(onClick = onClearFilter), Rove.c.accent)
        else Kicker(stringResource(R.string.list_tasks_count, two(shown)))
    }
}

@Composable private fun SectionHeader(section: TaskSection, mainTaskId: String?, actions: ListActions) {
    Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 12.dp, top = 18.dp, bottom = 2.dp), verticalAlignment = Alignment.CenterVertically) {
        Kicker(section.name, Modifier.weight(1f))
        Text(two(section.rows.size), color = Rove.c.muted, maxLines = 1, style = Rove.mono(11))
        ProjectMenu(mainTaskId, actions.onMove, actions.onProject, section.repo)
    }
}

/** Tasks exist, but the project filter / search hides every one. */
@Composable private fun NoMatches(query: String) {
    EmptyState(stringResource(R.string.listheader_no_matches),
        if (query.isEmpty()) stringResource(R.string.listheader_no_matches_filter) else stringResource(R.string.listheader_no_matches_search, query),
        Modifier.padding(horizontal = 20.dp).padding(top = 28.dp))
}

/** Daemon has no tasks at all (iOS `TaskWelcomeView`). The model carries no `ready` flag, so every engine counts as usable. */
@Composable private fun Welcome(engines: List<Engine>) {
    Column(Modifier.padding(horizontal = 16.dp).padding(top = 20.dp).fillMaxWidth().tile(radius = 14.dp).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Kicker(stringResource(R.string.list_welcome), color = Rove.c.accent)
        Text(stringResource(R.string.list_welcome_body), color = Rove.c.ink, style = Rove.mono(13))
        if (engines.isNotEmpty()) Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Kicker(stringResource(R.string.listheader_engines))
            Text(engines.joinToString(" ") { "[ ${it.name.lowercase()} ]" }, color = Rove.c.ink, style = Rove.mono(13, FontWeight.Medium))
        }
        Text(stringResource(R.string.list_welcome_hint), color = Rove.c.muted, style = Rove.mono(12))
    }
}

/** Nothing loaded yet: spinner and the link state; a failed link stops reconnecting, so it offers pairing again. */
@Composable private fun Loading(connection: Connection, onRepair: () -> Unit) {
    Column(Modifier.padding(horizontal = 20.dp).padding(top = 24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            BrailleSpinner(13)
            Text(if (connection is Connection.Failed) connection.reason.lowercase() else connectionWord(connection),
                color = Rove.c.muted, style = Rove.mono(13))
        }
        if (connection is Connection.Failed) TileLabel(stringResource(R.string.list_pair_again), onClick = onRepair)
    }
}

/** Full-width pressable bar: `+ new task` left, the `WORKTREE` kicker right (iOS `newTaskBar`). */
@Composable private fun NewTaskBar(onCreate: () -> Unit) {
    val label = stringResource(R.string.list_new_task_a11y)
    val shape = RoundedCornerShape(14.dp)
    Box(Modifier.fillMaxWidth().background(Rove.c.paper).padding(horizontal = 16.dp, vertical = 8.dp)) {
        Row(Modifier.fillMaxWidth().height(56.dp).shadow(6.dp, shape, ambientColor = Rove.shadow, spotColor = Rove.shadow)
            .clip(shape).pressable(onClick = onCreate).tile(radius = 14.dp).padding(horizontal = 18.dp)
            .semantics(mergeDescendants = true) { contentDescription = label },
            horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(R.string.list_new_task_plus), color = Rove.c.accent, style = Rove.mono(20, FontWeight.Medium))
            Text(stringResource(R.string.list_new_task), Modifier.weight(1f), color = Rove.c.ink, maxLines = 1,
                style = Rove.mono(16, FontWeight.Medium))
            Kicker(stringResource(R.string.list_new_task_kind))
        }
    }
}
