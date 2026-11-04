package run.rove.mobile.domain

import kotlinx.serialization.Serializable

/** One `sessions.search` hit; every field but the task defaults so an older bridge never fails the list. */
@Serializable data class SearchHit(
    val taskId: String,
    val title: String = "",
    val tabId: String? = null,
    val role: String = "assistant",
    val at: String = "",
    val snippet: String = "",
)
@Serializable data class SearchReply(
    val matches: List<SearchHit> = emptyList(),
    val skipped: List<SearchSkip> = emptyList(),
    val truncated: Boolean = false,
)
@Serializable data class SearchSkip(val taskId: String = "", val reason: String = "")

object SearchLogic {
    const val MIN_CHARS = 2

    /** Start and end of each case-insensitive [needle] in [text], for highlighting. */
    fun matches(text: String, needle: String): List<IntRange> {
        if (needle.isEmpty()) return emptyList()
        val out = mutableListOf<IntRange>()
        var at = text.indexOf(needle, ignoreCase = true)
        while (at >= 0) {
            out += at until at + needle.length
            at = text.indexOf(needle, at + needle.length, ignoreCase = true)
        }
        return out
    }
}
