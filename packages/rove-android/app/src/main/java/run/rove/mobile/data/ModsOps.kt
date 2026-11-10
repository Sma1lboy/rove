package run.rove.mobile.data

import kotlinx.serialization.json.decodeFromJsonElement
import run.rove.mobile.domain.*

// First-party mods (docs/IOS.md table): installing one runs nothing on the Mac, so the phone may do it.

suspend fun RoveRepository.builtinMods(): List<BuiltinMod> =
    wireJson.decodeFromJsonElement<BuiltinModsPayload>(bridge.request("builtinMods.list")).mods

suspend fun RoveRepository.setBuiltinModInstalled(id: String, installed: Boolean) {
    bridge.request("builtinMod.setInstalled", args("id" to id, "installed" to installed))
}
