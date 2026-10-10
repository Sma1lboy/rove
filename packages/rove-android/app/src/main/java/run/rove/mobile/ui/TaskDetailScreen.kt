package run.rove.mobile.ui

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.CancellationException
import run.rove.mobile.data.*
import run.rove.mobile.domain.*

@Composable fun TaskDetailScreen(model: AppModel, taskId: String, back: () -> Unit) {
    val connection by model.bridge.state.collectAsStateWithLifecycle()
    val taskSnapshot by model.tasks.collectAsStateWithLifecycle()
    val task = taskSnapshot.tasks.firstOrNull { it.id == taskId }
    var tabs by remember(taskId) { mutableStateOf<List<TabRow>>(emptyList()) }
    var selected by remember(taskId) { mutableStateOf<String?>(null) }
    var newTab by remember { mutableStateOf(false) }
    var revision by remember { mutableIntStateOf(0) }
    var diff by remember(taskId) { mutableStateOf(false) }
    var action by remember { mutableStateOf<String?>(null) }
    var confirmation by remember { mutableIntStateOf(0) }
    var busy by remember { mutableStateOf(false) }
    LaunchedEffect(taskId, connection, revision) {
        if (connection is Connection.Connected) {
            try {
                tabs = model.repository.tabs(taskId)
                if (selected !in tabs.map { it.id }) selected = tabs.firstOrNull()?.id
            } catch (e: CancellationException) { throw e }
            catch (_: Exception) { model.error.value = "Could not load terminal tabs" }
        }
    }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            TextButton(onClick = back) { Text("‹ tasks") }
            TextButton(onClick = { diff = !diff }) { Text(if (diff) "terminal" else "diff") }
            TextButton(onClick = { newTab = true }, enabled = connection is Connection.Connected) { Text("+ tab") }
        }
        Text(task?.displayTitle ?: taskId, Modifier.padding(horizontal = 16.dp, vertical = 8.dp), style = MaterialTheme.typography.titleMedium)
        Row(Modifier.horizontalScroll(rememberScrollState())) {
            TextButton(onClick = { action = "land"; confirmation = 1 }, enabled = connection is Connection.Connected) { Text("land") }
            TextButton(onClick = { action = "delete"; confirmation = 1 }, enabled = connection is Connection.Connected) { Text("delete task") }
            TextButton(onClick = { revision++ }) { Text("refresh tabs") }
        }
        if (diff) DiffScreen(model, taskId)
        else {
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                tabs.forEach { tab -> FilterChip(selected = selected == tab.id, onClick = { selected = tab.id }, label = { Text(tab.displayTitle) }) }
            }
            if (selected != null) key(taskId, selected) { TerminalView(model.bridge, taskId, selected!!) }
            else Text("No terminal tabs. Start one with + tab.", Modifier.padding(16.dp))
        }
    }
    if (newTab) CreateSheet(model, taskId, { newTab = false }, { newTab = false; selected = it; revision++ })
    if (action != null) AlertDialog(
        onDismissRequest = { if (!busy) action = null },
        title = { Text(if (confirmation == 1) "${action} task?" else "Confirm ${action}") },
        text = { Text(if (confirmation == 1) "${task?.displayTitle ?: taskId}\n${task?.branch.orEmpty()}" else
            if (action == "delete") "Remove this task and its managed worktree. The branch is kept. Dirty work is refused."
            else "Merge this task's branch into its base on the Mac. This changes the repository.") },
        dismissButton = { TextButton(onClick = { action = null }, enabled = !busy) { Text("cancel") } },
        confirmButton = { TextButton(enabled = !busy, onClick = {
            if (confirmation == 1) confirmation = 2
            else {
                busy = true
                val delete = action == "delete"
                model.action {
                    try {
                        if (delete) model.repository.delete(taskId) else model.repository.land(taskId)
                        action = null; model.refresh(); back()
                    } finally { busy = false }
                }
            }
        }) { Text(if (busy) "working…" else if (confirmation == 1) "continue" else "confirm ${action}") } },
    )
}
