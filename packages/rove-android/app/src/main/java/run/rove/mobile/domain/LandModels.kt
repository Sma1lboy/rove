package run.rove.mobile.domain

import kotlinx.serialization.Serializable

/** `task.landPreflight`: where the branch would land and how many commits, or why it cannot. */
@Serializable data class LandPreflight(val landedOn: String = "", val ahead: Int? = null, val refusal: String? = null, val message: String? = null)

object LandLogic {
    const val DIRTY_BASE = "MAIN_CHECKOUT_DIRTY"

    /** Never invent a count: `?` when git printed a non-number. */
    fun commits(probe: LandPreflight) = probe.ahead?.toString() ?: "?"
}
