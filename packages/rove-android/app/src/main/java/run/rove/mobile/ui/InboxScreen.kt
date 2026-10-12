package run.rove.mobile.ui

import android.app.Application
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.pulltorefresh.PullToRefreshDefaults
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import run.rove.mobile.R
import run.rove.mobile.data.InboxVisits
import run.rove.mobile.data.dismissAttention
import run.rove.mobile.domain.*
import java.util.Locale

// iOS Inbox/InboxView.swift + InboxState.swift: ATTENTION (blocked first, oldest first) and RECENT (the last tabs this phone opened).

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun InboxScreen(model: AppModel, back: () -> Unit, open: (Route) -> Unit) {
    val tasks by model.tasks.collectAsState()
    val visitLog = remember { InboxVisits(model.getApplication<Application>()) }
    var visits by remember { mutableStateOf(visitLog.load()) }
    var lastJumpKey by rememberSaveable { mutableStateOf<String?>(null) }
    val pending = remember(tasks) { InboxLogic.sorted(tasks.attention, tasks.tasks.map { it.id }) }
    val recent = remember(tasks, visits) { InboxLogic.recent(visits, tasks.attention, tasks.tasks.mapTo(HashSet()) { it.id }) }
    val now by produceState(System.currentTimeMillis()) { while (true) { delay(30_000); value = System.currentTimeMillis() } }
    val tabInfo by produceState(emptyMap<String, RecentTab>(), recent) { value = loadTabInfo(model, recent) }
    val titles = remember(tasks) { tasks.tasks.associate { it.id to it.displayTitle } }

    // A task-level episode leaves the task's current tab; a routine one has no task and opens the Routines page.
    fun openItem(item: Attention) {
        lastJumpKey = InboxLogic.key(item)
        val taskId = item.taskId ?: return open(Route.Routines)
        visits = visitLog.record(taskId, item.tabId)
        model.action { model.repository.dismissAttention(taskId, item.tabId); model.refresh() }
        open(Route.Task(taskId, item.tabId))
    }

    var refreshing by remember { mutableStateOf(false) }
    LaunchedEffect(refreshing) { if (refreshing) { delay(1500); refreshing = false } }
    LaunchedEffect(tasks) { refreshing = false }
    val pull = rememberPullToRefreshState()
    val unknownRoutine = stringResource(R.string.inbox_routine)

    Column(Modifier.fillMaxSize().background(Rove.c.paper)) {
        ScreenHeader(back, trailing = {
            if (InboxLogic.next(null, pending) != null) {
                TileLabel(stringResource(R.string.inbox_next_pending), tint = Rove.c.accent, size = 12) {
                    InboxLogic.next(lastJumpKey, pending)?.let(::openItem)
                }
            }
        }) { Text(stringResource(R.string.inbox_title), color = Rove.c.ink, style = Rove.face(16, FontWeight.SemiBold)) }
        PullToRefreshBox(refreshing, { refreshing = true; model.refresh() }, Modifier.weight(1f), state = pull,
            indicator = {
                PullToRefreshDefaults.Indicator(pull, refreshing, Modifier.align(Alignment.TopCenter),
                    containerColor = Rove.c.surface, color = Rove.c.accent)
            }) {
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp)) {
                item(key = "h:attention") { SectionHeader(stringResource(R.string.inbox_attention), pending.size) }
                if (pending.isEmpty()) item(key = "e:attention") {
                    EmptyState(stringResource(R.string.inbox_attention_empty), stringResource(R.string.inbox_attention_empty_detail),
                        Modifier.padding(horizontal = 20.dp, vertical = 8.dp))
                }
                items(pending, key = { "a:" + InboxLogic.key(it) }) { item ->
                    val title = item.taskId?.let { titles[it] } ?: item.label ?: item.taskId ?: unknownRoutine
                    AttentionRow(item, title, now, { openItem(item) }) {
                        item.taskId?.let { id ->
                            model.action { model.repository.dismissAttention(id, item.tabId); model.refresh() }
                        }
                    }
                }
                item(key = "h:recent") { SectionHeader(stringResource(R.string.inbox_recent), recent.size) }
                if (recent.isEmpty()) item(key = "e:recent") {
                    EmptyState(stringResource(R.string.inbox_recent_empty), stringResource(R.string.inbox_recent_empty_detail),
                        Modifier.padding(horizontal = 20.dp, vertical = 8.dp))
                }
                items(recent, key = { "r:" + InboxLogic.visitKey(it.taskId, it.tabId) }) { visit ->
                    val info = tabInfo[InboxLogic.visitKey(visit.taskId, visit.tabId)]
                    RecentRow(titles[visit.taskId] ?: visit.taskId, info ?: visit.tabId?.let { RecentTab(it, false) }, now - visit.at) {
                        open(Route.Task(visit.taskId, visit.tabId))
                    }
                }
            }
        }
    }
}

@Composable private fun SectionHeader(name: String, count: Int) {
    Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, top = 18.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Kicker(name, Modifier.weight(1f))
        Text(String.format(Locale.ROOT, "%02d", count), color = Rove.c.muted, maxLines = 1, style = Rove.mono(11))
    }
}

@Composable private fun stateWord(state: String) = when (state) {
    "permission_needed" -> stringResource(R.string.inbox_state_permission)
    "rate_limited" -> stringResource(R.string.inbox_state_rate_limit)
    "error" -> stringResource(R.string.inbox_state_error)
    "dead" -> stringResource(R.string.inbox_state_exited)
    "turn_complete" -> stringResource(R.string.inbox_state_done)
    "routine_failed" -> stringResource(R.string.inbox_state_routine_failed)
    "routine_responded" -> stringResource(R.string.inbox_state_routine_replied)
    else -> state.replace('_', ' ')
}

@Composable private fun AttentionRow(item: Attention, title: String, now: Long, onOpen: () -> Unit, onDismiss: () -> Unit) {
    val tone = when { item.state == "error" -> Rove.c.error; InboxLogic.isBlocking(item) -> Rove.c.accent; else -> Rove.c.muted }
    val resume = if (item.state == "rate_limited") InboxLogic.resumeTime(item.resumeAt) else null
    Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f).pressable(onClick = onOpen).padding(horizontal = 12.dp, vertical = 10.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(InboxLogic.glyph(item.state), color = tone, style = Rove.mono(12, FontWeight.SemiBold))
                Text(stateWord(item.state), color = tone, style = Rove.mono(11, FontWeight.SemiBold))
                if (resume != null) Text(stringResource(R.string.inbox_resumes, resume), color = Rove.c.muted, style = Rove.mono(11))
            }
            Text(title, color = Rove.c.ink, style = Rove.face(16, FontWeight.Medium), maxLines = 1, overflow = TextOverflow.Ellipsis)
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                item.tabId?.let { Text(it, color = Rove.c.muted, style = Rove.mono(12)) }
                Text(TaskAge.label(now - item.at), color = Rove.c.muted, style = Rove.mono(12))
            }
        }
        if (item.taskId != null) {
            val label = stringResource(R.string.inbox_dismiss_label)
            Box(Modifier.heightIn(min = 44.dp).pressable(onClick = onDismiss).padding(horizontal = 10.dp).semantics { contentDescription = label },
                contentAlignment = Alignment.Center) {
                Text(stringResource(R.string.inbox_dismiss), color = Rove.c.muted, style = Rove.mono(12))
            }
        }
    }
}

@Composable private fun RecentRow(title: String, tab: RecentTab?, ageMs: Double, onOpen: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp).pressable(onClick = onOpen).padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        if (tab?.running == true) BrailleSpinner(12)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(title, color = Rove.c.ink, style = Rove.face(16, FontWeight.Medium), maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (tab != null) Text(tab.title.lowercase(), color = Rove.c.muted, style = Rove.mono(12), maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Text(TaskAge.label(ageMs), color = Rove.c.muted, style = Rove.mono(12))
    }
}

/** Tab names and which of them are still running, for the RECENT rows. */
private suspend fun loadTabInfo(model: AppModel, visits: List<Visit>): Map<String, RecentTab> {
    val info = HashMap<String, RecentTab>()
    for (taskId in visits.map { it.taskId }.toSet()) {
        try {
            val tabs = model.repository.tabs(taskId)
            val states = model.repository.tabStates(taskId)
            tabs.forEach { info[InboxLogic.visitKey(taskId, it.id)] = RecentTab(it.displayTitle, states[it.id] == "running") }
        } catch (e: CancellationException) { throw e } catch (_: Exception) { }
    }
    return info
}
