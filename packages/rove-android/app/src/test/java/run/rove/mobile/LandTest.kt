package run.rove.mobile

import kotlinx.serialization.json.decodeFromJsonElement
import org.junit.Assert.assertEquals
import org.junit.Test
import run.rove.mobile.data.wireJson
import run.rove.mobile.domain.*

class LandTest {
    private fun probe(raw: String) = wireJson.decodeFromJsonElement<LandPreflight>(wireJson.parseToJsonElement(raw))

    @Test fun readsARefusalAndACount() {
        assertEquals(LandLogic.DIRTY_BASE, probe("""{"landedOn":"main","refusal":"MAIN_CHECKOUT_DIRTY"}""").refusal)
        assertEquals("3", LandLogic.commits(probe("""{"landedOn":"main","ahead":3}""")))
    }
    @Test fun aMissingCountIsNotInvented() { assertEquals("?", LandLogic.commits(probe("""{"landedOn":"main"}"""))) }
    @Test fun aRemoteTaskCarriesItsMachine() {
        val row = wireJson.decodeFromJsonElement<TaskRow>(wireJson.parseToJsonElement("""{"id":"t","machine":{"label":"mini","alias":"m"}}"""))
        assertEquals("mini", row.machine?.label)
    }
}
