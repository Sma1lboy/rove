package run.rove.mobile.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.serialization.json.decodeFromJsonElement
import run.rove.mobile.domain.FieldNote
import run.rove.mobile.domain.NotesResult

/** `direction`: `up`, `down` or `top` (a project moves by moving its `main` task). */
suspend fun RoveRepository.moveTask(taskId: String, direction: String) {
    bridge.request("task.move", args("taskId" to taskId, "direction" to direction))
}

suspend fun RoveRepository.forgetProject(repo: String) { bridge.request("project.forget", args("repo" to repo)) }

/** The daemon's own newest-first order. */
suspend fun RoveRepository.fieldNotes(repo: String): List<FieldNote> =
    wireJson.decodeFromJsonElement<NotesResult>(bridge.request("notes.list", args("repo" to repo))).notes

suspend fun RoveRepository.deleteNote(repo: String, id: Int) { bridge.request("notes.delete", args("repo" to repo, "id" to id)) }

/** Task id → its tabs' titles, one `task.tabs` per task concurrently; a task whose read fails keeps no titles (iOS `loadTabTitles`). */
suspend fun RoveRepository.tabTitles(taskIds: List<String>): Map<String, List<String>> = coroutineScope {
    taskIds.map { id ->
        async {
            try { id to tabs(id).map { it.displayTitle } }
            catch (e: CancellationException) { throw e }
            catch (_: Exception) { null }
        }
    }.awaitAll().filterNotNull().toMap()
}
