package run.rove.mobile.ui

import androidx.compose.runtime.*
import androidx.compose.ui.res.stringResource
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import run.rove.mobile.R
import run.rove.mobile.data.issueCreate
import run.rove.mobile.domain.BoardCardLogic

/** iOS `NewStorySheet` (`rove api issue-create`): a title and an optional description, filed into the project's backlog. */
@Composable fun NewStorySheet(model: AppModel, repo: String, dismiss: () -> Unit, created: () -> Unit) {
    val scope = rememberCoroutineScope()
    val fallback = stringResource(R.string.board_request_failed)
    var title by remember { mutableStateOf("") }
    var detail by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    fun create() {
        busy = true; error = null
        scope.launch {
            try {
                model.repository.issueCreate(repo, title.trim(), detail.trim())
                dismiss(); created()
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) { error = e.boardMessage(fallback) }
            finally { busy = false }
        }
    }

    SheetScaffold(title = stringResource(R.string.board_new_story), onDismiss = { if (!busy) dismiss() },
        kicker = BoardCardLogic.baseName(repo), error = error,
        primary = {
            PrimaryBar(stringResource(R.string.board_file_story), enabled = title.isNotBlank(), busy = busy, onClick = ::create)
        }) {
        FormSection(stringResource(R.string.board_field_title)) {
            FieldBox(title, { title = it }, stringResource(R.string.board_title_placeholder))
        }
        FormSection(stringResource(R.string.board_field_description)) {
            PromptEditor(detail, { detail = it }, stringResource(R.string.board_description_optional))
        }
        Hint(stringResource(R.string.board_new_hint))
    }
}
