package run.rove.mobile.data

import android.content.Context
import kotlinx.serialization.builtins.ListSerializer
import run.rove.mobile.domain.InboxLogic
import run.rove.mobile.domain.Visit

/** Clear one attention episode on the Mac; a task-level episode omits the tab, a `report_missing` one is keyed by its delivery. */
suspend fun RoveRepository.dismissAttention(taskId: String, tabId: String?, deliveryId: String? = null) {
    val pairs = listOfNotNull("taskId" to taskId, tabId?.let { "tabId" to it }, deliveryId?.let { "deliveryId" to it })
    bridge.request("attention.dismiss", args(*pairs.toTypedArray()))
}

/** The phone-local visit log behind RECENT (iOS `InboxState.visits`, `UserDefaults` key `inboxVisits`). */
class InboxVisits(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("inbox", Context.MODE_PRIVATE)
    private val serializer = ListSerializer(Visit.serializer())

    fun load(): List<Visit> = prefs.getString(KEY, null)
        ?.let { runCatching { wireJson.decodeFromString(serializer, it) }.getOrNull() }.orEmpty()

    /** Folds the visit into the log and returns the new log. */
    fun record(taskId: String, tabId: String?, nowMs: Long = System.currentTimeMillis()): List<Visit> =
        InboxLogic.appending(Visit(taskId, tabId, nowMs.toDouble()), load()).also {
            prefs.edit().putString(KEY, wireJson.encodeToString(serializer, it)).apply()
        }

    private companion object { const val KEY = "inboxVisits" }
}
