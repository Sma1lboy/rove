package run.rove.mobile.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.serialization.json.*
import run.rove.mobile.data.args

@Composable fun CreateSheet(model: AppModel, taskId: String?, dismiss: () -> Unit, created: (String) -> Unit) {
    val engines by model.engines.collectAsStateWithLifecycle()
    val repos by model.repos.collectAsStateWithLifecycle()
    var engine by remember { mutableStateOf("") }
    var repo by remember { mutableStateOf("") }
    var title by remember { mutableStateOf("") }
    var prompt by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    AlertDialog(onDismissRequest = { if (!busy) dismiss() }, title = { Text(if (taskId == null) "new task" else "new engine tab") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                if (taskId == null) {
                    Picker("repository", repo, repos.map { it to it.substringAfterLast('/') }, { repo = it })
                    OutlinedTextField(title, { title = it }, label = { Text("title · optional") })
                }
                Picker("engine", engine, engines.map { it.id to it.name }, { engine = it })
                OutlinedTextField(prompt, { prompt = it }, label = { Text("first message") }, minLines = 3)
            }
        }, dismissButton = { TextButton(onClick = dismiss, enabled = !busy) { Text("cancel") } },
        confirmButton = { TextButton(enabled = !busy && engine.isNotEmpty() &&
            (if (taskId == null) repo.isNotEmpty() else prompt.isNotBlank()), onClick = {
            busy = true
            model.action {
                try {
                    val payload = if (taskId == null) args("repo" to repo, "engine" to engine, "title" to title, "prompt" to prompt)
                    else args("taskId" to taskId, "engine" to engine, "prompt" to prompt)
                    val result = model.bridge.request(if (taskId == null) "task.create" else "tab.new", payload)
                    val id = result[if (taskId == null) "taskId" else "tabId"]?.jsonPrimitive?.content ?: error("Missing id")
                    model.refresh(); created(id)
                } finally { busy = false }
            }
        }) { Text(if (busy) "creating…" else "create") } })
}

@Composable private fun Picker(label: String, value: String, choices: List<Pair<String, String>>, select: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        OutlinedButton(shape = MaterialTheme.shapes.small, onClick = { open = true }) { Text(choices.firstOrNull { it.first == value }?.second ?: "choose $label") }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            choices.forEach { (id, name) -> DropdownMenuItem(text = { Text(name) }, onClick = { select(id); open = false }) }
        }
    }
}
