package run.rove.mobile.ui

import android.app.Application
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.widget.Toast
import androidx.compose.foundation.layout.*
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import run.rove.mobile.R
import run.rove.mobile.data.*
import run.rove.mobile.domain.*

// packages/rove-web/src/row-actions.tsx: what a long-press on a task row offers on a phone.

/** The dialog step a row menu item asks for; items with nothing to ask run straight away. */
internal sealed interface RowRequest {
    data class Rename(val row: TaskRow) : RowRequest
    data class RenameBranch(val row: TaskRow) : RowRequest
    data class Status(val row: TaskRow) : RowRequest
    data class ArchiveBusy(val row: TaskRow) : RowRequest
    data class Copy(val row: TaskRow) : RowRequest
    data class Engine(val row: TaskRow) : RowRequest
    data class Move(val row: TaskRow, val targets: List<MoveTarget>) : RowRequest
    data class Confirm(val row: TaskRow, val action: String, val preflight: LandPreflight? = null) : RowRequest
}

@Composable internal fun TaskRowMenu(row: TaskRow, open: Boolean, onDismiss: () -> Unit, onPick: (RowMenuItem) -> Unit) {
    var more by remember(open) { mutableStateOf(false) }
    val items = TaskRowMenuLogic.items(row)
    val firstRare = items.firstOrNull { it in TaskRowMenuLogic.RARE }
    RoveMenu(open, onDismiss) {
        items.forEach { item ->
            if (item == firstRare) RoveMenuItem(stringResource(R.string.rowmenu_more) + if (more) " ⌄" else " ›", tint = Rove.c.muted) { more = !more }
            if (item in TaskRowMenuLogic.RARE && !more) return@forEach
            RoveMenuItem(stringResource(when (item) {
                RowMenuItem.NewConversation -> R.string.rowmenu_new_conversation
                RowMenuItem.NewShell -> R.string.rowmenu_new_shell
                RowMenuItem.Rename -> R.string.rowmenu_rename
                RowMenuItem.Pin -> R.string.rowmenu_pin
                RowMenuItem.Unpin -> R.string.rowmenu_unpin
                RowMenuItem.SetStatus -> R.string.rowmenu_set_status
                RowMenuItem.SyncBase -> R.string.rowmenu_sync_base
                RowMenuItem.FixChecks -> R.string.rowmenu_fix_checks
                RowMenuItem.RenameBranch -> R.string.rowmenu_rename_branch
                RowMenuItem.Archive -> R.string.rowmenu_archive
                RowMenuItem.Unarchive -> R.string.rowmenu_unarchive
                RowMenuItem.Land -> R.string.rowmenu_land
                RowMenuItem.Copy -> R.string.rowmenu_copy
                RowMenuItem.MoveToProject -> R.string.rowmenu_move_to_project
                RowMenuItem.ChangeEngine -> R.string.rowmenu_change_engine
                RowMenuItem.Remove -> R.string.rowmenu_remove
            }), tint = if (item == RowMenuItem.Remove) Rove.c.error else Rove.c.ink) { onDismiss(); onPick(item) }
        }
    }
}

/** Runs [item], or returns the dialog it needs first. */
internal fun runRowMenuItem(model: AppModel, row: TaskRow, item: RowMenuItem, onOpen: (Route) -> Unit, onRequest: (RowRequest) -> Unit) {
    when (item) {
        RowMenuItem.NewConversation -> model.action { model.repository.openConversation(row.id).let { onOpen(Route.Task(it.taskId ?: row.id, it.tabId)) }; model.refresh() }
        RowMenuItem.NewShell -> model.action { model.repository.openShell(row.id).let { onOpen(Route.Task(it.taskId ?: row.id, it.tabId)) }; model.refresh() }
        RowMenuItem.Rename -> onRequest(RowRequest.Rename(row))
        RowMenuItem.RenameBranch -> onRequest(RowRequest.RenameBranch(row))
        RowMenuItem.SetStatus -> onRequest(RowRequest.Status(row))
        RowMenuItem.SyncBase -> syncBase(model, row)
        RowMenuItem.FixChecks -> fixChecks(model, row)
        RowMenuItem.Copy -> onRequest(RowRequest.Copy(row))
        RowMenuItem.ChangeEngine -> onRequest(RowRequest.Engine(row))
        RowMenuItem.Remove -> onRequest(RowRequest.Confirm(row, "delete"))
        RowMenuItem.Land -> model.action { checkLand(model, row.id, row.machine != null)?.let { onRequest(RowRequest.Confirm(row, "land", it.preflight)) } }
        RowMenuItem.MoveToProject -> {
            val targets = TaskRowMenuLogic.moveTargets(row, model.tasks.value.tasks)
            if (targets.isEmpty()) model.error.value = model.getApplication<Application>().getString(R.string.rowmenu_move_empty)
            else onRequest(RowRequest.Move(row, targets))
        }
        RowMenuItem.Pin, RowMenuItem.Unpin -> model.action { model.repository.pinTask(row.id, item == RowMenuItem.Pin); model.refresh() }
        RowMenuItem.Unarchive -> model.action { model.repository.archiveTask(row.id, archived = false); model.refresh() }
        RowMenuItem.Archive -> model.action {
            try { model.repository.archiveTask(row.id, archived = true); model.refresh() }
            catch (e: BridgeFailure) { if (e.code == "TASK_BUSY") onRequest(RowRequest.ArchiveBusy(row)) else throw e }
        }
    }
}

/** No confirm: a merge from base is additive, and `git merge --abort` undoes it. */
private fun syncBase(model: AppModel, row: TaskRow) {
    val app = model.getApplication<Application>()
    model.action {
        try {
            val synced = model.repository.syncBase(row.id)
            Toast.makeText(app, app.getString(if (synced.alreadyCurrent) R.string.rowmenu_sync_current else R.string.rowmenu_sync_done, synced.baseRef), Toast.LENGTH_SHORT).show()
            model.refresh()
        } catch (e: BridgeFailure) {
            val detail = "${e.code}: ${e.message}"
            model.error.value = when (val refusal = TaskRowMenuLogic.syncRefusal(detail)) {
                is SyncRefusal.Conflict -> app.getString(R.string.rowmenu_sync_conflict, refusal.files)
                is SyncRefusal.Dirty -> app.getString(R.string.rowmenu_sync_dirty, refusal.files)
                null -> app.getString(R.string.rowmenu_sync_failed, e.message)
            }
        }
    }
}

/** The bridge reads the red checks and sends the agent their logs: `none` and `unavailable` are answers, not errors. */
private fun fixChecks(model: AppModel, row: TaskRow) {
    val app = model.getApplication<Application>()
    model.action {
        val result = model.repository.fixChecks(row.id)
        when (result.outcome) {
            "sent" -> Toast.makeText(app, R.string.rowmenu_fix_sent, Toast.LENGTH_SHORT).show()
            "unavailable" -> model.error.value = app.getString(R.string.rowmenu_fix_unavailable, result.detail.orEmpty().lineSequence().firstOrNull().orEmpty())
            else -> model.error.value = app.getString(R.string.rowmenu_fix_none)
        }
    }
}

private fun copy(model: AppModel, text: String?) {
    val app = model.getApplication<Application>()
    if (text.isNullOrEmpty()) { model.error.value = app.getString(R.string.rowmenu_copy_nothing); return }
    (app.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("rove", text))
    Toast.makeText(app, app.getString(R.string.rowmenu_copied, text), Toast.LENGTH_SHORT).show()
}

@Composable private fun PickDialog(title: String, close: () -> Unit, note: String? = null, content: @Composable ColumnScope.() -> Unit) {
    AlertDialog(onDismissRequest = close, containerColor = Rove.c.paper,
        title = { Text(title, color = Rove.c.ink, style = Rove.face(17, FontWeight.SemiBold)) },
        text = { Column { note?.let { Text(it, color = Rove.c.muted, style = Rove.mono(12)) }; content() } },
        confirmButton = { TileLabel(stringResource(R.string.rowmenu_cancel), onClick = close) })
}

/** The same two steps as task detail's land and delete. */
@Composable private fun RowConfirm(model: AppModel, request: RowRequest.Confirm, close: () -> Unit) {
    var step by remember(request) { mutableIntStateOf(1) }
    var busy by remember(request) { mutableStateOf(false) }
    ConfirmDialog(request.action, step, busy, request.row, request.preflight, onDismiss = { if (!busy) close() }) {
        if (step == 1) step = 2
        else if (!busy) {
            busy = true
            model.action {
                try {
                    if (request.action == "delete") model.repository.delete(request.row.id) else model.repository.land(request.row.id)
                    close(); model.refresh()
                } finally { busy = false }
            }
        }
    }
}

@Composable internal fun RowSheets(model: AppModel, request: RowRequest?, onRequest: (RowRequest?) -> Unit) {
    val close = { onRequest(null) }
    when (request) {
        null -> Unit
        is RowRequest.Rename -> TextPrompt(stringResource(R.string.rowmenu_rename), request.row.title, close) { title ->
            model.action { model.repository.renameTask(request.row.id, title); model.refresh() }
        }
        is RowRequest.RenameBranch -> TextPrompt(stringResource(R.string.rowmenu_rename_branch), request.row.branch, close) { branch ->
            model.action { model.repository.renameBranch(request.row.id, branch); model.refresh() }
        }
        is RowRequest.Status -> AlertDialog(onDismissRequest = close, containerColor = Rove.c.paper,
            title = { Text(stringResource(R.string.rowmenu_set_status), color = Rove.c.ink, style = Rove.face(17, FontWeight.SemiBold)) },
            text = {
                Column {
                    TaskRowMenuLogic.STATUSES.forEach { status ->
                        RoveMenuItem(stringResource(statusLabel(status)), selected = status == request.row.status) {
                            close()
                            model.action { model.repository.setTaskStatus(request.row.id, status); model.refresh() }
                        }
                    }
                }
            },
            confirmButton = { TileLabel(stringResource(R.string.rowmenu_cancel), onClick = close) })
        is RowRequest.Confirm -> RowConfirm(model, request, close)
        is RowRequest.Copy -> PickDialog(stringResource(R.string.rowmenu_copy), close) {
            RoveMenuItem(stringResource(R.string.rowmenu_copy_id)) { close(); copy(model, request.row.id) }
            if (request.row.branch.isNotEmpty()) RoveMenuItem(stringResource(R.string.rowmenu_copy_branch)) { close(); copy(model, request.row.branch) }
            RoveMenuItem(stringResource(R.string.rowmenu_copy_path)) { close(); model.action { copy(model, model.repository.worktreePath(request.row.id)) } }
        }
        is RowRequest.Engine -> PickDialog(stringResource(R.string.rowmenu_change_engine), close, stringResource(R.string.rowmenu_engine_next_session)) {
            val engines by model.engines.collectAsState()
            engines.forEach { engine ->
                RoveMenuItem(engine.name, selected = engine.id == request.row.engine?.id) {
                    close()
                    model.action { model.repository.setTaskEngine(request.row.id, engine.id); model.refresh() }
                }
            }
        }
        is RowRequest.Move -> PickDialog(stringResource(R.string.rowmenu_move_to_project), close) {
            request.targets.forEach { target ->
                RoveMenuItem(target.label) {
                    close()
                    model.action { model.repository.moveTaskToProject(request.row.id, target.repo); model.refresh() }
                }
            }
        }
        is RowRequest.ArchiveBusy -> AlertDialog(onDismissRequest = close, containerColor = Rove.c.paper,
            title = { Text(stringResource(R.string.rowmenu_archive_busy_title), color = Rove.c.ink, style = Rove.face(17, FontWeight.SemiBold)) },
            text = { Text(stringResource(R.string.rowmenu_archive_busy_body, request.row.displayTitle), color = Rove.c.muted, style = Rove.mono(13)) },
            confirmButton = {
                TileLabel(stringResource(R.string.rowmenu_archive_busy_confirm), tint = Rove.c.accent, onClick = {
                    close()
                    model.action { model.repository.archiveTask(request.row.id, archived = true, force = true); model.refresh() }
                })
            },
            dismissButton = { TileLabel(stringResource(R.string.rowmenu_cancel), onClick = close) })
    }
}

private fun statusLabel(status: String) = when (status) {
    "backlog" -> R.string.rowmenu_status_backlog
    "in_progress" -> R.string.rowmenu_status_in_progress
    "in_review" -> R.string.rowmenu_status_in_review
    "done" -> R.string.rowmenu_status_done
    "canceled" -> R.string.rowmenu_status_canceled
    else -> R.string.rowmenu_status_error
}

@Composable internal fun TextPrompt(title: String, initial: String, onDismiss: () -> Unit, onSave: (String) -> Unit) {
    var text by remember { mutableStateOf(initial) }
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { focus.requestFocus() }
    val value = text.trim()
    AlertDialog(onDismissRequest = onDismiss, containerColor = Rove.c.paper,
        title = { Text(title, color = Rove.c.ink, style = Rove.face(17, FontWeight.SemiBold)) },
        text = { FieldBox(text, { text = it }, title, Modifier.focusRequester(focus)) },
        confirmButton = {
            TileLabel(stringResource(R.string.rowmenu_save), tint = if (value.isEmpty()) Rove.c.muted else Rove.c.accent,
                onClick = if (value.isEmpty()) null else ({ onDismiss(); if (value != initial) onSave(value) }))
        },
        dismissButton = { TileLabel(stringResource(R.string.rowmenu_cancel), onClick = onDismiss) })
}
