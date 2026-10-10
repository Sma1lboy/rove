package run.rove.mobile.data

import kotlinx.serialization.json.*
import run.rove.mobile.domain.*

// Typed bridge operations, so the UI layer never handles wire JSON.
class RoveRepository(val bridge: BridgeClient) {
    fun tasksPush(event: Frame.Event): Tasks? =
        if (event.name == "tasks") wireJson.decodeFromJsonElement(event.data) else null
    suspend fun subscribeTasks(): Tasks = wireJson.decodeFromJsonElement(bridge.request("tasks.subscribe"))
    suspend fun listTasks(): Tasks = wireJson.decodeFromJsonElement(bridge.request("tasks.list"))
    suspend fun engines(): List<Engine> = wireJson.decodeFromJsonElement<Engines>(bridge.request("engines.list")).engines
    suspend fun repos(): List<String> = wireJson.decodeFromJsonElement<Repos>(bridge.request("repos.list")).repos
    suspend fun tabs(taskId: String): List<TabRow> =
        wireJson.decodeFromJsonElement<Tabs>(bridge.request("task.tabs", args("taskId" to taskId))).tabs

    suspend fun createTask(repo: String, engine: String, title: String, prompt: String): String =
        bridge.request("task.create", args("repo" to repo, "engine" to engine, "title" to title, "prompt" to prompt))
            .id("taskId")
    suspend fun newTab(taskId: String, engine: String, prompt: String): String =
        bridge.request("tab.new", args("taskId" to taskId, "engine" to engine, "prompt" to prompt)).id("tabId")
    suspend fun land(taskId: String) { bridge.request("task.land", args("taskId" to taskId)) }
    // Never sends force: the bridge refuses dirty work and the phone keeps that guard.
    suspend fun delete(taskId: String) { bridge.request("task.delete", args("taskId" to taskId)) }

    suspend fun diffFiles(taskId: String): DiffFiles =
        wireJson.decodeFromJsonElement(bridge.request("diff.files", args("taskId" to taskId)))
    suspend fun diffFile(taskId: String, file: DiffFile): DiffContent = wireJson.decodeFromJsonElement(
        bridge.request("diff.file", args("taskId" to taskId, "path" to file.path, "scope" to file.scope)))

    private fun JsonObject.id(key: String) =
        this[key]?.jsonPrimitive?.content ?: throw BridgeFailure("BAD_REPLY", "Missing $key")
}
