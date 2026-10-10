package run.rove.mobile

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import run.rove.mobile.data.wireJson
import run.rove.mobile.domain.*

class EngineSettingsTest {
    @Test fun lastEnabledEngineCannotBeSwitchedOff() {
        val a = EngineSetting(id = "a", enabled = true)
        val b = EngineSetting(id = "b", enabled = false)
        val c = EngineSetting(id = "c", enabled = true)
        assertFalse(EngineLogic.canDisable(a, listOf(a, b)))
        assertTrue(EngineLogic.canDisable(a, listOf(a, b, c)))
    }

    @Test fun toolInputAndOutputDecodeFromAStringOrAPartList() {
        val block = wireJson.decodeFromString<OutputBlock>(
            """{"type":"tool_call","name":"read","input":"a.ts","output":[{"type":"text","text":"one"},{"type":"image"},{"type":"text","text":"two"}]}""")
        assertEquals("a.ts", block.input)
        assertEquals("one\ntwo", block.output)
        val bare = wireJson.decodeFromString<OutputBlock>("""{"type":"text","text":"hi","output":null}""")
        assertNull(bare.output)
        assertEquals("hi", bare.text)
    }

    @Test fun anEnginePayloadFromAnOlderBridgeStillDecodes() {
        val payload = wireJson.decodeFromString<EnginesSettingsPayload>("""{"engines":[{"id":"claude","protocol":"claude"}]}""")
        val engine = payload.engines.single()
        assertEquals("claude", engine.displayName)
        assertEquals("claude", engine.protocolName)
        assertTrue(engine.enabled)
        assertEquals("unknown", engine.login)
    }
}
