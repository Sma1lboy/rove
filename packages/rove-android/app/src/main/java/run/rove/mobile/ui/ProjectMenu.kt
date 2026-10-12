package run.rove.mobile.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import run.rove.mobile.R
import run.rove.mobile.data.forgetProject

// iOS `ProjectActionItems` (Detail/TaskActionHost.swift) and the forget-project flow of TaskActionsDeleteSheets.swift.

/** What a project header's `···` asked for; `Forget` is the dialog step, `ConfirmForget` the red sheet. */
internal sealed interface ProjectRequest {
    val repo: String
    data class Notes(override val repo: String) : ProjectRequest
    data class Forget(override val repo: String) : ProjectRequest
    data class ConfirmForget(override val repo: String) : ProjectRequest
}

/**
 * Projects order by their `main` task's stored order, so moving that task moves the project; a project without
 * a main row ([mainTaskId] null) has nothing to move.
 */
@Composable internal fun ProjectMenu(mainTaskId: String?, onMove: (taskId: String, direction: String) -> Unit,
                                     onRequest: (ProjectRequest) -> Unit, repo: String) {
    var open by remember { mutableStateOf(false) }
    val label = stringResource(R.string.listheader_project_actions)
    Box {
        Box(Modifier.size(36.dp, 28.dp).pressable { open = true }.semantics { contentDescription = label }, contentAlignment = Alignment.Center) {
            Text("···", color = Rove.c.muted, style = Rove.mono(14, FontWeight.Bold))
        }
        RoveMenu(open, { open = false }) {
            if (mainTaskId != null) {
                Kicker(stringResource(R.string.listheader_order_section), Modifier.padding(horizontal = 12.dp, vertical = 6.dp))
                RoveMenuItem(stringResource(R.string.listheader_move_up)) { open = false; onMove(mainTaskId, "up") }
                RoveMenuItem(stringResource(R.string.listheader_move_down)) { open = false; onMove(mainTaskId, "down") }
                RoveMenuItem(stringResource(R.string.listheader_move_top)) { open = false; onMove(mainTaskId, "top") }
            }
            RoveMenuItem(stringResource(R.string.listheader_field_notes_item)) { open = false; onRequest(ProjectRequest.Notes(repo)) }
            RoveMenuItem(stringResource(R.string.listheader_remove_project), tint = Rove.c.error) {
                open = false; onRequest(ProjectRequest.Forget(repo))
            }
        }
    }
}

/** Presents whatever [request] asks for; `null` shows nothing. */
@Composable internal fun ProjectSheets(model: AppModel, request: ProjectRequest?, onRequest: (ProjectRequest?) -> Unit) {
    when (request) {
        null -> Unit
        is ProjectRequest.Notes -> FieldNotesSheet(model, request.repo) { onRequest(null) }
        is ProjectRequest.Forget -> AlertDialog(onDismissRequest = { onRequest(null) }, containerColor = Rove.c.paper,
            title = { Text(stringResource(R.string.listheader_forget_dialog_title), color = Rove.c.ink, style = Rove.face(17, FontWeight.SemiBold)) },
            text = { Text(stringResource(R.string.listheader_forget_dialog_message), color = Rove.c.muted, style = Rove.mono(13)) },
            confirmButton = {
                TileLabel(stringResource(R.string.listheader_forget_dialog_button), tint = Rove.c.error,
                    onClick = { onRequest(ProjectRequest.ConfirmForget(request.repo)) })
            },
            dismissButton = { TileLabel(stringResource(R.string.listheader_cancel), onClick = { onRequest(null) }) })
        is ProjectRequest.ConfirmForget -> ForgetSheet(model, request.repo) { onRequest(null) }
    }
}

/** `project.forget` behind its red confirmation; the repo and its tasks stay on disk. */
@Composable private fun ForgetSheet(model: AppModel, repo: String, onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    SheetScaffold(stringResource(R.string.listheader_forget_title), onDismiss, stringResource(R.string.listheader_forget_kicker), error,
        primary = {
            PrimaryBar(stringResource(R.string.listheader_forget_confirm), destructive = true, busy = busy) {
                scope.launch {
                    busy = true
                    try {
                        model.repository.forgetProject(repo)
                        model.refresh()
                        onDismiss()
                    } catch (e: CancellationException) { throw e }
                    catch (e: Exception) { error = e.message.orEmpty() }
                    finally { busy = false }
                }
            }
        }) {
        Text(stringResource(R.string.listheader_forget_body), color = Rove.c.ink, style = Rove.face(16))
    }
}
