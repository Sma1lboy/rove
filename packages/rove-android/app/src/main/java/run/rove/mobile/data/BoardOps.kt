package run.rove.mobile.data

import android.content.Context
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.jsonPrimitive
import run.rove.mobile.domain.*

// iOS Pages/BoardView.swift (`BoardModel`) and StartSessionSheet.swift (`SessionStarter`) as typed bridge ops.

suspend fun RoveRepository.issueRepos(): List<String> =
    wireJson.decodeFromJsonElement<IssueRepos>(bridge.request("issue.repos")).repos

suspend fun RoveRepository.issueList(repo: String): RepoIssues =
    wireJson.decodeFromJsonElement(bridge.request("issue.list", args("repo" to repo)))

suspend fun RoveRepository.issueCreate(repo: String, title: String, body: String?) {
    val pairs = mutableListOf<Pair<String, Any>>("repo" to repo, "title" to title)
    if (!body.isNullOrEmpty()) pairs += "body" to body
    bridge.request("issue.create", args(*pairs.toTypedArray()))
}

suspend fun RoveRepository.issueUpdate(repo: String, id: Int, update: StoryUpdate) {
    val pairs = mutableListOf<Pair<String, Any>>("repo" to repo, "id" to id)
    update.title?.let { pairs += "title" to it }
    update.body?.let { pairs += "body" to it }
    if (update.clearBody) pairs += "clearBody" to true
    bridge.request("issue.update", args(*pairs.toTypedArray()))
}

suspend fun RoveRepository.issueLink(repo: String, id: Int, taskId: String) {
    bridge.request("issue.update", args("repo" to repo, "id" to id, "task" to taskId))
}

suspend fun RoveRepository.issueSetStatus(repo: String, id: Int, status: IssueStatus) {
    bridge.request("issue.setStatus", args("repo" to repo, "id" to id, "status" to status.wire))
}

suspend fun RoveRepository.issueDelete(repo: String, id: Int) {
    bridge.request("issue.delete", args("repo" to repo, "id" to id))
}

suspend fun RoveRepository.taskEvents(taskId: String): List<TaskEvent> =
    wireJson.decodeFromJsonElement<TaskEvents>(bridge.request("task.events", args("taskId" to taskId))).events

/**
 * The TUI's "start session" as bridge atoms. A failure before the session exists throws; the link and status steps
 * afterwards are best-effort and report into the outcome's warnings.
 */
suspend fun RoveRepository.startStory(repo: String, story: Story, engine: String, placement: StartPlacement, follow: Boolean): StartOutcome {
    val id = story.id
    val drafted = wireJson.decodeFromJsonElement<IssuePrompt>(
        bridge.request("issue.prompt", args("repo" to repo, "id" to id, "where" to placement.wire)))
    val warnings = mutableListOf<StartWarning>()
    suspend fun attempt(step: StartStep, block: suspend () -> Unit) {
        try { block() } catch (e: CancellationException) { throw e }
        catch (e: Exception) { warnings += StartWarning(step, id, e.message.orEmpty()) }
    }
    val openTaskId: String
    when (placement) {
        StartPlacement.Worktree -> {
            val pairs = mutableListOf<Pair<String, Any>>("repo" to repo, "prompt" to drafted.prompt, "title" to drafted.title)
            if (engine.isNotEmpty()) pairs += "engine" to engine
            openTaskId = bridge.request("task.create", args(*pairs.toTypedArray())).taskId()
            attempt(StartStep.Link) { issueLink(repo, id, openTaskId) }
        }
        StartPlacement.Project -> {
            val main = bridge.request("task.openMain", args("repo" to repo)).taskId()
            val pairs = mutableListOf<Pair<String, Any>>("taskId" to main, "prompt" to drafted.prompt)
            if (engine.isNotEmpty()) pairs += "engine" to engine
            bridge.request("tab.new", args(*pairs.toTypedArray()))
            openTaskId = main
        }
    }
    attempt(StartStep.MarkDoing) { issueSetStatus(repo, id, IssueStatus.Doing) }
    return StartOutcome(id, openTaskId, follow, warnings)
}

private fun kotlinx.serialization.json.JsonObject.taskId() =
    this["taskId"]?.jsonPrimitive?.content ?: throw BridgeFailure("BAD_REPLY", "Missing taskId")

/** The board's remembered choices on this phone (iOS `@AppStorage` `board.*`). */
class BoardPrefs(context: Context) {
    private val store = context.getSharedPreferences("board", Context.MODE_PRIVATE)

    var repo: String
        get() = store.getString("board.repo", "").orEmpty()
        set(value) { store.edit().putString("board.repo", value).apply() }
    var engine: String
        get() = store.getString("board.start.engine", "").orEmpty()
        set(value) { store.edit().putString("board.start.engine", value).apply() }
    var placement: StartPlacement
        get() = StartPlacement.of(store.getString("board.start.where", "").orEmpty())
        set(value) { store.edit().putString("board.start.where", value.wire).apply() }
    var follow: StartFollow
        get() = StartFollow.of(store.getString("board.start.after", "").orEmpty())
        set(value) { store.edit().putString("board.start.after", value.wire).apply() }
}
