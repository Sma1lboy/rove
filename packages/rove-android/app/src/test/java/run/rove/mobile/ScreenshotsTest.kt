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
        paparazzi.snapshot { RoveTheme(dark = false) { Surface(color = MaterialTheme.colorScheme.background) { TaskListScreen(data, "demo-mac", Connection.Connected(1), true, {}, {}, {}, {}, {}, {}) } } }
    }
}
