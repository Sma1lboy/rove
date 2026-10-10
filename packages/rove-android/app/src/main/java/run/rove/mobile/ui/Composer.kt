package run.rove.mobile.ui

import androidx.annotation.StringRes
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.material3.Text
import run.rove.mobile.R

// iOS Terminal/Composer.swift and the KeyRow in Terminal/TerminalPane.swift.

/** `bytes == null` is the sticky ctrl modifier. */
private class AccessoryKey(@StringRes val label: Int, val bytes: String?)

// Most-used first, so `enter` is on screen without scrolling (iOS `KeyRow.order`).
private val Keys = listOf(
    AccessoryKey(R.string.detail_key_esc, "\u001b"), AccessoryKey(R.string.detail_key_enter, "\r"),
    AccessoryKey(R.string.detail_key_up, "\u001b[A"), AccessoryKey(R.string.detail_key_down, "\u001b[B"),
    AccessoryKey(R.string.detail_key_tab, "\t"), AccessoryKey(R.string.detail_key_shift_tab, "\u001b[Z"),
    AccessoryKey(R.string.detail_key_ctrl, null),
    AccessoryKey(R.string.detail_key_left, "\u001b[D"), AccessoryKey(R.string.detail_key_right, "\u001b[C"),
    AccessoryKey(R.string.detail_key_ctrl_c, "\u0003"),
)

/** Bracketed paste, so a multi-line message reaches an engine without its first newline reading as Enter. */
object PasteEncoding {
    private const val START = "\u001b[200~"
    private const val END = "\u001b[201~"

    // ESC and the other C0 controls would let pasted text close the paste early or drive the engine's keys.
    private fun sanitized(text: String) = text.replace("\r\n", "\n").replace('\r', '\n')
        .filter { it == '\n' || it == '\t' || (it.code >= 0x20 && it.code != 0x7f) }

    fun message(text: String): String = sanitized(text).let { if ('\n' in it) START + it + END else it }
}

/** Always-visible key row: keys, a divider, then interrupt and the canned replies; `done` while the keyboard is up. */
@Composable fun KeyRow(ctrl: Boolean, onKey: (String) -> Unit, onCtrl: () -> Unit, onInterrupt: () -> Unit,
                       onReply: (String) -> Unit, onDone: (() -> Unit)?) {
    val paper = Rove.c.paper
    Row(Modifier.fillMaxWidth().background(paper).padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Row(Modifier.weight(1f)
            // The row scrolls: fade the trailing edge so a cut-off key reads as "more", not as a typo.
            .graphicsLayer(compositingStrategy = CompositingStrategy.Offscreen)
            .drawWithContent {
                drawContent()
                drawRect(Brush.horizontalGradient(listOf(paper, paper.copy(alpha = 0f)), startX = size.width - 32.dp.toPx(), endX = size.width),
                    blendMode = BlendMode.DstIn)
            }
            .horizontalScroll(rememberScrollState()).padding(start = 12.dp, end = 32.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
            Keys.forEach { key ->
                val armed = key.bytes == null && ctrl
                KeyTile(stringResource(key.label), armed = armed, minWidth = 38.dp) { if (key.bytes == null) onCtrl() else onKey(key.bytes) }
            }
            Box(Modifier.padding(horizontal = 2.dp).size(1.dp, 22.dp).background(Rove.c.line))
            KeyTile(stringResource(R.string.detail_key_interrupt), onClick = onInterrupt)
            listOf(R.string.detail_key_continue, R.string.detail_key_yes).forEach { id ->
                val reply = stringResource(id)
                KeyTile(reply, tint = Rove.c.accent, fill = Rove.c.accentSoft, outlined = false) { onReply(reply) }
            }
        }
        if (onDone != null) Box(Modifier.padding(end = 6.dp).widthIn(min = 44.dp).heightIn(min = 36.dp).pressable(onClick = onDone),
            contentAlignment = Alignment.Center) {
            Text(stringResource(R.string.detail_key_done), Modifier.padding(horizontal = 10.dp), color = Rove.c.accent,
                style = Rove.mono(14, FontWeight.SemiBold), maxLines = 1)
        }
    }
}

@Composable private fun KeyTile(text: String, armed: Boolean = false, minWidth: Dp = 0.dp,
                                tint: Color = Rove.c.ink,
                                fill: Color = Rove.c.surface, outlined: Boolean = true,
                                onClick: () -> Unit) {
    val shape = Rove.smallRadius
    val base = Modifier.widthIn(min = minWidth).heightIn(min = 34.dp)
    val look = when {
        armed -> base.tile(Rove.c.accent, shape, Rove.c.accent)
        outlined -> base.tile(fill, shape)
        else -> base.background(fill, RoundedCornerShape(shape))
    }
    Box(look.pressable(onClick = onClick), contentAlignment = Alignment.Center) {
        Text(text, Modifier.padding(horizontal = 10.dp), color = if (armed) Rove.c.paper else tint,
            style = Rove.mono(13, FontWeight.Medium), maxLines = 1, softWrap = false)
    }
}

/** Reply composer: text, `↵` for a new line, `send`. `onSend` returns false when the text could not be sent. */
@Composable fun Composer(engineName: String?, onSend: (String) -> Boolean) {
    var text by remember { mutableStateOf("") }
    val send = { if (text.isNotEmpty() && onSend(text)) text = "" }
    Row(Modifier.fillMaxWidth().background(Rove.c.paper).padding(start = 12.dp, end = 12.dp, top = 6.dp, bottom = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        FieldBox(text, { text = it },
            engineName?.let { stringResource(R.string.detail_reply_to, it.lowercase()) } ?: stringResource(R.string.detail_reply),
            Modifier.weight(1f).heightIn(max = 140.dp), singleLine = false,
            keyboard = KeyboardOptions(imeAction = ImeAction.Send), actions = KeyboardActions(onSend = { send() }))
        Box(Modifier.size(34.dp, 44.dp).pressable { text += "\n" }, contentAlignment = Alignment.Center) {
            Text("↵", color = Rove.c.muted, style = Rove.mono(16, FontWeight.Medium))
        }
        val empty = text.isEmpty()
        Box(Modifier.height(44.dp).background(if (empty) Rove.c.inset else Rove.c.accent, RoundedCornerShape(Rove.radius))
            .pressable(enabled = !empty, onClick = send), contentAlignment = Alignment.Center) {
            Text(stringResource(R.string.detail_send), Modifier.padding(horizontal = 14.dp), color = if (empty) Rove.c.muted else Rove.c.paper,
                style = Rove.mono(14, FontWeight.SemiBold), maxLines = 1)
        }
    }
}
