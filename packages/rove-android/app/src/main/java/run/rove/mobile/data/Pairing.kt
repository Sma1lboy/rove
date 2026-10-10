package run.rove.mobile.data

import kotlinx.serialization.Serializable
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Request
import java.net.URI
import java.net.URLDecoder

@Serializable
class Pairing(val endpoint: String, val token: String, val cloudflare: Boolean = false,
              val clientId: String = "", val clientSecret: String = "") {
    fun request(): Request {
        require(token.isNotBlank() && token.none { it == '\r' || it == '\n' }) { "Invalid pairing token" }
        val url = endpoint.replaceFirst("wss://", "https://").replaceFirst("ws://", "http://")
            .toHttpUrlOrNull() ?: error("Invalid endpoint")
        require(url.queryParameterNames.none { it.equals("token", true) || it.equals("preset", true) })
        require(url.username.isEmpty() && url.password.isEmpty())
        require(!cloudflare || (url.isHttps && clientId.isNotBlank() && clientSecret.isNotBlank())) {
            "Cloudflare requires wss and both Access credentials"
        }
        return Request.Builder().url(url).header("Authorization", "Bearer $token").apply {
            if (cloudflare) {
                header("CF-Access-Client-Id", clientId)
                header("CF-Access-Client-Secret", clientSecret)
            }
        }.build()
    }

    companion object {
        fun parse(input: String, clientId: String = "", clientSecret: String = ""): Pairing {
            // Never include the original URL in parse exceptions: it carries credentials.
            val uri = try { URI(input.trim()) } catch (_: Exception) { error("Invalid pairing URL") }
            val text = if (uri.scheme == "rove" && uri.host == "pair") {
                uri.rawQuery?.split('&')?.firstOrNull { it.startsWith("url=") }
                    ?.substringAfter('=')?.let { URLDecoder.decode(it, "UTF-8") }
                    ?: error("Missing pairing URL")
            } else input.trim()
            require(text.startsWith("ws://") || text.startsWith("wss://")) { "Use a ws:// or wss:// pairing URL" }
            val url = text.replaceFirst("wss://", "https://").replaceFirst("ws://", "http://")
                .toHttpUrlOrNull() ?: error("Invalid pairing URL")
            require(url.username.isEmpty() && url.password.isEmpty()) { "URL credentials are not supported" }
            val tokens = url.queryParameterValues("token")
            require(tokens.size == 1 && !tokens[0].isNullOrBlank()) { "Pairing URL needs one token" }
            val preset = url.queryParameter("preset")
            require(preset in listOf(null, "none", "tailscale", "cf", "cloudflare")) { "Unknown network preset" }
            val cf = preset == "cf" || preset == "cloudflare"
            require(!cf || url.isHttps) { "Cloudflare requires wss://" }
            val clean = url.newBuilder().removeAllQueryParameters("token").removeAllQueryParameters("preset")
                .fragment(null).build().toString().replaceFirst("https://", "wss://").replaceFirst("http://", "ws://")
            return Pairing(clean, tokens[0]!!, cf, clientId.trim(), clientSecret.trim())
        }
    }
}
