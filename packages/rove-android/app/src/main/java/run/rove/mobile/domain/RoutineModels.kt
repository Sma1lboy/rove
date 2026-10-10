package run.rove.mobile.domain

import kotlinx.serialization.Serializable
import java.time.Instant
import java.time.OffsetDateTime

// Wire models and pure logic for the Routines page (iOS PagesModels.swift, routine part). Every optional field
// decodes to a default or null, so an older or newer bridge never fails a whole list.

@Serializable data class RoutinePrecheck(val command: String = "", val timeoutSeconds: Int? = null)

@Serializable data class RoutineRunResponse(val text: String = "", val at: String? = null)

@Serializable data class Routine(
    val id: String,
    val name: String = id,
    val repo: String = "",
    val prompt: String = "",
    val schedule: String = "",
    val enabled: Boolean = true,
    val nextRunAt: String? = null,
    val baseRef: String? = null,
    val precheck: RoutinePrecheck? = null,
    val persistentSession: Boolean = false,
) {
    val repoName get() = repo.trimEnd('/').substringAfterLast('/')
}

@Serializable data class RoutinesPayload(
    val automations: List<Routine> = emptyList(),
    /** Latest run status per routine id, when the daemon sends it. */
    val lastRunStatus: Map<String, String> = emptyMap(),
    val keepsDaemonAlive: Boolean = false,
)

@Serializable data class RoutineCreateResult(val automation: Routine)

@Serializable data class RoutineRun(
    val id: String,
    val runNumber: Int = 0,
    val status: String = "unknown",
    val trigger: String = "scheduled",
    val at: String = "",
    val taskId: String? = null,
    val error: String? = null,
    val response: RoutineRunResponse? = null,
)

@Serializable data class RoutineRunsPayload(val runs: List<RoutineRun> = emptyList())

object RoutineLogic {
    enum class Tone { Success, Muted, Warning, Error }

    const val NAME_MAX = 120
    const val PROMPT_MAX = 20_000

    /** The "didn't run" reasons stay distinct: `skipped_precheck` is healthy, `dispatch_failed` wants a human. */
    fun tone(status: String) = when (status) {
        "dispatched", "revived" -> Tone.Success
        "skipped_missed", "skipped_unavailable" -> Tone.Warning
        "dispatch_failed" -> Tone.Error
        else -> Tone.Muted
    }

    fun instant(iso: String?): Instant? = iso?.takeIf { it.isNotEmpty() }?.let { runCatching { OffsetDateTime.parse(it).toInstant() }.getOrNull() }

    /** Milliseconds until [iso]; zero or less means it is due, null means there is no time. */
    fun untilMs(iso: String?, now: Instant): Long? = instant(iso)?.let { it.toEpochMilli() - now.toEpochMilli() }

    /** Milliseconds since [iso], never negative; null without a time. */
    fun agoMs(iso: String?, now: Instant): Long? = instant(iso)?.let { maxOf(0L, now.toEpochMilli() - it.toEpochMilli()) }

    /** Five space-separated cron fields: the bridge refuses anything else, so refuse it here first. */
    fun validSchedule(text: String): Boolean {
        val fields = text.trim().split(' ').filter { it.isNotEmpty() }
        return fields.size == 5 && fields.all { f -> f.all { it in ALLOWED } }
    }

    fun normalizeSchedule(text: String) = text.split(' ', '\t', '\n').filter { it.isNotEmpty() }.joinToString(" ")

    /** Edit mode sends only what differs from the saved routine. */
    fun changes(saved: Routine, name: String, prompt: String, schedule: String): Map<String, String> = buildMap {
        if (name.trim() != saved.name.trim()) put("name", name.trim())
        if (prompt.trim() != saved.prompt.trim()) put("prompt", prompt.trim())
        if (normalizeSchedule(schedule) != normalizeSchedule(saved.schedule)) put("schedule", normalizeSchedule(schedule))
    }

    /** Lengths are counted in UTF-16 units, as the bridge's JS caps do. */
    fun nameTooLong(name: String) = name.trim().length > NAME_MAX
    fun promptTooLong(prompt: String) = prompt.trim().length > PROMPT_MAX

    private val ALLOWED = ("0123456789*/,-?#" + "abcdefghijklmnopqrstuvwxyz" + "ABCDEFGHIJKLMNOPQRSTUVWXYZ").toSet()
}
