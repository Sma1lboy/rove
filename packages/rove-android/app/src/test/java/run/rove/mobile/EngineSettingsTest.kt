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

    @Test fun anEngineWithNoCliOnTheMacIsNotCountedAsMissingHooks() {
        val engines = listOf(
            EngineSetting(id = "a", hooks = "installed"),
            EngineSetting(id = "b", hooks = "outdated"),
            EngineSetting(id = "c", hooks = "not-installed", binaryFound = false),
            EngineSetting(id = "d", hooks = "unsupported"),
        )
        val hooks = EngineLogic.hooks(engines)
        assertEquals(1, hooks.missing)
        assertEquals(2, hooks.total)
        assertEquals(2, hooks.onDisk)
        assertFalse(EngineLogic.hooks(listOf(EngineSetting(id = "d"))).shown)
    }

    @Test fun anOutdatedSkillCountsAsMissing() {
        val skill = EngineLogic.skill(listOf(EngineSetting(id = "a", skill = "installed"), EngineSetting(id = "b", skill = "outdated"), EngineSetting(id = "c")))
        assertEquals(1, skill.missing)
        assertEquals(2, skill.total)
    }
}
