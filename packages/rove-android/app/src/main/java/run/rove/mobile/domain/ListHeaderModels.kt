package run.rove.mobile.domain

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull

/** One field note (`notes.list`); `at` is an ISO string or an epoch number depending on the daemon. */
@Serializable data class FieldNote(val id: Int, val text: String = "", val at: JsonElement? = null) {
    /** `at` as display text, whichever shape the daemon sent. */
    val stamp: String? get() = (at as? JsonPrimitive)?.let { p ->
        if (p.isString) p.content else p.doubleOrNull?.toLong()?.toString()
    }?.takeIf { it.isNotEmpty() && it != "null" }

    /** `#3 · 2026-07-01T…` — the id, then the stamp when there is one (iOS `noteTile` footer). */
    val footer get() = listOfNotNull("#$id", stamp).joinToString(" · ")
}

@Serializable data class NotesResult(val notes: List<FieldNote> = emptyList())
