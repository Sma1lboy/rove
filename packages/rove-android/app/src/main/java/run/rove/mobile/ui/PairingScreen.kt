package run.rove.mobile.ui

import android.content.ClipboardManager
import android.content.Context
import android.content.pm.PackageManager
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import run.rove.mobile.R
import java.net.URLDecoder
import java.net.URLEncoder

private val presetParam = Regex("([?&])preset=[^&#]*&?")

/** The network the link itself names (`preset=cf`), or null when it names none. */
private fun presetIn(text: String): Boolean? {
    val decoded = runCatching { URLDecoder.decode(text, "UTF-8") }.getOrDefault(text)
    val value = Regex("[?&]preset=([^&#]*)").findAll(decoded).lastOrNull()?.groupValues?.get(1)?.lowercase() ?: return null
    return value == "cf" || value == "cloudflare"
}

/** Rewrites the link's `preset=` so the parser sees the tile the user chose, as iOS overrides it. */
private fun withPreset(text: String, cloudflare: Boolean): String {
    val raw = text.trim()
    if (raw.startsWith("rove://")) {
        val inner = Regex("([?&]url=)([^&]*)").find(raw) ?: return raw
        val url = withPreset(URLDecoder.decode(inner.groupValues[2], "UTF-8"), cloudflare)
        return raw.replaceRange(inner.range, inner.groupValues[1] + URLEncoder.encode(url, "UTF-8"))
    }
    val stripped = presetParam.replace(raw) { if (it.value.endsWith("&")) it.groupValues[1] else "" }.trimEnd('?', '&')
    if (!cloudflare) return stripped
    return stripped + (if ('?' in stripped) "&" else "?") + "preset=cf"
}

@Composable fun PairingScreen(url: String, onUrl: (String) -> Unit, scan: () -> Unit,
                             connect: (String, String, String) -> Unit, demo: () -> Unit) {
    val context = LocalContext.current
    val cameraAvailable = remember { context.packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY) }
    var cloudflare by rememberSaveable { mutableStateOf(false) }
    var clientId by rememberSaveable { mutableStateOf("") }
    var secret by rememberSaveable { mutableStateOf("") }
    LaunchedEffect(url) { presetIn(url)?.let { cloudflare = it } }
    val ready = url.isNotBlank() && (!cloudflare || (clientId.isNotBlank() && secret.isNotBlank()))
    val direct = stringResource(R.string.pairing_direct)
    val cf = stringResource(R.string.pairing_cloudflare)

    Column(Modifier.fillMaxSize()) {
        ScreenHeader { Wordmark(19) }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(start = 20.dp, end = 20.dp, top = 8.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(24.dp)) {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Kicker(stringResource(R.string.pairing_kicker))
                Text(stringResource(R.string.pairing_title), color = Rove.c.ink, style = Rove.face(24, FontWeight.SemiBold))
                Text(stringResource(R.string.pairing_intro), color = Rove.c.ink, style = Rove.face(16))
            }
            FormSection(stringResource(R.string.pairing_network)) {
                ChoiceTiles(listOf(false, true), cloudflare, { if (it) cf else direct }) { cloudflare = it }
                if (!cloudflare) Hint(stringResource(R.string.pairing_direct_hint))
            }
            FormSection(stringResource(R.string.pairing_link)) {
                FieldBox(url, onUrl, stringResource(R.string.pairing_link_placeholder), singleLine = false,
                    keyboard = KeyboardOptions(keyboardType = KeyboardType.Uri))
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                    TileLabel(stringResource(R.string.pairing_paste)) {
                        val clip = (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).primaryClip
                        clip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(context)?.toString()?.let(onUrl)
                    }
                    if (cameraAvailable) TileLabel(stringResource(R.string.pairing_scan), onClick = scan)
                }
                if (!cameraAvailable) Hint(stringResource(R.string.pairing_no_camera))
            }
            if (cloudflare) FormSection(stringResource(R.string.pairing_cf_kicker)) {
                FieldBox(clientId, { clientId = it }, stringResource(R.string.pairing_cf_id))
                FieldBox(secret, { secret = it }, stringResource(R.string.pairing_cf_secret),
                    visual = PasswordVisualTransformation(), keyboard = KeyboardOptions(keyboardType = KeyboardType.Password))
                Hint(stringResource(R.string.pairing_cf_hint))
            }
        }
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            PrimaryBar(stringResource(R.string.pairing_connect), enabled = ready) {
                connect(withPreset(url, cloudflare), if (cloudflare) clientId else "", if (cloudflare) secret else "")
            }
            Box(Modifier.fillMaxWidth().heightIn(min = 36.dp).pressable(onClick = demo), contentAlignment = Alignment.Center) {
                Text(stringResource(R.string.pairing_demo), color = Rove.c.muted, style = Rove.mono(12))
            }
        }
    }
}

@Preview(showBackground = true, widthDp = 390, heightDp = 844)
@Composable fun PairingPreview() { RoveTheme { PairingScreen("", {}, {}, { _, _, _ -> }, {}) } }
