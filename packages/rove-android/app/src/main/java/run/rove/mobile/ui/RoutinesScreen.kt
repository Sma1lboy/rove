package run.rove.mobile.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import run.rove.mobile.R
import run.rove.mobile.data.BridgeFailure
import run.rove.mobile.data.routines
import run.rove.mobile.domain.*
import java.time.Instant
import java.util.Locale

/** Runs [block]; a failure goes to [onError] as text and the result is null. */
internal suspend fun <T> routineCall(failed: String, onError: (String) -> Unit, block: suspend () -> T): T? = try {
    block()
} catch (e: CancellationException) { throw e }
catch (e: BridgeFailure) { onError("${e.code}: ${e.message}"); null }
catch (_: Exception) { onError(failed); null }

@Composable internal fun untilText(iso: String?, now: Instant): String {
    val ms = RoutineLogic.untilMs(iso, now) ?: return "—"
    return if (ms <= 0) stringResource(R.string.routines_due)
    else stringResource(R.string.routines_in, TaskAge.label(ms.toDouble()))
}

@Composable internal fun agoText(iso: String?, now: Instant): String {
    val ms = RoutineLogic.agoMs(iso, now) ?: return ""
    return stringResource(R.string.routines_ago, TaskAge.label(ms.toDouble()))
}

@Composable private fun toneColor(tone: RoutineLogic.Tone): Color = when (tone) {
    RoutineLogic.Tone.Success -> Rove.c.success
    RoutineLogic.Tone.Muted -> Rove.c.muted
    RoutineLogic.Tone.Warning -> Rove.c.warning
    RoutineLogic.Tone.Error -> Rove.c.error
}

@Composable private fun statusLabel(status: String): String = when (status) {
    "dispatched" -> stringResource(R.string.routines_status_dispatched)
    "revived" -> stringResource(R.string.routines_status_revived)
    "skipped_cancelled" -> stringResource(R.string.routines_status_skipped_cancelled)
    "skipped_precheck" -> stringResource(R.string.routines_status_skipped_precheck)
    "skipped_missed" -> stringResource(R.string.routines_status_skipped_missed)
    "skipped_unavailable" -> stringResource(R.string.routines_status_skipped_unavailable)
    "dispatch_failed" -> stringResource(R.string.routines_status_dispatch_failed)
    else -> status.replace('_', ' ')
}

/** Mono tag for a run outcome: healthy skips stay muted, missed runs are amber, a prompt that never reached an engine is red. */
@Composable internal fun RoutineStatusTag(status: String) {
    Text(statusLabel(status), color = toneColor(RoutineLogic.tone(status)), style = Rove.mono(11, FontWeight.Medium),
        maxLines = 1, softWrap = false)
}

private sealed interface RoutinesSheet {
    data object Create : RoutinesSheet
    data class Detail(val routine: Routine) : RoutinesSheet
}

/** Daemon-owned scheduled prompts (iOS `RoutinesView`): the list; a routine opens its detail sheet, `+` the create sheet. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable fun RoutinesScreen(model: AppModel, back: () -> Unit, open: (Route) -> Unit) {
    val scope = rememberCoroutineScope()
    val failed = stringResource(R.string.routines_failed)
    var payload by remember { mutableStateOf<RoutinesPayload?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var sheet by remember { mutableStateOf<RoutinesSheet?>(null) }
    var refreshing by remember { mutableStateOf(false) }

    suspend fun load() {
        routineCall(failed, { error = it }) { model.repository.routines() }?.let { payload = it; error = null }
    }
    LaunchedEffect(Unit) { load() }
    // Any sheet may have changed a routine, so closing one reloads the list.
    val closeSheet = { sheet = null; scope.launch { load() }; Unit }
    val now = Instant.now()
    val newLabel = stringResource(R.string.routines_new_a11y)

    Column(Modifier.fillMaxSize().background(Rove.c.paper)) {
        ScreenHeader(back, trailing = {
            Box(Modifier.size(36.dp).pressable { sheet = RoutinesSheet.Create }.semantics { contentDescription = newLabel },
                contentAlignment = Alignment.Center) {
                Icon(Icons.Filled.Add, null, tint = Rove.c.muted, modifier = Modifier.size(22.dp))
            }
        }) { Text(stringResource(R.string.routines_title), color = Rove.c.ink, style = Rove.face(16, FontWeight.SemiBold)) }
        PullToRefreshBox(refreshing, { scope.launch { refreshing = true; load(); refreshing = false } }, Modifier.weight(1f)) {
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 24.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)) {
                val loaded = payload
                if (loaded != null) {
                    item { Kicker(stringResource(R.string.routines_count, "%02d".format(Locale.ROOT, loaded.automations.size)),
                        Modifier.padding(horizontal = 4.dp)) }
                    error?.let { item { Box(Modifier.padding(horizontal = 4.dp)) { ErrorLine(it) } } }
                    if (loaded.automations.isEmpty()) item {
                        EmptyState(stringResource(R.string.routines_empty), stringResource(R.string.routines_empty_hint),
                            Modifier.padding(horizontal = 4.dp).padding(top = 12.dp))
                    }
                    items(loaded.automations, key = { it.id }) { routine ->
                        RoutineRow(routine, loaded.lastRunStatus[routine.id], now) { sheet = RoutinesSheet.Detail(routine) }
                    }
                    if (loaded.keepsDaemonAlive) item {
                        Text(stringResource(R.string.routines_keeps_alive), Modifier.padding(horizontal = 4.dp).padding(top = 8.dp),
                            color = Rove.c.muted, style = Rove.mono(12))
                    }
                } else if (error != null) item {
                    Column(Modifier.padding(horizontal = 4.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        ErrorLine(error!!)
                        TileLabel(stringResource(R.string.routines_retry), onClick = { scope.launch { load() } })
                    }
                } else item {
                    Row(Modifier.padding(horizontal = 4.dp).padding(top = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically) {
                        BrailleSpinner(13)
                        Text(stringResource(R.string.routines_loading), color = Rove.c.muted, style = Rove.mono(13))
                    }
                }
            }
        }
    }

    when (val s = sheet) {
        null -> {}
        RoutinesSheet.Create -> RoutineEditorSheet(model, null, closeSheet)
        is RoutinesSheet.Detail -> RoutineDetail(model, s.routine, closeSheet) { taskId ->
            sheet = null
            open(Route.Task(taskId))
        }
    }
}

@Composable private fun RoutineRow(routine: Routine, status: String?, now: Instant, onClick: () -> Unit) {
    // `repoName · 0 9 * * * · next in 3d`; a paused routine has no next run.
    val next = if (routine.enabled) untilText(routine.nextRunAt, now) else "—"
    Column(Modifier.fillMaxWidth().tile().pressable(onClick = onClick).padding(horizontal = 14.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(5.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Row(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(routine.name, Modifier.weight(1f, fill = false), color = Rove.c.ink, style = Rove.mono(14, FontWeight.SemiBold),
                    maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (!routine.enabled) Text(stringResource(R.string.routines_paused), color = Rove.c.muted,
                    style = Rove.mono(11, FontWeight.Medium), maxLines = 1, softWrap = false)
            }
            if (status != null) RoutineStatusTag(status)
        }
        Text(stringResource(R.string.routines_subtitle, routine.repoName, routine.schedule, next), color = Rove.c.muted,
            style = Rove.mono(12), maxLines = 2)
    }
}
