package run.rove.mobile.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import run.rove.mobile.R
import run.rove.mobile.data.deleteNote
import run.rove.mobile.data.fieldNotes
import run.rove.mobile.domain.FieldNote

// iOS Tasks/FieldNotesView.swift: a repo's field notes, each retired with an explicit delete and a red confirmation.

@Composable internal fun FieldNotesSheet(model: AppModel, repo: String, onDismiss: () -> Unit) {
    var notes by remember { mutableStateOf<List<FieldNote>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var deleting by remember { mutableStateOf<FieldNote?>(null) }
    var reload by remember { mutableIntStateOf(0) }
    LaunchedEffect(reload) {
        try {
            notes = model.repository.fieldNotes(repo)
            error = null
        } catch (e: CancellationException) { throw e }
        catch (e: Exception) { error = e.message.orEmpty() }
        loading = false
    }
    SheetScaffold(stringResource(R.string.listheader_notes_title), onDismiss, repoName(repo)) {
        when {
            loading -> BrailleSpinner(13)
            error != null -> ErrorLine(error!!)
            notes.isEmpty() -> EmptyState(stringResource(R.string.listheader_notes_empty), stringResource(R.string.listheader_notes_empty_detail))
            else -> {
                Hint(stringResource(R.string.listheader_notes_hint))
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) { notes.forEach { NoteTile(it) { deleting = it } } }
            }
        }
    }
    deleting?.let { note ->
        NoteDeleteSheet(model, repo, note, onDismiss = { deleting = null }, done = { reload++ })
    }
}

@Composable private fun NoteTile(note: FieldNote, onDelete: () -> Unit) {
    Column(Modifier.fillMaxWidth().tile().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(note.text, Modifier.fillMaxWidth(), color = Rove.c.ink, style = Rove.mono(13))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(note.footer, Modifier.weight(1f), color = Rove.c.muted, maxLines = 1, overflow = TextOverflow.Ellipsis, style = Rove.mono(11))
            Box(Modifier.defaultMinSize(44.dp, 36.dp).pressable(onClick = onDelete), contentAlignment = Alignment.CenterEnd) {
                Text(stringResource(R.string.listheader_notes_delete), color = Rove.c.error, style = Rove.mono(12, FontWeight.Medium))
            }
        }
    }
}

/** `notes.delete` behind its own red confirmation; the note is gone for every future session. */
@Composable private fun NoteDeleteSheet(model: AppModel, repo: String, note: FieldNote, onDismiss: () -> Unit, done: () -> Unit) {
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    SheetScaffold(stringResource(R.string.listheader_note_delete_title), onDismiss,
        stringResource(R.string.listheader_note_delete_kicker, note.id), error,
        primary = {
            PrimaryBar(stringResource(R.string.listheader_note_delete_confirm), destructive = true, busy = busy) {
                scope.launch {
                    busy = true
                    try {
                        // `deleted: false` means the id named nothing (already evicted): the note is gone either way.
                        model.repository.deleteNote(repo, note.id)
                        done()
                        onDismiss()
                    } catch (e: CancellationException) { throw e }
                    catch (e: Exception) { error = e.message.orEmpty() }
                    finally { busy = false }
                }
            }
        }) {
        Text(note.text, Modifier.fillMaxWidth().tile().padding(12.dp), color = Rove.c.ink, style = Rove.mono(13))
        Hint(stringResource(R.string.listheader_note_delete_hint))
    }
}
