package run.rove.mobile.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.serialization.json.decodeFromJsonElement
import run.rove.mobile.domain.FieldNote
import run.rove.mobile.domain.NotesResult

/** The whole project lands before or after [target], another of this machine's projects. */
suspend fun RoveRepository.moveProject(repo: String, target: String, side: String) {
    bridge.request("project.move", args("repo" to repo, "target" to target, "side" to side))
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
