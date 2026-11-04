package run.rove.mobile.ui

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
}

@Composable internal fun TaskRowMenu(row: TaskRow, open: Boolean, onDismiss: () -> Unit, onPick: (RowMenuItem) -> Unit) {
    RoveMenu(open, onDismiss) {
        TaskRowMenuLogic.items(row).forEach { item ->
            RoveMenuItem(stringResource(when (item) {
                RowMenuItem.Rename -> R.string.rowmenu_rename
                RowMenuItem.Pin -> R.string.rowmenu_pin
                RowMenuItem.Unpin -> R.string.rowmenu_unpin
                RowMenuItem.SetStatus -> R.string.rowmenu_set_status
                RowMenuItem.RenameBranch -> R.string.rowmenu_rename_branch
                RowMenuItem.Archive -> R.string.rowmenu_archive
                RowMenuItem.Unarchive -> R.string.rowmenu_unarchive
            })) { onDismiss(); onPick(item) }
        }
    }
}

/** Runs [item], or returns the dialog it needs first. */
internal fun runRowMenuItem(model: AppModel, row: TaskRow, item: RowMenuItem, onRequest: (RowRequest) -> Unit) {
    when (item) {
        RowMenuItem.Rename -> onRequest(RowRequest.Rename(row))
        RowMenuItem.RenameBranch -> onRequest(RowRequest.RenameBranch(row))
        RowMenuItem.SetStatus -> onRequest(RowRequest.Status(row))
        RowMenuItem.Pin, RowMenuItem.Unpin -> model.action { model.repository.pinTask(row.id, item == RowMenuItem.Pin); model.refresh() }
        RowMenuItem.Unarchive -> model.action { model.repository.archiveTask(row.id, archived = false); model.refresh() }
        RowMenuItem.Archive -> model.action {
            try { model.repository.archiveTask(row.id, archived = true); model.refresh() }
            catch (e: BridgeFailure) { if (e.code == "TASK_BUSY") onRequest(RowRequest.ArchiveBusy(row)) else throw e }
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

@Composable private fun TextPrompt(title: String, initial: String, onDismiss: () -> Unit, onSave: (String) -> Unit) {
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
