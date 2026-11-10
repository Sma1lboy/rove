package run.rove.mobile

import org.junit.Assert.assertEquals
import kotlinx.serialization.decodeFromString
import org.junit.Test
import run.rove.mobile.data.wireJson
import run.rove.mobile.domain.*
import run.rove.mobile.ui.Route
import run.rove.mobile.ui.allows

/** The Board and GitHub issues pages follow the Mac's first-party mods (iOS `PagesTests`). */
class ModsTest {
    @Test fun gateHidesUntilAnsweredShowsAllForAnOlderMacAndFollowsInstalls() {
        val payload = wireJson.decodeFromString<BuiltinModsPayload>(
            """{"mods":[{"id":"kanban","name":"Kanban","description":"","installed":true},{"id":"issues","name":"Issues","installed":false}]}""")
        val loaded = ModGate.Loaded(payload.mods)
        assertEquals(listOf(false, true), listOf(ModGate.Pending.shows("kanban"), ModGate.Legacy.shows("issues")))
        assertEquals(listOf(true, false), listOf(loaded.shows("kanban"), loaded.shows("issues")))
        assertEquals(listOf(Route.Board, Route.Routines, Route.Settings),
            listOf(Route.Board, Route.Issues, Route.Routines, Route.Settings).filter(loaded::allows))
    }
}
