package run.rove.mobile.data

import kotlinx.serialization.json.decodeFromJsonElement
import run.rove.mobile.domain.*

// Routine bridge operations (docs/IOS.md "Board, routines, GitHub issues and settings ops").

suspend fun RoveRepository.routines(): RoutinesPayload =
    wireJson.decodeFromJsonElement(bridge.request("routine.list"))

suspend fun RoveRepository.routineRuns(id: String): List<RoutineRun> =
    wireJson.decodeFromJsonElement<RoutineRunsPayload>(bridge.request("routine.runs", args("id" to id))).runs

suspend fun RoveRepository.createRoutine(repo: String, name: String, prompt: String, schedule: String): Routine =
    wireJson.decodeFromJsonElement<RoutineCreateResult>(bridge.request("routine.create",
        args("repo" to repo, "name" to name, "prompt" to prompt, "schedule" to schedule))).automation

/** [changes] holds only the fields that differ: `name`, `prompt`, `schedule`. */
suspend fun RoveRepository.updateRoutine(id: String, changes: Map<String, String>) {
    bridge.request("routine.update", args("id" to id, *changes.map { it.key to it.value as Any }.toTypedArray()))
}

suspend fun RoveRepository.setRoutineEnabled(id: String, enabled: Boolean) {
    bridge.request("routine.setEnabled", args("id" to id, "enabled" to enabled))
}

suspend fun RoveRepository.runRoutineNow(id: String) { bridge.request("routine.runNow", args("id" to id)) }

suspend fun RoveRepository.deleteRoutine(id: String) { bridge.request("routine.delete", args("id" to id)) }
