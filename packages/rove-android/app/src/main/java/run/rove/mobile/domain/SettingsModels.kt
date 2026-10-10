package run.rove.mobile.domain

import kotlinx.serialization.Serializable
import java.time.Instant
import java.time.ZoneId
import java.util.Locale

// Wire models and pure logic for Settings (iOS `SettingsModels.swift`): usage meters, the daemon build notice, and
// the agent-insight reads. Every field has a default so an older or newer bridge never fails a whole screen.

/** A loadable value: three visible states for every network read. */
sealed interface SettingsLoad<out T> {
    val value: T?
    data object Loading : SettingsLoad<Nothing> { override val value: Nothing? = null }
    data class Loaded<out T>(override val value: T) : SettingsLoad<T>
    data class Failed(val message: String) : SettingsLoad<Nothing> { override val value: Nothing? = null }
}

@Serializable data class HelloInfo(val roveVersion: String = "", val host: String = "")

@Serializable data class UsageWindow(val kind: String = "", val label: String? = null, val percent: Int = 0,
                                     /** Epoch ms the window resets, or null when the engine did not say. */
                                     val resetsAt: Double? = null) {
    val display get() = label ?: kind
}

@Serializable data class UsageVendor(val vendor: String, val name: String? = null, val capturedAt: Double = 0.0,
                                     val windows: List<UsageWindow> = emptyList()) {
    val displayName get() = name ?: vendor
}

/** `usage` is null until the daemon has sent a first snapshot, and empty when no engine reports quota. */
@Serializable data class UsagePayload(val usage: List<UsageVendor>? = null)

enum class UsageTone {
    Ok, Warn, Crit;

    companion object {
        /** 75% and 95% are the TUI's thresholds (`usage-core.ts`). */
        fun of(percent: Int) = if (percent >= 95) Crit else if (percent >= 75) Warn else Ok
    }
}

object UsageLogic {
    /** Compact local reset stamp: within 24h just the clock (`→ 14:00`), beyond that day and clock (`→ 7/30 14:00`). */
    fun resetText(resetsAt: Double?, nowMs: Long, zone: ZoneId = ZoneId.systemDefault()): String {
        if (resetsAt == null || resetsAt <= nowMs) return ""
        val at = Instant.ofEpochMilli(resetsAt.toLong()).atZone(zone)
        val clock = String.format(Locale.ROOT, "%02d:%02d", at.hour, at.minute)
        return if (resetsAt - nowMs < 24 * 3600 * 1000.0) "→ $clock" else "→ ${at.monthValue}/${at.dayOfMonth} $clock"
    }

    /** The tightest window of a vendor, for a one-line summary. */
    fun worst(vendor: UsageVendor) = vendor.windows.maxByOrNull { it.percent }

    /** The vendor closest to its limit as `claude 97` (lowercased name, percent), or null without any window. */
    fun tightest(vendors: List<UsageVendor>): Pair<String, Int>? {
        var best: Pair<String, Int>? = null
        for (vendor in vendors) {
            val w = worst(vendor) ?: continue
            if (best == null || w.percent > best.second) best = vendor.displayName.lowercase() to w.percent
        }
        return best
    }
}

@Serializable data class DaemonInfo(val daemonVersion: String? = null, val bridgeVersion: String? = null,
                                    val stale: Boolean = false, val uptimeMs: Double? = null, val taskCount: Int? = null)

@Serializable data class DigestTasks(val total: Int = 0)
@Serializable data class DigestRoutines(val runs: Int = 0, val byStatus: Map<String, Int> = emptyMap())
@Serializable data class DigestResult(val repo: String = "", val tasks: DigestTasks = DigestTasks(),
                                      val routines: DigestRoutines = DigestRoutines())

@Serializable data class TurnTotals(val turns: Int = 0, val inputTokens: Int = 0, val outputTokens: Int = 0,
                                    val cacheReadTokens: Int = 0, val cacheCreationTokens: Int = 0,
                                    val durationMs: Double = 0.0, val byModel: Map<String, Int> = emptyMap())

@Serializable data class TurnRecord(val id: String, val taskId: String? = null, val vendor: String? = null,
                                    val model: String? = null, val startedAt: Double = 0.0, val endedAt: Double = 0.0) {
    val durationMs get() = maxOf(0.0, endedAt - startedAt)
}

@Serializable data class TurnsResult(val totals: TurnTotals = TurnTotals(), val turns: List<TurnRecord> = emptyList())

enum class StatusTone { Success, Muted, Warning, Error }

object SettingsFormat {
    /** `5s`, `5m`, `3h`, `2d` since an epoch-ms stamp; empty when the stamp is missing. */
    fun age(sinceMs: Double, nowMs: Long): String = if (sinceMs > 0) TaskAge.label(maxOf(0.0, nowMs - sinceMs)) else ""

    /** `1.2k`, `48k`, `3.4m`: token counts as the stats screen prints them. */
    fun compact(n: Int): String = when {
        n < 1_000 -> "$n"
        n < 10_000 -> String.format(Locale.ROOT, "%.1fk", n / 1_000.0)
        n < 1_000_000 -> "${n / 1_000}k"
        else -> String.format(Locale.ROOT, "%.1fm", n / 1_000_000.0)
    }

    /** `9s`, `4m07s`, `2h03m`, then days. */
    fun duration(ms: Double): String {
        val s = maxOf((ms / 1000).toLong(), 0)
        return when {
            s < 60 -> "${s}s"
            s < 3600 -> String.format(Locale.ROOT, "%dm%02ds", s / 60, s % 60)
            s < 86400 -> String.format(Locale.ROOT, "%dh%02dm", s / 3600, (s % 3600) / 60)
            else -> TaskAge.label(ms)
        }
    }

    /** Routine run statuses in the digest: green for dispatched, amber for skipped, red for failed. */
    fun statusTone(status: String) = when (status) {
        "dispatched", "revived" -> StatusTone.Success
        "skipped_missed", "skipped_unavailable" -> StatusTone.Warning
        "dispatch_failed" -> StatusTone.Error
        else -> StatusTone.Muted
    }
}

/** What the OS lets this app show; `Prompt` = the system dialog has not been shown yet. */
enum class NotificationAccess {
    Granted, Prompt, Denied;

    companion object {
        fun of(enabled: Boolean, asked: Boolean, canPrompt: Boolean) =
            if (enabled) Granted else if (canPrompt && !asked) Prompt else Denied
    }
}
