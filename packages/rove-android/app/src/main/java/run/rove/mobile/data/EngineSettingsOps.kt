package run.rove.mobile.data

import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.decodeFromJsonElement
import run.rove.mobile.domain.*

// Typed ops for Settings → Engines / Plugins and the task engine history (docs/IOS.md tables).

suspend fun RoveRepository.engineSettings(): EnginesSettingsPayload =
    wireJson.decodeFromJsonElement(bridge.request("engines.settings"))

// The four engine writes are destructive in the bridge; the caller confirms first.
suspend fun RoveRepository.setEngineEnabled(id: String, enabled: Boolean) {
    bridge.request("engine.setEnabled", args("id" to id, "enabled" to enabled))
}
suspend fun RoveRepository.setEngineDefault(id: String) { bridge.request("engine.setDefault", args("id" to id)) }
/** A blank [name] clears the override. */
suspend fun RoveRepository.renameEngine(id: String, name: String) { bridge.request("engine.rename", args("id" to id, "name" to name)) }
suspend fun RoveRepository.resetEngine(id: String) { bridge.request("engine.reset", args("id" to id)) }

suspend fun RoveRepository.pluginList(): PluginsPayload = wireJson.decodeFromJsonElement(bridge.request("plugins.list"))
suspend fun RoveRepository.setPluginEnabled(id: String, enabled: Boolean) {
    bridge.request("plugin.setEnabled", args("id" to id, "enabled" to enabled))
}

suspend fun RoveRepository.readOutput(taskId: String, limit: Int, cursor: String? = null): OutputEnvelope {
    val pairs = listOfNotNull("taskId" to taskId as Any, "limit" to limit as Any, cursor?.let { "cursor" to it as Any })
    return wireJson.decodeFromJsonElement(bridge.request("output.read", args(*pairs.toTypedArray())))
}

/** Runs a bridge read for a settings screen; failures become the message the screen shows. */
suspend fun <T> engineSettingsCall(fallback: String, block: suspend () -> T): Result<T> = try {
    Result.success(block())
} catch (e: CancellationException) {
    throw e
} catch (e: Exception) {
    Result.failure(Exception(e.message?.takeIf { it.isNotBlank() } ?: fallback))
}
