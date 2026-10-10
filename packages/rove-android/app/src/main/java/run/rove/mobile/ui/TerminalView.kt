package run.rove.mobile.ui

import android.annotation.SuppressLint
import android.view.ViewGroup
import android.webkit.*
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.webkit.WebViewAssetLoader
import kotlinx.serialization.json.JsonPrimitive
import run.rove.mobile.data.BridgeClient
import run.rove.mobile.data.TerminalSession
import java.io.ByteArrayInputStream

@SuppressLint("SetJavaScriptEnabled")
@Composable fun TerminalView(bridge: BridgeClient, taskId: String, tabId: String, tabChips: @Composable RowScope.() -> Unit = {}) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var ctrl by remember { mutableStateOf(false) }
    var line by remember { mutableStateOf("") }
    var fit by remember { mutableStateOf(true) }
    // AndroidView defaults to WRAP_CONTENT, under which Chromium resolves `height: 100%` to 0 and xterm fits one row.
    val web = remember(taskId, tabId) { WebView(context).apply {
        layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
    } }
    val session = remember(web) { TerminalSession(bridge, scope, taskId, tabId,
        write = { encoded -> web.evaluateJavascript("window.roveWrite(${JsonPrimitive(encoded)});", null) },
        reset = { web.evaluateJavascript("window.roveReset();", null) }) }
    val status by session.status.collectAsState()
    val send: (String) -> Unit = { text ->
        if (ctrl && text.length == 1 && text[0].code in 64..127) {
            session.input((text[0].code and 31).toChar().toString()); ctrl = false
        } else session.input(text)
    }
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
    Column(Modifier.fillMaxSize()) {
        // Tab chips share the status row so the terminal keeps that height.
        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically) {
            Row(Modifier.weight(1f).horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically) {
                tabChips()
                Text(status, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            TextButton(onClick = { fit = !fit; session.setFit(fit) }) { Text(if (fit) "fit" else "watch") }
        }
        AndroidView(factory = { web }, modifier = Modifier.fillMaxWidth().weight(1f))
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState())) {
            listOf("Esc" to "\u001b", "Tab" to "\t", "⇧Tab" to "\u001b[Z", "↑" to "\u001b[A", "↓" to "\u001b[B",
                "←" to "\u001b[D", "→" to "\u001b[C", "Enter" to "\r", "Ctrl-C" to "\u0003").forEach { (label, key) ->
                TextButton(onClick = { session.input(key) }) { Text(label) }
            }
            FilterChip(selected = ctrl, onClick = { ctrl = !ctrl }, label = { Text("Ctrl") })
        }
        Row(Modifier.fillMaxWidth().padding(8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            val submit = { if (session.input(line + "\r")) line = "" }
            OutlinedTextField(line, { value ->
                if (ctrl && value.length == line.length + 1 && value.startsWith(line)) send(value.takeLast(1)) else line = value
            }, modifier = Modifier.weight(1f), singleLine = true, label = { Text("send a line") },
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send), keyboardActions = KeyboardActions(onSend = { submit() }))
            Button(shape = MaterialTheme.shapes.small, onClick = submit, enabled = status == "connected") { Text("send") }
        }
    }
}
