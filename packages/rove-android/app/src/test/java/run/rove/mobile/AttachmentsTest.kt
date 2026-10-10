package run.rove.mobile

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test
import run.rove.mobile.data.AttachmentError
import run.rove.mobile.data.AttachmentLogic

class AttachmentsTest {
    private fun bytes(vararg v: Int) = ByteArray(v.size) { v[it].toByte() }

    @Test fun contentDecidesTheTypeNotTheName() {
        assertEquals("image/png", AttachmentLogic.sniff(bytes(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0)))
        assertEquals("image/jpeg", AttachmentLogic.sniff(bytes(0xFF, 0xD8, 0xFF, 0xE0)))
        assertEquals("image/gif", AttachmentLogic.sniff(bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61)))
        assertEquals("application/pdf", AttachmentLogic.sniff("%PDF-1.7".toByteArray()))
        assertEquals("image/webp", AttachmentLogic.sniff("RIFF\u0000\u0000\u0000\u0000WEBPVP8 ".toByteArray(Charsets.ISO_8859_1)))
        // RIFF without the WEBP tag (e.g. WAV) and a truncated header are not images.
        assertNull(AttachmentLogic.sniff("RIFF\u0000\u0000\u0000\u0000WAVEfmt ".toByteArray(Charsets.ISO_8859_1)))
        assertNull(AttachmentLogic.sniff(bytes(0x89, 0x50)))
    }

    @Test fun supportedFilesWithinTheCapPassThroughUnchanged() {
        val png = bytes(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3)
        val prepared = AttachmentLogic.prepare(png)
        assertEquals("image/png", prepared.mime)
        assertArrayEquals(png, prepared.data)
    }

    @Test fun aPdfOverTheCapIsRefused() {
        val pdf = "%PDF".toByteArray() + ByteArray(AttachmentLogic.MAX_BYTES)
        assertThrows(AttachmentError.TooLarge::class.java) { AttachmentLogic.prepare(pdf) }
    }

    @Test fun referencesAreSpelledPerKind() {
        assertEquals("images[0]: /tmp/rove/attachments/a.png", AttachmentLogic.ref("/tmp/rove/attachments/a.png", 0))
        assertEquals("pdf[1]: /tmp/rove/attachments/Spec.PDF", AttachmentLogic.ref("/tmp/rove/attachments/Spec.PDF", 1))
    }
}
