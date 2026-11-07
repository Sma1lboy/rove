package run.rove.mobile

import app.cash.paparazzi.DeviceConfig
import app.cash.paparazzi.Paparazzi
import androidx.compose.material3.Surface
import androidx.compose.material3.MaterialTheme
import org.junit.Rule
import org.junit.Test
import run.rove.mobile.data.*
import run.rove.mobile.domain.*
import run.rove.mobile.ui.*
import kotlinx.serialization.json.decodeFromJsonElement

class ScreenshotsTest {
    @get:Rule val paparazzi = Paparazzi(deviceConfig = DeviceConfig.PIXEL_5, theme = "android:style/Theme.Material.Light.NoActionBar")
    @Test fun pairing() { paparazzi.snapshot { RoveTheme(dark = false) { Surface(color = MaterialTheme.colorScheme.background) { PairingScreen("", {}, {}, { _, _, _ -> }, {}) } } } }
    @Test fun demoTasks() {
        val raw = checkNotNull(javaClass.classLoader?.getResourceAsStream("demo-fixture.json")).bufferedReader().use { it.readText() }
        val data = wireJson.decodeFromJsonElement<Tasks>(DemoFixture(raw).answer("tasks.subscribe"))
        paparazzi.snapshot { RoveTheme(dark = false) { Surface(color = MaterialTheme.colorScheme.background) { TaskListContent(data, "demo-mac", Connection.Connected(1), emptyList(), ListControls(), emptyMap(), ListActions()) } } }
    }
    @Test fun searchHits() {
        val reply = SearchReply(listOf(
            SearchHit("T1", "Fix retry backoff", "tab-1", "assistant", "2026-11-03T10:00:00Z", "The retry loop now backs off exponentially and caps at 30 seconds."),
            SearchHit("T2", "Audit login flow", "tab-1", "user", "2026-11-03T08:00:00Z", "does the login call retry on a 401, or give up?")),
            listOf(SearchSkip("T3", "engine-unsupported")), truncated = true)
        paparazzi.snapshot { RoveTheme(dark = false) { Surface(color = MaterialTheme.colorScheme.background) {
            SearchContent("retry", {}, SearchState.Done("retry", reply), {}, nowMs = 1793750400000L, autofocus = false) {}
        } } }
    }
}
