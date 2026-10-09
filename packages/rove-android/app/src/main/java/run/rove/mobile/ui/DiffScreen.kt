package run.rove.mobile.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.decodeFromJsonElement
import run.rove.mobile.data.*
import run.rove.mobile.domain.*

@Composable fun DiffScreen(model: AppModel, taskId: String) {
    var files by remember(taskId) { mutableStateOf<DiffFiles?>(null) }
    var selected by remember(taskId) { mutableStateOf<DiffFile?>(null) }
    var content by remember(taskId) { mutableStateOf<DiffContent?>(null) }
    var loading by remember { mutableStateOf(true) }
    LaunchedEffect(taskId, selected) {
        loading = true; content = null
        try {
            val file = selected
            if (file == null) files = wireJson.decodeFromJsonElement(model.bridge.request("diff.files", args("taskId" to taskId)))
            else content = wireJson.decodeFromJsonElement(model.bridge.request("diff.file",
                args("taskId" to taskId, "path" to file.path, "scope" to file.scope)))
        } catch (e: CancellationException) { throw e }
        catch (_: Exception) { model.error.value = "Could not load diff" }
        finally { loading = false }
    }
    Column(Modifier.fillMaxSize().padding(16.dp)) {
        if (selected != null) TextButton(onClick = { selected = null }) { Text("‹ files") }
        if (loading) CircularProgressIndicator()
        else if (selected == null) {
            Text("base · ${files?.base ?: "unknown"}", style = MaterialTheme.typography.labelMedium)
            if (files?.files?.isEmpty() == true) Text("No changes")
            LazyColumn {
                items(files?.files.orEmpty(), key = { it.scope + ":" + it.path }) { file ->
                    Column(Modifier.fillMaxWidth().clickable { selected = file }.padding(vertical = 16.dp)) {
                        Text(file.path)
                        Text("${file.scope} · ${file.status} · +${file.added ?: 0} −${file.deleted ?: 0}", style = MaterialTheme.typography.labelSmall)
                    }
                }
            }
        } else {
            Text(selected!!.path, style = MaterialTheme.typography.labelMedium)
            val lines = (content?.text ?: content?.message ?: content?.kind ?: "No preview").lines()
            SelectionContainer {
                LazyColumn { items(lines.size) { index ->
                    val line = lines[index]
                    Text(line, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall,
                        color = when {
                            line.startsWith("+") -> MaterialTheme.colorScheme.primary
                            line.startsWith("-") -> MaterialTheme.colorScheme.error
                            else -> MaterialTheme.colorScheme.onSurface
                        })
                } }
            }
        }
    }
}
