package run.rove.mobile.ui

import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import run.rove.mobile.R
import run.rove.mobile.data.BoardPrefs
import run.rove.mobile.data.startStory
import run.rove.mobile.domain.*

/**
 * iOS `StartSessionSheet`: engine, where and after for one story session. Choices are remembered on this phone.
 * [saveEdits] runs first so the prompt is built from what is on screen.
 */
@Composable fun StartStorySheet(model: AppModel, repo: String, story: Story, unsaved: Boolean, saveEdits: suspend () -> Unit,
                                dismiss: () -> Unit, finished: (StartOutcome) -> Unit) {
    val context = LocalContext.current
    val prefs = remember { BoardPrefs(context) }
    val scope = rememberCoroutineScope()
    val fallback = stringResource(R.string.board_request_failed)
    var engines by remember { mutableStateOf<List<Engine>>(emptyList()) }
    var engine by remember { mutableStateOf("") }
    var placement by remember { mutableStateOf(prefs.placement) }
    var after by remember { mutableStateOf(prefs.follow) }
    var loading by remember { mutableStateOf(true) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val label = stringResource(if (story.linked) R.string.board_start_another else R.string.board_start_session)

    LaunchedEffect(Unit) {
        try {
            engines = model.repository.engines()
            if (engine.isEmpty()) engine = prefs.engine.takeIf { last -> engines.any { it.id == last } } ?: engines.firstOrNull()?.id.orEmpty()
        } catch (e: CancellationException) { throw e }
        catch (e: Exception) { error = e.boardMessage(fallback) }
        loading = false
    }

    fun submit() {
        busy = true; error = null
        scope.launch {
            try {
                saveEdits()
                val outcome = model.repository.startStory(repo, story, engine, placement, after == StartFollow.Follow)
                prefs.engine = engine
                finished(outcome)
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) { error = e.boardMessage(fallback) }
            finally { busy = false }
        }
    }

    val where = mapOf(StartPlacement.Worktree to stringResource(R.string.board_where_worktree),
        StartPlacement.Project to stringResource(R.string.board_where_project))
    val whereHint = stringResource(if (placement == StartPlacement.Worktree) R.string.board_where_worktree_hint else R.string.board_where_project_hint)
    val follows = mapOf(StartFollow.Follow to stringResource(R.string.board_after_follow),
        StartFollow.Stay to stringResource(R.string.board_after_stay))
    val afterHint = stringResource(if (after == StartFollow.Follow) R.string.board_after_follow_hint else R.string.board_after_stay_hint)

    SheetScaffold(title = label, onDismiss = { if (!busy) dismiss() }, kicker = "#${story.id}", error = error,
        primary = { PrimaryBar(label, enabled = !loading, busy = busy, onClick = ::submit) }) {
        Text(story.title, color = Rove.c.ink, style = Rove.face(16))
        FormSection(stringResource(R.string.board_field_engine)) {
            when {
                loading -> BrailleSpinner(13)
                engines.isEmpty() -> Hint(stringResource(R.string.board_no_engines))
                else -> BoardTiles(engines.map { it.id }, engine, { id -> engines.first { it.id == id }.name.lowercase() }) { engine = it }
            }
        }
        FormSection(stringResource(R.string.board_field_where)) {
            ChoiceTiles(StartPlacement.entries, placement, { where.getValue(it) }) { placement = it; prefs.placement = it }
            Hint(whereHint)
        }
        FormSection(stringResource(R.string.board_field_after)) {
            ChoiceTiles(StartFollow.entries, after, { follows.getValue(it) }) { after = it; prefs.follow = it }
            Hint(afterHint)
        }
        if (unsaved) Hint(stringResource(R.string.board_unsaved_hint))
    }
}
