package run.rove.mobile.data

import android.content.Context
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.decodeFromJsonElement
import run.rove.mobile.domain.*

// Typed bridge reads and writes for the Settings screens, so Compose never builds or decodes wire JSON.

suspend fun RoveRepository.helloInfo(): HelloInfo = wireJson.decodeFromJsonElement(bridge.request("hello"))
suspend fun RoveRepository.usageGet(): UsagePayload = wireJson.decodeFromJsonElement(bridge.request("usage.get"))
suspend fun RoveRepository.daemonInfo(): DaemonInfo = wireJson.decodeFromJsonElement(bridge.request("daemon.info"))

suspend fun RoveRepository.repoDigest(repo: String, sinceDays: Int): DigestResult =
    wireJson.decodeFromJsonElement(bridge.request("repo.digest", args("repo" to repo, "sinceDays" to sinceDays)))

suspend fun RoveRepository.turnsList(repo: String, sinceDays: Int, limit: Int = 50): TurnsResult =
    wireJson.decodeFromJsonElement(bridge.request("turns.list", args("repo" to repo, "sinceDays" to sinceDays, "limit" to limit)))

/** Posts a public GitHub Discussion; returns its URL when the reply carries one (the reply is otherwise arbitrary JSON). */
suspend fun RoveRepository.sendFeedback(title: String, body: String): String? =
    (bridge.request("feedback.send", args("title" to title, "body" to body))["url"] as? JsonPrimitive)?.contentOrNull

/** One bridge read as a [Result]: a timeout is a failure to show, real cancellation still propagates. */
suspend fun <T> settingsCatching(block: suspend () -> T): Result<T> = try {
    Result.success(block())
} catch (e: TimeoutCancellationException) {
    Result.failure(e)
} catch (e: CancellationException) {
    throw e
} catch (e: Exception) {
    Result.failure(e)
}

fun <T> Result<T>.toLoad(): SettingsLoad<T> =
    fold({ SettingsLoad.Loaded(it) }, { SettingsLoad.Failed(it.message ?: it.toString()) })

/**
 * The in-app notification switch (iOS `NotificationPrefs`): local to this phone. `Notifier.post` should return early
 * when `enabled(context)` is false, so turning it off silences banners without touching the Mac.
 */
object NotificationPrefs {
    private const val FILE = "rove.settings"
    private const val KEY = "notifications.enabled"
    private const val ASKED = "notifications.asked"

    private fun prefs(context: Context) = context.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    /** On by default; only a stored `false` turns it off. */
    fun enabled(context: Context) = prefs(context).getBoolean(KEY, true)
    fun setEnabled(context: Context, value: Boolean) = prefs(context).edit().putBoolean(KEY, value).apply()

    /** Whether the system permission dialog was ever shown: Android cannot tell "never asked" from "denied". */
    fun asked(context: Context) = prefs(context).getBoolean(ASKED, false)
    fun markAsked(context: Context) = prefs(context).edit().putBoolean(ASKED, true).apply()
}
