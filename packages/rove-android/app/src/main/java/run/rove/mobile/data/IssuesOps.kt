package run.rove.mobile.data

import kotlinx.serialization.json.*
import run.rove.mobile.domain.*

// GitHub issues ops (`gh` on the mac, read-only) and the task started from one.

/** Open issues of [repo]; [refresh] bypasses the daemon's 60s cache. */
suspend fun RoveRepository.workItems(repo: String, mine: Boolean, refresh: Boolean): List<WorkItem> {
    val request: JsonObject = buildJsonObject {
        put("repo", repo); put("state", "open"); put("limit", 50)
        if (mine) put("assignee", "@me")
        if (refresh) put("refresh", true)
    }
    return wireJson.decodeFromJsonElement<WorkItemsPayload>(bridge.request("workitem.list", request)).items
}

suspend fun RoveRepository.workItemLinks(repo: String): List<WorkItemLink> =
    wireJson.decodeFromJsonElement<WorkItemLinksPayload>(bridge.request("workitem.links", args("repo" to repo))).links

/** The new task's id; [engine] null leaves the choice to the mac. */
suspend fun RoveRepository.startWorkItem(repo: String, number: Int, engine: String?): String {
    val request = buildJsonObject {
        put("repo", repo); put("number", number)
        if (engine != null) put("engine", engine)
    }
    return wireJson.decodeFromJsonElement<WorkItemStartResult>(bridge.request("workitem.start", request)).taskId
}

/** Only built-in engines: `workitem.start` takes built-in vendors. */
suspend fun RoveRepository.builtinEngines(): List<IssueEngine> =
    wireJson.decodeFromJsonElement<IssueEnginesPayload>(bridge.request("engines.list")).engines.filter { it.builtin }
