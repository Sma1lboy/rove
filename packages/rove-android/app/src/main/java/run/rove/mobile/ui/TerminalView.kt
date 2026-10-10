package run.rove.mobile.ui

import android.annotation.SuppressLint
import android.view.ViewGroup
import android.webkit.*
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.webkit.WebViewAssetLoader
import run.rove.mobile.data.AttachmentLogic
import run.rove.mobile.data.putAttachment
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonPrimitive
import run.rove.mobile.R
import run.rove.mobile.data.TerminalSession
import java.io.ByteArrayInputStream

// iOS Terminal/TerminalPane.swift: the live terminal, a status banner while not live, the key row and the composer.

private const val LIVE = "connected"
private const val ATTACHING = "connecting"

/** The session's English status literals, in the reader's language. */
@Composable private fun statusLabel(status: String): String = when {
    status == ATTACHING -> stringResource(R.string.detail_status_attaching)
    status == "session ended" -> stringResource(R.string.detail_status_exited)
    status.startsWith("session exited") -> stringResource(R.string.detail_status_exited_code, status.substringAfter('(').substringBefore(')'))
    status.startsWith("disconnected") -> stringResource(R.string.detail_status_disconnected)
    status.startsWith("terminal unavailable") -> stringResource(R.string.detail_status_unavailable)
    else -> status
}

@OptIn(ExperimentalLayoutApi::class)
@SuppressLint("SetJavaScriptEnabled")
@Composable fun TerminalView(model: AppModel, taskId: String, tabId: String, engineName: String?, fit: Boolean) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var ctrl by remember { mutableStateOf(false) }
    var flash by remember { mutableStateOf<String?>(null) }
    var flashJob by remember { mutableStateOf<Job?>(null) }
    // AndroidView defaults to WRAP_CONTENT, under which Chromium resolves `height: 100%` to 0 and xterm fits one row.
    val web = remember(taskId, tabId) { WebView(context).apply {
        layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        setBackgroundColor(Rove.Terminal.background.toArgb())
    } }
    val session = remember(web) { TerminalSession(model.bridge, scope, taskId, tabId,
        write = { encoded -> web.evaluateJavascript("window.roveWrite(${JsonPrimitive(encoded)});", null) },
        reset = { web.evaluateJavascript("window.roveReset();", null) }) }
    val status by session.status.collectAsState()
    val interruptSent = stringResource(R.string.detail_interrupt_sent)
    val showFlash = { text: String ->
        flashJob?.cancel()
        flash = text
        flashJob = scope.launch { delay(2500); flash = null }
    }
    // Typed text takes a pending ctrl: a single letter becomes its control byte (letter & 0x1f).
    val send: (String) -> Unit = { text ->
        if (ctrl && text.length == 1 && text[0].code in 64..127) session.input((text[0].code and 31).toChar().toString())
        else session.input(text)
        ctrl = false
    }
    // References pasted since the last reply: `images[0]`, `images[1]`… restart with the next message (iOS `attachmentCount`).
    var attachments by remember(session) { mutableIntStateOf(0) }
    // Text, then Enter after a pause: engine TUIs read text+CR in one burst as a paste and insert a newline.
    val reply: (String) -> Boolean = { text ->
        val message = PasteEncoding.message(text)
        (message.isNotEmpty() && session.input(message)).also { sent ->
            if (sent) { attachments = 0; scope.launch { delay(150); session.input("\r") } }
        }
    }
    LaunchedEffect(session, fit) { session.setFit(fit) }
    DisposableEffect(web) {
        val assets = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(context)).build()
        web.settings.apply {
            javaScriptEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            blockNetworkLoads = true
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        }
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = true
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse =
                assets.shouldInterceptRequest(request.url) ?: WebResourceResponse("text/plain", "UTF-8", ByteArrayInputStream(byteArrayOf()))
        }
        web.addJavascriptInterface(object {
            @JavascriptInterface fun input(text: String) { web.post { send(text) } }
            @JavascriptInterface fun resize(cols: Int, rows: Int) { web.post { session.resize(cols, rows) } }
            @JavascriptInterface fun ready() { web.post { session.start() } }
        }, "Rove")
        web.loadUrl("https://appassets.androidplatform.net/assets/terminal/index.html")
        onDispose {
            session.close(); web.removeJavascriptInterface("Rove"); web.stopLoading(); web.destroy()
        }
    }
    val keyboard = LocalSoftwareKeyboardController.current
    Column(Modifier.fillMaxSize()) {
        // Inset so glyphs never touch the bezel; xterm fits its columns to the inset width.
        Box(Modifier.weight(1f).fillMaxWidth().background(Rove.Terminal.background)) {
            AndroidView(factory = { web }, modifier = Modifier.fillMaxSize().padding(start = 8.dp, end = 8.dp, top = 6.dp))
            if (status != LIVE) StatusBanner(status, Modifier.align(Alignment.TopCenter))
            flash?.let {
                Text(it.lowercase(), Modifier.align(Alignment.BottomCenter).padding(bottom = 44.dp)
                    .background(Rove.Terminal.control, RoundedCornerShape(Rove.smallRadius)).padding(horizontal = 10.dp, vertical = 6.dp),
                    color = Rove.Terminal.foreground, style = Rove.mono(12))
            }
        }
        KeyRow(ctrl, onKey = { ctrl = false; session.input(it) }, onCtrl = { ctrl = !ctrl },
            onInterrupt = {
                scope.launch {
                    try { model.repository.interrupt(taskId, tabId); showFlash(interruptSent) }
                    catch (e: CancellationException) { throw e }
                    catch (e: Exception) { showFlash(e.message ?: "") }
                }
            },
            onReply = { reply(it) }, onDone = if (WindowInsets.isImeVisible) ({ keyboard?.hide() }) else null)
        Composer(engineName, reply) { prepared ->
            val put = model.repository.putAttachment(prepared.mime, prepared.data)
            if (session.input(PasteEncoding.paste(AttachmentLogic.ref(put.path, attachments)))) attachments++
        }
    }
}

/** Only shown while not live: attach progress, an exit, or the attach error. */
@Composable private fun StatusBanner(status: String, modifier: Modifier) {
    val exited = status.startsWith("session")
    Row(modifier.fillMaxWidth().background(Rove.c.inset).padding(horizontal = 12.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        if (status == ATTACHING) BrailleSpinner(12)
        Text(statusLabel(status), color = if (exited) Rove.c.muted else Rove.c.ink, style = Rove.mono(12), maxLines = 2)
    }
}
