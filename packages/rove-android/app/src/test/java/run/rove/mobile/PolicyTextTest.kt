package run.rove.mobile

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import run.rove.mobile.domain.PolicyText

class PolicyTextTest {
    @Test fun stripsMarkdownSyntax() {
        val md = "# Title\n\n## Section\n\nTap **forget pairing** in `settings`. See [Apple](https://a.example/x) or <https://b.example>."
        assertEquals("Title\n\nSection\n\nTap forget pairing in settings. See Apple (https://a.example/x) or https://b.example.", PolicyText.plain(md))
    }

    /** The file Gradle bundles is the one Play Console links to; it must read cleanly as plain text. */
    @Test fun bundledPolicyReadsAsPlainText() {
        val text = PolicyText.plain(File("../../../docs/PRIVACY.md").readText())
        assertTrue(text.startsWith("Rove mobile apps: privacy policy"))
        assertTrue("run.rove.mobile" in text)
        listOf("](", "**", "<http", "\n#").forEach { assertFalse("leftover $it", it in text) }
    }
}
