package run.rove.mobile.domain

import kotlinx.serialization.Serializable

/** A first-party mod the Mac ships (Kanban, Issues), as `builtinMods.list` reports it (iOS `BuiltinMod`). */
@Serializable data class BuiltinMod(val id: String, val name: String = id, val description: String = "", val installed: Boolean = false)

@Serializable data class BuiltinModsPayload(val mods: List<BuiltinMod> = emptyList())

/** Which gated pages the Pages menu may offer: the Board needs `kanban`, GitHub issues needs `issues` (iOS `ModGate`). */
sealed interface ModGate {
    /** Not answered yet: the gated pages stay hidden rather than flash in. */
    data object Pending : ModGate
    /** A Mac too old for the op: every page shows, as before mods existed. */
    data object Legacy : ModGate
    data class Loaded(val mods: List<BuiltinMod>) : ModGate

    fun shows(id: String): Boolean = when (this) {
        Pending -> false
        Legacy -> true
        is Loaded -> mods.any { it.id == id && it.installed }
    }

    val loaded: List<BuiltinMod> get() = (this as? Loaded)?.mods.orEmpty()
}
