package run.rove.mobile.ui

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import run.rove.mobile.R
import run.rove.mobile.data.BridgeFailure

/** iOS `NewTaskView` (existing mode) when [taskId] is null, `NewSessionSheet` (same-worktree tab) otherwise. */
@Composable fun CreateSheet(model: AppModel, taskId: String?, dismiss: () -> Unit, created: (String) -> Unit) {
    val engines by model.engines.collectAsStateWithLifecycle()
    val repos by model.repos.collectAsStateWithLifecycle()
    val tasks by model.tasks.collectAsStateWithLifecycle()
    val demo by model.demo.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    val failed = stringResource(R.string.create_failed)
    var pickedRepo by remember { mutableStateOf("") }
    var pickedEngine by remember { mutableStateOf("") }
    var title by remember { mutableStateOf("") }
    var prompt by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    val repo = pickedRepo.takeIf { it in repos } ?: repos.firstOrNull().orEmpty()
    // A new tab starts on the engine its task already runs, as iOS does.
    val taskEngine = tasks.tasks.firstOrNull { it.id == taskId }?.engine?.id
    val engine = pickedEngine.takeIf { p -> engines.any { it.id == p } }
        ?: engines.firstOrNull { it.id == taskEngine }?.id ?: engines.firstOrNull()?.id.orEmpty()
    val isTask = taskId == null
    // A task may open without a prompt; a new tab needs its first message.
    val ready = !busy && engine.isNotEmpty() && if (isTask) repo.isNotEmpty() else prompt.isNotBlank()

    fun submit() {
        busy = true; error = null
        scope.launch {
            try {
                val id = if (taskId == null) model.repository.createTask(repo, engine, title.trim(), prompt.trim())
                else model.repository.newTab(taskId, engine, prompt.trim())
                model.refresh(); created(id)
            } catch (e: CancellationException) { throw e }
            catch (e: BridgeFailure) { error = "${e.code}: ${e.message}" }
            catch (_: Exception) { error = failed }
            finally { busy = false }
        }
    }

    SheetScaffold(title = stringResource(if (isTask) R.string.create_new_task else R.string.create_new_session),
        onDismiss = { if (!busy) dismiss() },
        kicker = stringResource(if (isTask) R.string.create_kicker_task else R.string.create_kicker_session),
        error = error, demo = demo, onExitDemo = { model.unpair(); dismiss() },
        primary = {
            PrimaryBar(stringResource(if (isTask) R.string.create_submit_task else R.string.create_submit_session),
                enabled = ready, busy = busy, onClick = ::submit)
        }) {
        if (isTask) {
            FormSection(stringResource(R.string.create_repository), trailing = if (repos.isEmpty()) null else "%02d".format(repos.size)) {
                if (repos.isEmpty()) BrailleSpinner(13)
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    repos.forEach { RepoTile(it, it == repo) { pickedRepo = it } }
                }
            }
        }
        FormSection(stringResource(R.string.create_engine)) {
            if (engines.isEmpty()) BrailleSpinner(13)
            else EngineTiles(engines.map { it.id to it.name.lowercase() }, engine) { pickedEngine = it }
        }
        if (isTask) FormSection(stringResource(R.string.create_title)) {
            FieldBox(title, { title = it }, stringResource(R.string.create_title_placeholder))
        }
        FormSection(stringResource(if (isTask) R.string.create_first_prompt else R.string.create_first_message)) {
            PromptEditor(prompt, { prompt = it },
                stringResource(if (isTask) R.string.create_prompt_placeholder_task else R.string.create_prompt_placeholder_session))
        }
        if (!isTask) Hint(stringResource(R.string.create_hint_tab) + " " + stringResource(R.string.create_hint_engines_only))
    }
}

/** One repository: folder name over its full path (iOS `RepoTiles` row). */
@Composable private fun RepoTile(path: String, on: Boolean, onSelect: () -> Unit) {
    Column(Modifier.fillMaxWidth().selectableTile(on).pressable(onClick = onSelect).padding(horizontal = 14.dp, vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(path.trimEnd('/').substringAfterLast('/'), color = if (on) Rove.c.accent else Rove.c.ink,
            style = Rove.mono(14, if (on) FontWeight.SemiBold else FontWeight.Medium), maxLines = 1)
        Text(path, color = Rove.c.muted, style = Rove.mono(11), maxLines = 1, overflow = TextOverflow.StartEllipsis)
    }
}

/** Content-sized engine tiles that scroll sideways when there are many (iOS `EnginePicker`, `fill: false`). */
@Composable private fun EngineTiles(options: List<Pair<String, String>>, selection: String, onSelect: (String) -> Unit) {
    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        options.forEach { (id, name) ->
            val on = id == selection
            Box(Modifier.heightIn(min = 40.dp).selectableTile(on).pressable { onSelect(id) }, contentAlignment = Alignment.Center) {
                Text(name, Modifier.padding(horizontal = 12.dp), color = if (on) Rove.c.accent else Rove.c.ink,
                    style = Rove.mono(13, if (on) FontWeight.SemiBold else FontWeight.Normal), maxLines = 1)
            }
        }
    }
}
