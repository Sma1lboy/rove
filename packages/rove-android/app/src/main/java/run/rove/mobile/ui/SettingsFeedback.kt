package run.rove.mobile.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import run.rove.mobile.R
import run.rove.mobile.data.sendFeedback

private const val TITLE_MAX = 200
private const val MESSAGE_MAX = 10_000

private class Sent(val url: String?)

/** A public GitHub Discussion in the rove repo, posted from the mac's `gh` login. */
@Composable fun FeedbackSettings(model: AppModel, back: () -> Unit) {
    var title by rememberSaveable { mutableStateOf("") }
    var message by rememberSaveable { mutableStateOf("") }
    var confirming by remember { mutableStateOf(false) }
    var sent by remember { mutableStateOf<Sent?>(null) }
    val ready = title.isNotBlank() && message.isNotBlank() && title.length <= TITLE_MAX && message.length <= MESSAGE_MAX

    SettingsPage(stringResource(R.string.settings_feedback), back) {
        val done = sent
        if (done != null) SentState(done) { title = ""; message = ""; sent = null }
        else {
            FormSection(stringResource(R.string.settings_feedback_title), "${title.length}/$TITLE_MAX") {
                FieldBox(title, { title = it }, stringResource(R.string.settings_feedback_title_placeholder))
            }
            FormSection(stringResource(R.string.settings_feedback_message), "${message.length}/$MESSAGE_MAX") {
                PromptEditor(message, { message = it }, stringResource(R.string.settings_feedback_message_placeholder), minHeight = 160.dp)
            }
            Hint(stringResource(R.string.settings_feedback_hint))
            PrimaryBar(stringResource(R.string.settings_feedback_send), enabled = ready) { confirming = true }
        }
    }
    if (confirming) SettingsConfirmSheet(stringResource(R.string.settings_feedback_confirm_title), stringResource(R.string.settings_feedback),
        stringResource(R.string.settings_feedback_confirm_prose), stringResource(R.string.settings_feedback_post), { confirming = false },
        run = { sent = Sent(model.repository.sendFeedback(title.trim(), message)) })
}

@Composable private fun SentState(result: Sent, again: () -> Unit) {
    val uri = LocalUriHandler.current
    Column(Modifier.fillMaxWidth().tile().padding(14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(stringResource(R.string.settings_feedback_sent), color = Rove.c.success, style = Rove.mono(14, FontWeight.Bold))
        result.url?.let { url ->
            Text(url, Modifier.pressable { runCatching { uri.openUri(url) } }, color = Rove.c.accent, style = Rove.mono(12))
        }
        TileLabel(stringResource(R.string.settings_feedback_again), onClick = again)
    }
}
