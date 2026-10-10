package run.rove.mobile.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import run.rove.mobile.R
import run.rove.mobile.data.*
import run.rove.mobile.domain.*
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

private enum class Modal { Edit, Delete }

/**
 * One routine: prompt, read-only precheck, schedule, repo, recent runs and the actions (pause/resume, run now, open the
 * latest task, edit, delete). A sheet over the list (iOS `RoutineDetail`); [onClose] reloads the list, [onOpenTask] leaves it.
 */
@Composable fun RoutineDetail(model: AppModel, initial: Routine, onClose: () -> Unit, onOpenTask: (String) -> Unit) {
    val scope = rememberCoroutineScope()
    val failed = stringResource(R.string.routines_failed)
    var routine by remember { mutableStateOf(initial) }
    var runs by remember { mutableStateOf<List<RoutineRun>?>(null) }
    var runsError by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var expanded by remember { mutableStateOf(setOf<String>()) }
    var confirmRun by remember { mutableStateOf(false) }
    var modal by remember { mutableStateOf<Modal?>(null) }
    val now = Instant.now()
    val latestTaskId = runs?.firstOrNull()?.taskId

    suspend fun reloadRuns() {
        routineCall(failed, { runsError = it }) { model.repository.routineRuns(routine.id) }?.let { runs = it; runsError = null }
    }
    // The routine itself (state, next run) and its run history.
    suspend fun refresh() {
        routineCall(failed, { error = it }) { model.repository.routines() }
            ?.automations?.firstOrNull { it.id == routine.id }?.let { routine = it }
        reloadRuns()
    }
    fun change(block: suspend () -> Unit) {
        busy = true; error = null
        scope.launch {
            routineCall(failed, { error = it }) { block(); refresh() }
            busy = false
        }
    }
    LaunchedEffect(Unit) { reloadRuns() }

    SheetScaffold(title = routine.name, onDismiss = onClose, kicker = stringResource(R.string.routines_kicker), error = error) {
        FormSection(stringResource(R.string.routines_prompt)) {
            SelectionContainer {
                Text(routine.prompt, Modifier.fillMaxWidth().tile().padding(14.dp), color = Rove.c.ink, style = Rove.face(15))
            }
        }
        PrecheckSection(routine.precheck)
        FormSection(stringResource(R.string.routines_schedule)) {
            Column(Modifier.fillMaxWidth().tile().padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(routine.schedule, Modifier.weight(1f), color = Rove.c.ink, style = Rove.mono(14, FontWeight.SemiBold))
                    if (!routine.enabled) Text(stringResource(R.string.routines_paused), color = Rove.c.muted,
                        style = Rove.mono(11, FontWeight.Medium))
                }
                Text(nextLine(routine, now), color = Rove.c.muted, style = Rove.mono(12))
            }
        }
        RepoSection(routine)
        RunsSection(runs, runsError, expanded, now, onRetry = { scope.launch { reloadRuns() } },
            onToggle = { id -> expanded = if (id in expanded) expanded - id else expanded + id }, onOpenTask = onOpenTask)
        FormSection(stringResource(R.string.routines_actions)) {
            Column(Modifier.fillMaxWidth().tile()) {
                val guard: (() -> Unit) -> () -> Unit = { action -> { if (!busy) action() } }
                ActionRow(stringResource(if (routine.enabled) R.string.routines_pause else R.string.routines_resume),
                    onClick = guard { change { model.repository.setRoutineEnabled(routine.id, !routine.enabled) } })
                Divider()
                ActionRow(stringResource(R.string.routines_run_now), stringResource(R.string.routines_skips_precheck),
                    onClick = guard { confirmRun = true })
                Divider()
                ActionRow(stringResource(R.string.routines_open_latest), tint = if (latestTaskId == null) Rove.c.muted else Rove.c.ink,
                    onClick = guard { latestTaskId?.let(onOpenTask) })
                Divider()
                ActionRow(stringResource(R.string.routines_edit), stringResource(R.string.routines_edit_detail),
                    onClick = guard { modal = Modal.Edit })
                Divider()
                ActionRow(stringResource(R.string.routines_delete), tint = Rove.c.error, onClick = guard { modal = Modal.Delete })
            }
        }
    }

    if (confirmRun) AlertDialog(onDismissRequest = { confirmRun = false }, containerColor = Rove.c.paper,
        title = { Text(stringResource(R.string.routines_run_confirm_title), color = Rove.c.ink, style = Rove.face(17, FontWeight.SemiBold)) },
        text = { Text(stringResource(R.string.routines_run_confirm_body), color = Rove.c.muted, style = Rove.mono(13)) },
        confirmButton = {
            TileLabel(stringResource(R.string.routines_run_now), onClick = {
                confirmRun = false
                change { model.repository.runRoutineNow(routine.id) }
            })
        },
        dismissButton = { TileLabel(stringResource(R.string.routines_cancel), onClick = { confirmRun = false }) })

    when (modal) {
        null -> {}
        Modal.Edit -> RoutineEditorSheet(model, routine) { modal = null; scope.launch { refresh() } }
        Modal.Delete -> RoutineDeleteSheet(model, routine, { modal = null }, onClose)
    }
}

@Composable private fun Divider() { Box(Modifier.fillMaxWidth().height(1.dp).background(Rove.c.line)) }

@Composable private fun PrecheckSection(precheck: RoutinePrecheck?) {
    FormSection(stringResource(R.string.routines_precheck)) {
        Column(Modifier.fillMaxWidth().tile().padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            if (precheck != null) {
                SelectionContainer { Text(precheck.command, color = Rove.c.ink, style = Rove.mono(13)) }
                precheck.timeoutSeconds?.let {
                    Text(stringResource(R.string.routines_timeout, it), color = Rove.c.muted, style = Rove.mono(12))
                }
            } else Text(stringResource(R.string.routines_none), color = Rove.c.muted, style = Rove.mono(13))
        }
        Hint(stringResource(R.string.routines_precheck_hint))
    }
}

/** `next Oct 6, 2026, 9:00 AM · in 3d` in this phone's clock; paused routines have no next run. */
@Composable private fun nextLine(routine: Routine, now: Instant): String {
    val at = RoutineLogic.instant(routine.nextRunAt)
    if (!routine.enabled || at == null) return stringResource(R.string.routines_next_none)
    val local = DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)
        .withLocale(Locale.getDefault()).withZone(ZoneId.systemDefault()).format(at)
    return stringResource(R.string.routines_next_line, local, untilText(routine.nextRunAt, now))
}

@Composable private fun RepoSection(routine: Routine) {
    FormSection(stringResource(R.string.routines_repo)) {
        Column(Modifier.fillMaxWidth().tile().padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(routine.repoName, color = Rove.c.ink, style = Rove.mono(14, FontWeight.SemiBold))
                Text(routine.repo, color = Rove.c.muted, style = Rove.mono(11), maxLines = 1, overflow = TextOverflow.StartEllipsis)
            }
            val ref = routine.baseRef?.takeIf { it.isNotEmpty() }
            if (routine.persistentSession || ref != null) Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                if (routine.persistentSession) Tag(stringResource(R.string.routines_persistent))
                if (ref != null) Tag(stringResource(R.string.routines_base, ref))
            }
        }
    }
}

@Composable private fun Tag(text: String) {
    Text(text, Modifier.tile(Rove.c.inset, Rove.smallRadius).padding(horizontal = 8.dp, vertical = 4.dp), color = Rove.c.muted,
        style = Rove.mono(11, FontWeight.Medium), maxLines = 1)
}

@Composable private fun RunsSection(runs: List<RoutineRun>?, runsError: String?, expanded: Set<String>, now: Instant,
                                    onRetry: () -> Unit, onToggle: (String) -> Unit, onOpenTask: (String) -> Unit) {
    val shown = runs?.take(10)
    FormSection(stringResource(R.string.routines_last_runs), trailing = shown?.let { "%02d".format(Locale.ROOT, it.size) }) {
        if (shown != null) {
            if (shown.isEmpty()) EmptyState(stringResource(R.string.routines_no_runs), stringResource(R.string.routines_no_runs_hint))
            else Column(Modifier.fillMaxWidth().tile()) {
                shown.forEachIndexed { i, run ->
                    if (i > 0) Divider()
                    RunRow(run, run.id in expanded, now, { onToggle(run.id) }, onOpenTask)
                }
            }
        } else if (runsError != null) {
            ErrorLine(runsError)
            TileLabel(stringResource(R.string.routines_retry), onClick = onRetry)
        } else BrailleSpinner(13)
    }
}

@Composable private fun RunRow(run: RoutineRun, open: Boolean, now: Instant, onToggle: () -> Unit, onOpenTask: (String) -> Unit) {
    Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("#${run.runNumber}", color = Rove.c.ink, style = Rove.mono(13, FontWeight.SemiBold))
            RoutineStatusTag(run.status)
            Text(run.trigger, Modifier.weight(1f), color = Rove.c.muted, style = Rove.mono(11), maxLines = 1)
            Text(agoText(run.at, now), color = Rove.c.muted, style = Rove.mono(11), maxLines = 1)
        }
        run.error?.takeIf { it.isNotEmpty() }?.let { ErrorLine(it) }
        run.response?.text?.takeIf { it.isNotEmpty() }?.let {
            Text(it, Modifier.fillMaxWidth().pressable(onClick = onToggle), color = Rove.c.muted, style = Rove.face(14),
                maxLines = if (open) Int.MAX_VALUE else 6, overflow = TextOverflow.Ellipsis)
        }
        run.taskId?.let { id -> TileLabel(stringResource(R.string.routines_open_task), size = 12, onClick = { onOpenTask(id) }) }
    }
}
