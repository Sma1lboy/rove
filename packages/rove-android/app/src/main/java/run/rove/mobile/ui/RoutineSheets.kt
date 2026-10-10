package run.rove.mobile.ui

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import run.rove.mobile.R
import run.rove.mobile.data.*
import run.rove.mobile.domain.*
import java.util.Locale

private data class Preset(val label: Int, val cron: String)

private val presets = listOf(
    Preset(R.string.routines_preset_hourly, "0 * * * *"),
    Preset(R.string.routines_preset_daily, "0 9 * * *"),
    Preset(R.string.routines_preset_weekdays, "0 9 * * MON-FRI"),
    Preset(R.string.routines_preset_weekly, "0 9 * * MON"),
)

/**
 * Create a routine, or edit one ([editing]): name, prompt and schedule only. The repo is fixed once created, and a
 * precheck is never authored here: it runs a shell command, so it stays a mac setting. [dismiss] runs on close and on save.
 */
@Composable fun RoutineEditorSheet(model: AppModel, editing: Routine?, dismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    val failed = stringResource(R.string.routines_failed)
    var repos by remember { mutableStateOf<List<String>>(emptyList()) }
    var repo by remember { mutableStateOf(editing?.repo.orEmpty()) }
    var name by remember { mutableStateOf(editing?.name.orEmpty()) }
    var prompt by remember { mutableStateOf(editing?.prompt.orEmpty()) }
    var schedule by remember { mutableStateOf(editing?.schedule.orEmpty()) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        if (editing == null) routineCall(failed, { error = it }) { model.repository.repos() }?.let {
            repos = it
            if (repo.isEmpty()) repo = it.firstOrNull().orEmpty()
        }
    }

    val normalized = RoutineLogic.normalizeSchedule(schedule)
    val scheduleValid = RoutineLogic.validSchedule(normalized)
    val lengthProblem = when {
        RoutineLogic.nameTooLong(name) -> stringResource(R.string.routines_name_long, RoutineLogic.NAME_MAX)
        RoutineLogic.promptTooLong(prompt) -> stringResource(R.string.routines_prompt_long, RoutineLogic.PROMPT_MAX)
        else -> null
    }
    val changes = editing?.let { RoutineLogic.changes(it, name, prompt, schedule) }.orEmpty()
    val ready = name.isNotBlank() && prompt.isNotBlank() && scheduleValid && lengthProblem == null &&
        if (editing == null) repo.isNotEmpty() else changes.isNotEmpty()

    fun save() {
        busy = true; error = null
        scope.launch {
            val done = routineCall(failed, { error = it }) {
                if (editing != null) model.repository.updateRoutine(editing.id, changes)
                else model.repository.createRoutine(repo, name.trim(), prompt.trim(), normalized)
                Unit
            }
            busy = false
            if (done != null) dismiss()
        }
    }

    SheetScaffold(title = stringResource(if (editing == null) R.string.routines_new else R.string.routines_edit_title),
        onDismiss = { if (!busy) dismiss() },
        kicker = editing?.name ?: stringResource(R.string.routines_kicker_new), error = error,
        primary = {
            PrimaryBar(stringResource(if (editing == null) R.string.routines_create else R.string.routines_save),
                enabled = ready, busy = busy, onClick = ::save)
        }) {
        FormSection(stringResource(R.string.routines_name)) {
            FieldBox(name, { name = it }, stringResource(R.string.routines_name_placeholder))
        }
        if (editing != null) FormSection(stringResource(R.string.routines_repository)) {
            Column(Modifier.fillMaxWidth().tile(Rove.c.inset).padding(horizontal = 14.dp, vertical = 10.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(editing.repoName, color = Rove.c.muted, style = Rove.mono(14, FontWeight.Medium))
                Text(editing.repo, color = Rove.c.muted, style = Rove.mono(11), maxLines = 1, overflow = TextOverflow.StartEllipsis)
            }
            Hint(stringResource(R.string.routines_repo_fixed))
        } else FormSection(stringResource(R.string.routines_repository), trailing = if (repos.isEmpty()) null else "%02d".format(Locale.ROOT, repos.size)) {
            if (repos.isEmpty() && error == null) BrailleSpinner(13)
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) { repos.forEach { RepoTile(it, it == repo) { repo = it } } }
        }
        FormSection(stringResource(R.string.routines_prompt)) {
            PromptEditor(prompt, { prompt = it }, stringResource(R.string.routines_prompt_placeholder), minHeight = 140.dp)
        }
        FormSection(stringResource(R.string.routines_schedule)) {
            FieldBox(schedule, { schedule = it }, "0 9 * * *", keyboard = KeyboardOptions(keyboardType = KeyboardType.Ascii))
            PresetTiles(normalized) { schedule = it }
            // Only once the user typed something: an empty field is just not filled in yet.
            if (normalized.isNotEmpty() && !scheduleValid) ErrorLine(stringResource(R.string.routines_schedule_invalid))
            Hint(stringResource(R.string.routines_schedule_hint))
        }
        lengthProblem?.let { ErrorLine(it) }
    }
}

/** One repository: folder name over its full path. */
@Composable private fun RepoTile(path: String, on: Boolean, onSelect: () -> Unit) {
    Column(Modifier.fillMaxWidth().selectableTile(on).pressable(onClick = onSelect).padding(horizontal = 14.dp, vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(path.trimEnd('/').substringAfterLast('/'), color = if (on) Rove.c.accent else Rove.c.ink,
            style = Rove.mono(14, if (on) FontWeight.SemiBold else FontWeight.Medium), maxLines = 1)
        Text(path, color = Rove.c.muted, style = Rove.mono(11), maxLines = 1, overflow = TextOverflow.StartEllipsis)
    }
}

/** A tile lights when the field holds its expression, however the spaces were typed. */
@Composable private fun PresetTiles(current: String, onSelect: (String) -> Unit) {
    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        presets.forEach { preset ->
            val on = preset.cron == current
            Box(Modifier.heightIn(min = 40.dp).selectableTile(on).pressable { onSelect(preset.cron) }, contentAlignment = Alignment.Center) {
                Text(stringResource(preset.label), Modifier.padding(horizontal = 12.dp), color = if (on) Rove.c.accent else Rove.c.ink,
                    style = Rove.mono(13, if (on) FontWeight.SemiBold else FontWeight.Normal), maxLines = 1)
            }
        }
    }
}

/** `routine.delete`: states the boundary (history goes, tasks stay) before anything changes. */
@Composable fun RoutineDeleteSheet(model: AppModel, routine: Routine, dismiss: () -> Unit, deleted: () -> Unit) {
    val scope = rememberCoroutineScope()
    val failed = stringResource(R.string.routines_failed)
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    SheetScaffold(title = stringResource(R.string.routines_delete_title), onDismiss = { if (!busy) dismiss() },
        kicker = stringResource(R.string.routines_delete), error = error,
        primary = {
            PrimaryBar(stringResource(R.string.routines_delete_confirm), destructive = true, busy = busy) {
                busy = true; error = null
                scope.launch {
                    val done = routineCall(failed, { error = it }) { model.repository.deleteRoutine(routine.id) }
                    busy = false
                    if (done != null) deleted()
                }
            }
        }) {
        Text(routine.name, color = Rove.c.ink, style = Rove.mono(14, FontWeight.SemiBold))
        Text(stringResource(R.string.routines_delete_body), color = Rove.c.ink, style = Rove.face(16))
    }
}
