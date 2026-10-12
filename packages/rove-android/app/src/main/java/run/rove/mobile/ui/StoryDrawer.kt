package run.rove.mobile.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import run.rove.mobile.R
import run.rove.mobile.data.*
import run.rove.mobile.domain.*

private class BoardInputError(message: String) : Exception(message)

private sealed interface EventsState {
    data object Loading : EventsState
    data class Loaded(val rows: List<TaskEvent>, val atMs: Long) : EventsState
    data class Failed(val message: String) : EventsState
}

/**
 * iOS `StoryDrawer`: edit title, description and status; for a linked story its task and recent events; start a
 * session; delete the record. [onChanged] reloads the board and is awaited so the board never shows stale data.
 */
@Composable fun StoryDrawer(model: AppModel, repo: String, story: Story, open: (Route) -> Unit, dismiss: () -> Unit,
                            onChanged: suspend () -> Unit, onStarted: (StartOutcome) -> Unit) {
    val feed by model.tasks.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    val fallback = stringResource(R.string.board_request_failed)
    val emptyTitle = stringResource(R.string.board_title_empty)
    var title by remember { mutableStateOf(story.title) }
    var detail by remember { mutableStateOf(story.detail) }
    var status by remember { mutableStateOf(story.status) }
    // What the bridge holds, so a board refresh underneath never moves the baseline.
    var original by remember { mutableStateOf(StoryEdit(story)) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var events by remember { mutableStateOf<EventsState>(EventsState.Loading) }
    var showStart by remember { mutableStateOf(false) }
    var showDelete by remember { mutableStateOf(false) }
    val edit = StoryEdit(title, detail, status)

    LaunchedEffect(story.id) {
        val id = story.link ?: return@LaunchedEffect
        events = try { EventsState.Loaded(model.repository.taskEvents(id), System.currentTimeMillis()) }
        catch (e: CancellationException) { throw e }
        catch (e: Exception) { EventsState.Failed(e.boardMessage(fallback)) }
    }

    /** Title and description via `issue.update`; the baseline moves only once the bridge accepted it. */
    suspend fun persistEdits() {
        val now = edit
        if (now.titleChanged(original) && now.title.isBlank()) throw BoardInputError(emptyTitle)
        val update = now.update(original) ?: return
        model.repository.issueUpdate(repo, story.id, update)
        original = original.copy(title = now.title, body = now.body)
    }

    /** `issue.update` for what changed, then `issue.setStatus` if the status did; reloads the board and closes. */
    fun save() {
        busy = true; error = null
        scope.launch {
            try {
                persistEdits()
                if (status != original.status) {
                    model.repository.issueSetStatus(repo, story.id, status)
                    original = original.copy(status = status)
                }
                onChanged()
                dismiss()
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) {
                error = e.boardMessage(fallback)
                // The first step may have landed before the second failed.
                onChanged()
            } finally { busy = false }
        }
    }

    val statusLabels = mapOf(IssueStatus.Open to stringResource(R.string.board_status_open),
        IssueStatus.Doing to stringResource(R.string.board_status_doing),
        IssueStatus.Hold to stringResource(R.string.board_status_hold),
        IssueStatus.Done to stringResource(R.string.board_status_done))

    SheetScaffold(title = stringResource(R.string.board_story_title, story.id), onDismiss = { if (!busy) dismiss() },
        kicker = BoardCardLogic.baseName(repo), error = error,
        primary = {
            PrimaryBar(stringResource(R.string.board_save), enabled = edit.canSubmit(original), busy = busy, onClick = ::save)
        }) {
        FormSection(stringResource(R.string.board_field_title)) {
            FieldBox(title, { title = it }, stringResource(R.string.board_title_placeholder))
        }
        FormSection(stringResource(R.string.board_field_description)) {
            PromptEditor(detail, { detail = it }, stringResource(R.string.board_description_placeholder))
        }
        FormSection(stringResource(R.string.board_field_status)) {
            ChoiceTiles(IssueStatus.entries, status, { statusLabels.getValue(it) }) { status = it }
        }
        story.link?.let { id ->
            LinkedTask(feed.tasks.firstOrNull { it.id == id }, loaded = feed.tasks.isNotEmpty()) { dismiss(); open(Route.Task(id)) }
            EventsSection(events)
        }
        StartButton(stringResource(if (story.linked) R.string.board_start_another else R.string.board_start_session)) { showStart = true }
        FormSection(stringResource(R.string.board_delete_story)) {
            Box(Modifier.fillMaxWidth().clip(RoundedCornerShape(Rove.radius)).tile()) {
                ActionRow(stringResource(R.string.board_delete_story), stringResource(R.string.board_record_only), Rove.c.error) { showDelete = true }
            }
        }
    }
    if (showStart) StartStorySheet(model, repo, story, unsaved = edit.isDirty(original), saveEdits = ::persistEdits,
        dismiss = { showStart = false }, finished = { dismiss(); onStarted(it) })
    if (showDelete) DeleteStorySheet(model, repo, story, dismiss = { showDelete = false },
        deleted = { scope.launch { onChanged(); dismiss() } })
}

@Composable private fun LinkedTask(task: TaskRow?, loaded: Boolean, openTask: () -> Unit) {
    FormSection(stringResource(R.string.board_field_task)) {
        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(Rove.radius)).tile()) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 12.dp), horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(task?.displayTitle ?: stringResource(R.string.board_linked_task), color = Rove.c.ink, maxLines = 2,
                        overflow = TextOverflow.Ellipsis, style = Rove.face(15, FontWeight.SemiBold))
                    if (task == null) Text(stringResource(if (loaded) R.string.board_not_in_list else R.string.board_waiting_list),
                        color = Rove.c.muted, style = Rove.mono(12))
                }
                if (task != null) StatusTag(task.group)
            }
            if (task != null) {
                Box(Modifier.fillMaxWidth().height(1.dp).background(Rove.c.line))
                ActionRow(stringResource(R.string.board_open_task), task.engine?.name?.lowercase(), onClick = openTask)
            }
        }
    }
}

@Composable private fun EventsSection(events: EventsState) {
    FormSection(stringResource(R.string.board_events)) {
        when (events) {
            EventsState.Loading -> BrailleSpinner(13)
            is EventsState.Failed -> ErrorLine(events.message)
            is EventsState.Loaded -> if (events.rows.isEmpty()) {
                EmptyState(stringResource(R.string.board_no_events), stringResource(R.string.board_no_events_hint))
            } else Column(Modifier.fillMaxWidth().tile().padding(horizontal = 14.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                events.rows.forEach { row ->
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(EventRowFormat.age(row.at, events.atMs), color = Rove.c.muted, style = Rove.mono(12))
                        Text(row.kind, color = Rove.c.ink, maxLines = 1, style = Rove.mono(12))
                        if (row.tail.isNotEmpty()) Text("· ${row.tail}", Modifier.weight(1f, fill = false), color = Rove.c.muted, maxLines = 1,
                            overflow = TextOverflow.Ellipsis, style = Rove.mono(12))
                    }
                }
            }
        }
    }
}

@Composable private fun StartButton(label: String, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().height(52.dp).clip(RoundedCornerShape(Rove.radius)).pressable(onClick = onClick).tile()
        .padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f), color = Rove.c.accent, style = Rove.mono(15, FontWeight.Medium))
        Text(stringResource(R.string.board_arrow), color = Rove.c.accent, style = Rove.mono(15, FontWeight.Medium))
    }
}

/** iOS `DeleteStorySheet`, `issue.delete`: states what is and is not removed before anything changes. */
@Composable private fun DeleteStorySheet(model: AppModel, repo: String, story: Story, dismiss: () -> Unit, deleted: () -> Unit) {
    val scope = rememberCoroutineScope()
    val fallback = stringResource(R.string.board_request_failed)
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    fun run() {
        busy = true; error = null
        scope.launch {
            try {
                model.repository.issueDelete(repo, story.id)
                deleted()
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) { error = e.boardMessage(fallback) }
            finally { busy = false }
        }
    }

    SheetScaffold(title = stringResource(R.string.board_delete_title), onDismiss = { if (!busy) dismiss() }, kicker = "#${story.id}",
        error = error, primary = {
            PrimaryBar(stringResource(R.string.board_delete_story), destructive = true, busy = busy, onClick = ::run)
        }) {
        Text(stringResource(R.string.board_delete_body), color = Rove.c.ink, style = Rove.face(16))
    }
}
