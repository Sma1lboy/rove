package run.rove.mobile.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.text.input.TextFieldValue

internal class ComposerDraft {
    var field by mutableStateOf(TextFieldValue(""))

    suspend fun send(onSend: suspend (String) -> Boolean) {
        val submitted = field
        // Identity preserves edits even when the user returns to the submitted text.
        if (onSend(submitted.text) && field === submitted) field = TextFieldValue("")
    }
}
