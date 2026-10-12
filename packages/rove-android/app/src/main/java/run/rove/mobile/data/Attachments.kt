package run.rove.mobile.data

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.decodeFromJsonElement
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.util.Base64

// iOS Terminal/Attachments.swift: what `attachment.put` accepts and how its reference is spelled for an engine —
// the same `images[0]: /path` / `pdf[1]: /path` lines the TUI composer appends.

/** What a picked file turned into; the UI maps these to its own copy. */
sealed class AttachmentError : Exception() {
    object Unsupported : AttachmentError()
    object TooLarge : AttachmentError()
}

class Prepared(val mime: String, val data: ByteArray)

@Serializable data class AttachmentPut(val path: String, val kind: String, val bytes: Int)

object AttachmentLogic {
    /** Mirrors the bridge's raw cap (the frame limit is 8 MiB once base64-encoded). */
    const val MAX_BYTES = 5 * 1024 * 1024

    /** Chip / prompt-line label: `images[n]` for images, `pdf[n]` for PDFs. */
    fun label(path: String, index: Int) = if (path.lowercase().endsWith(".pdf")) "pdf[$index]" else "images[$index]"

    fun ref(path: String, index: Int) = "${label(path, index)}: $path"

    /** The declared type by magic number — a file's name is not evidence. */
    fun sniff(data: ByteArray): String? = when {
        data.startsWith(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A) -> "image/png"
        data.startsWith(0xFF, 0xD8, 0xFF) -> "image/jpeg"
        data.startsWith(0x47, 0x49, 0x46, 0x38) -> "image/gif"
        data.size >= 12 && data.startsWith(0x52, 0x49, 0x46, 0x46) && data.sliceArray(8 until 12).contentEquals(WEBP) -> "image/webp"
        data.startsWith(0x25, 0x50, 0x44, 0x46) -> "application/pdf"
        else -> null
    }

    /**
     * Picker bytes → something the bridge takes. An image the engines cannot read (HEIC, BMP…) is re-encoded as
     * JPEG, scaled down until it fits; a PDF over the cap is refused.
     */
    fun prepare(data: ByteArray): Prepared {
        val mime = sniff(data)
        if (mime != null) {
            if (data.size <= MAX_BYTES) return Prepared(mime, data)
            if (mime != "application/pdf") shrunkJpeg(data)?.let { return Prepared("image/jpeg", it) }
            throw AttachmentError.TooLarge
        }
        return Prepared("image/jpeg", shrunkJpeg(data) ?: throw AttachmentError.Unsupported)
    }

    private val WEBP = byteArrayOf(0x57, 0x45, 0x42, 0x50)

    private fun ByteArray.startsWith(vararg prefix: Int) =
        size >= prefix.size && prefix.indices.all { this[it] == prefix[it].toByte() }

    private fun shrunkJpeg(data: ByteArray): ByteArray? {
        val decoded = try { BitmapFactory.decodeByteArray(data, 0, data.size) } catch (_: OutOfMemoryError) { null } ?: return null
        val image = upright(decoded, data)
        var scale = 1.0
        while (scale > 0.1) {
            val width = (image.width * scale).toInt().coerceAtLeast(1)
            val height = (image.height * scale).toInt().coerceAtLeast(1)
            val scaled = if (scale == 1.0) image else Bitmap.createScaledBitmap(image, width, height, true)
            val out = ByteArrayOutputStream().also { scaled.compress(Bitmap.CompressFormat.JPEG, 85, it) }.toByteArray()
            if (scaled !== image) scaled.recycle()
            if (out.size <= MAX_BYTES) return out
            scale *= 0.7
        }
        return null
    }

    // BitmapFactory ignores EXIF orientation; UIImage honours it, so a re-encoded photo must not come out sideways.
    private fun upright(bitmap: Bitmap, data: ByteArray): Bitmap {
        val orientation = try {
            ExifInterface(ByteArrayInputStream(data)).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
        } catch (_: Exception) { ExifInterface.ORIENTATION_NORMAL }
        val matrix = Matrix()
        when (orientation) {
            ExifInterface.ORIENTATION_ROTATE_90 -> matrix.postRotate(90f)
            ExifInterface.ORIENTATION_ROTATE_180 -> matrix.postRotate(180f)
            ExifInterface.ORIENTATION_ROTATE_270 -> matrix.postRotate(270f)
            ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.postScale(-1f, 1f)
            ExifInterface.ORIENTATION_FLIP_VERTICAL -> matrix.postScale(1f, -1f)
            ExifInterface.ORIENTATION_TRANSPOSE -> { matrix.postRotate(90f); matrix.postScale(-1f, 1f) }
            ExifInterface.ORIENTATION_TRANSVERSE -> { matrix.postRotate(270f); matrix.postScale(-1f, 1f) }
            else -> return bitmap
        }
        return Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
    }
}

/** Uploads to the Mac's attachment store; the returned path is what an engine reads. */
suspend fun RoveRepository.putAttachment(mime: String, bytes: ByteArray): AttachmentPut =
    wireJson.decodeFromJsonElement(bridge.request("attachment.put",
        args("mime" to mime, "data" to Base64.getEncoder().encodeToString(bytes))))
