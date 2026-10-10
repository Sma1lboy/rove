package run.rove.mobile.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import run.rove.mobile.domain.*

@Composable fun TaskListScreen(tasks: Tasks, onSelect: (String) -> Unit, onRefresh: () -> Unit,
                               onCreate: () -> Unit, onDisconnect: () -> Unit, onNotify: () -> Unit) {
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), horizontalArrangement = Arrangement.SpaceBetween) {
            Wordmark(20.sp, Modifier.padding(vertical = 16.dp))
            TextButton(onClick = onCreate) { Text("+ task") }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
            TextButton(onClick = onRefresh) { Text("refresh") }
            TextButton(onClick = onNotify) { Text("notifications") }
            TextButton(onClick = onDisconnect) { Text("disconnect") }
        }
        Text("TASKS · ${tasks.tasks.size}   INBOX · ${tasks.attention.count { it.unread }}",
            Modifier.padding(16.dp), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (tasks.tasks.isEmpty()) Text("No tasks yet. Start one with + task.", Modifier.padding(24.dp))
        LazyColumn(contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(tasks.tasks, key = { it.id }) { task ->
                Surface(shape = MaterialTheme.shapes.small, color = MaterialTheme.colorScheme.surface,
                    modifier = Modifier.fillMaxWidth().clickable { onSelect(task.id) }) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(TaskOrdering.group(task.group).uppercase(), style = MaterialTheme.typography.labelMedium,
                            color = if (task.group == "waiting-on-you") MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(task.displayTitle, style = MaterialTheme.typography.titleMedium)
                        Text(task.repo.substringAfterLast('/') + " · " + (task.engine?.name ?: "no engine"), style = MaterialTheme.typography.bodySmall)
                        Text(task.branch, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
    }
}
