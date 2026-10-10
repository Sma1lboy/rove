package run.rove.mobile.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import run.rove.mobile.domain.*

@Composable fun TaskListScreen(tasks: Tasks, demo: Boolean, onSelect: (String) -> Unit, onRefresh: () -> Unit,
                               onCreate: () -> Unit, onDisconnect: () -> Unit, onNotify: () -> Unit) {
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically) {
            Wordmark(20.sp, Modifier.padding(vertical = 16.dp))
            TextButton(onClick = onCreate) { Text("+ task") }
        }
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            HeaderAction("refresh", onRefresh)
            HeaderAction("notifications", onNotify)
            // Demo has no Mac to disconnect from; the banner above offers "connect a mac" instead.
            if (!demo) HeaderAction("disconnect", onDisconnect)
        }
        Text("TASKS · ${tasks.tasks.size}   INBOX · ${tasks.attention.count { it.unread }}",
            Modifier.padding(16.dp), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (tasks.tasks.isEmpty()) Text("No tasks yet. Start one with + task.", Modifier.padding(24.dp))
        LazyColumn(contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(tasks.tasks, key = { it.id }) { task ->
                Surface(shape = MaterialTheme.shapes.small, color = MaterialTheme.colorScheme.surface,
                    modifier = Modifier.fillMaxWidth().clickable { onSelect(task.id) }) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        val group = TaskOrdering.group(task.group)
                        if (group != "unknown") Text(group.uppercase(), style = MaterialTheme.typography.labelMedium,
                            color = groupTone(group), fontWeight = if (group == "waiting-on-you") FontWeight.Bold else FontWeight.Medium)
                        Text(task.displayTitle, style = MaterialTheme.typography.titleMedium)
                        Text(task.repo.substringAfterLast('/') + " · " + (task.engine?.name ?: "no engine"), style = MaterialTheme.typography.bodySmall)
                        Text(task.branch, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
    }
}

@Composable private fun HeaderAction(label: String, onClick: () -> Unit) {
    OutlinedButton(onClick = onClick, shape = MaterialTheme.shapes.small,
        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp), modifier = Modifier.heightIn(min = 36.dp)) {
        Text(label, style = MaterialTheme.typography.labelMedium)
    }
}

/** iOS `TaskGroup.tone`: accent only for what needs a person; error red is never a group colour. */
@Composable private fun groupTone(group: String): Color = when (group) {
    "waiting-on-you" -> MaterialTheme.colorScheme.primary
    "landing" -> MaterialTheme.colorScheme.tertiary
    "ready-for-review", "working" -> MaterialTheme.colorScheme.onSurface
    else -> MaterialTheme.colorScheme.onSurfaceVariant
}
