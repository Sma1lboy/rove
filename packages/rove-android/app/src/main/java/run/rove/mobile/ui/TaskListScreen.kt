package run.rove.mobile.ui

import androidx.compose.foundation.BorderStroke
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
import kotlinx.coroutines.delay
import run.rove.mobile.R
import run.rove.mobile.data.Connection
import run.rove.mobile.domain.*
import java.util.Locale

// iOS Tasks/TaskListView.swift. The bell, filter, search, sort, pages and settings icons and the per-project `···` menu
// lead to pages outside this client, so only the overflow menu remains in the header.

private class Clock(var receipts: Map<String, Receipt> = emptyMap())

private fun two(n: Int) = String.format(Locale.ROOT, "%02d", n)

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun TaskListScreen(tasks: Tasks, host: String, connection: Connection, demo: Boolean, onSelect: (String) -> Unit,
                               onRefresh: () -> Unit, onCreate: () -> Unit, onDisconnect: () -> Unit, onNotify: () -> Unit,
                               onRepair: () -> Unit) {
    val sections = remember(tasks.tasks) { TaskOrdering.sections(tasks.tasks) }
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
        ScreenHeader(trailing = { OverflowMenu(demo, onRefresh, onNotify, onDisconnect) }) { Wordmark(19) }
        ConnectionStrip(host, connection, tasks.tasks.size)
        PullToRefreshBox(refreshing, { refreshing = true; onRefresh() }, Modifier.weight(1f), state = pull,
            indicator = {
                PullToRefreshDefaults.Indicator(pull, refreshing, Modifier.align(Alignment.TopCenter),
                    containerColor = Rove.c.surface, color = Rove.c.accent)
            }) {
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 16.dp)) {
                sections.forEach { section ->
                    item(key = "repo:${section.repo}") { SectionHeader(section) }
                    items(section.rows, key = { it.id }) { row ->
                        Box(Modifier.padding(horizontal = 8.dp)) {
                            TaskRowView(row, receipts.getValue(row.id), now) { onSelect(row.id) }
                        }
                    }
                }
                if (tasks.tasks.isEmpty()) item(key = "empty") {
                    if (connection is Connection.Connected) Welcome() else Loading(connection, onRepair)
                }
            }
        }
        NewTaskBar(onCreate)
    }
}

@Composable private fun connectionWord(connection: Connection): String = when (connection) {
    is Connection.Connected -> stringResource(R.string.list_connected)
    Connection.Connecting -> stringResource(R.string.list_connecting)
    is Connection.Retrying -> stringResource(R.string.list_reconnecting, connection.attempt)
    Connection.Disconnected -> stringResource(R.string.list_offline)
    is Connection.Failed -> stringResource(R.string.list_failed)
}

/** `HOST · CONNECTED` at rest; accent while reconnecting, error red when the link failed. */
@Composable private fun ConnectionStrip(host: String, connection: Connection, shown: Int) {
    val tone = when (connection) {
        is Connection.Connected -> Rove.c.muted
        is Connection.Failed -> Rove.c.error
        else -> Rove.c.accent
    }
    Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, bottom = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Kicker(listOf(host, connectionWord(connection)).filter { it.isNotEmpty() }.joinToString(" · "), Modifier.weight(1f), tone)
        Kicker(stringResource(R.string.list_tasks_count, two(shown)))
    }
}

@Composable private fun SectionHeader(section: TaskSection) {
    Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, top = 18.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Kicker(section.name, Modifier.weight(1f))
        Text(two(section.rows.size), color = Rove.c.muted, maxLines = 1, style = Rove.mono(11))
    }
}

@Composable private fun OverflowMenu(demo: Boolean, onRefresh: () -> Unit, onNotify: () -> Unit, onDisconnect: () -> Unit) {
    var open by remember { mutableStateOf(false) }
    val more = stringResource(R.string.list_more)
    Box {
        Box(Modifier.size(36.dp).pressable { open = true }.semantics { contentDescription = more }, contentAlignment = Alignment.Center) {
            Text("···", color = Rove.c.muted, style = Rove.mono(14, FontWeight.Bold))
        }
        DropdownMenu(open, { open = false }, containerColor = Rove.c.surface, shape = RoundedCornerShape(Rove.radius),
            tonalElevation = 0.dp, shadowElevation = 6.dp, border = BorderStroke(1.dp, Rove.c.line)) {
            MenuItem(stringResource(R.string.list_refresh)) { open = false; onRefresh() }
            MenuItem(stringResource(R.string.list_notifications)) { open = false; onNotify() }
            // Demo has no Mac to disconnect from; the strip above offers "connect a mac" instead.
            if (!demo) MenuItem(stringResource(R.string.list_disconnect)) { open = false; onDisconnect() }
        }
    }
}

@Composable private fun MenuItem(label: String, onClick: () -> Unit) {
    DropdownMenuItem({ Text(label, color = Rove.c.ink, style = Rove.mono(14, FontWeight.Medium)) }, onClick)
}

/** Daemon has no tasks at all (iOS `TaskWelcomeView`, without its engines line). */
@Composable private fun Welcome() {
    Column(Modifier.padding(horizontal = 16.dp).padding(top = 20.dp).fillMaxWidth().tile(radius = 14.dp).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Kicker(stringResource(R.string.list_welcome), color = Rove.c.accent)
        EmptyState(stringResource(R.string.list_welcome_body), stringResource(R.string.list_welcome_hint))
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
