package run.rove.mobile.ui

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay

// iOS Shared/Components.swift + the view helpers in Theme.swift, in the same names where Compose allows.

/** Surface fill + hairline border: cards and idle buttons (iOS `.tile()`). */
@Composable fun Modifier.tile(fill: Color = Rove.c.surface, radius: Dp = Rove.radius, border: Color = Rove.c.line): Modifier {
    val shape = RoundedCornerShape(radius)
    return background(fill, shape).border(1.dp, border, shape)
}

@Composable fun Modifier.selectableTile(on: Boolean) =
    tile(if (on) Rove.c.accentSoft else Rove.c.surface, border = if (on) Rove.c.accent else Rove.c.line)

/** Scale 0.97 on press, critically damped (iOS `PressableButtonStyle`), plus the platform ripple. */
@Composable fun Modifier.pressable(enabled: Boolean = true, onClick: () -> Unit): Modifier {
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    val scale by animateFloatAsState(if (pressed) 0.97f else 1f, spring(dampingRatio = 1f, stiffness = 600f), label = "press")
    return scale(scale).clickable(source, ripple(), enabled = enabled, onClick = onClick)
}

@Composable fun Kicker(text: String, modifier: Modifier = Modifier, color: Color = Rove.c.muted) {
    Text(text.uppercase(), modifier, color = color, style = Rove.kicker, maxLines = 1)
}

/** `[ rove ]`: terracotta brackets, ink word, mono bold (iOS `BracketChip`). */
@Composable fun Wordmark(size: Int = 17, modifier: Modifier = Modifier) {
    val accent = Rove.c.accent
    Text(buildAnnotatedString {
        withStyle(SpanStyle(color = accent)) { append("[") }
        append(" rove ")
        withStyle(SpanStyle(color = accent)) { append("]") }
    }, modifier.semantics { contentDescription = "rove" }, color = Rove.c.ink, style = Rove.mono(size, FontWeight.Bold))
}

/** The TUI's braille spinner at 12.5 fps. */
@Composable fun BrailleSpinner(size: Int = 11, tint: Color = Rove.c.accent) {
    val frames = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"
    var frame by remember { mutableIntStateOf(0) }
    LaunchedEffect(Unit) { while (true) { delay(80); frame = (frame + 1) % frames.length } }
    Text(frames[frame].toString(), color = tint, style = Rove.mono(size, FontWeight.SemiBold))
}

/** iOS `TaskGroup.tone`: accent only for what needs a person; error red is never a group colour. */
@Composable fun groupTone(group: String): Color = when (group) {
    "waiting-on-you" -> Rove.c.accent
    "landing" -> Rove.c.success
    "ready-for-review", "working" -> Rove.c.ink
    else -> Rove.c.muted
}

/** Mono status tag; `working` breathes with the spinner; `unknown` draws nothing (iOS `StatusTag`). */
@Composable fun StatusTag(group: String) {
    if (group == "unknown") return
    Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
        if (group == "working") BrailleSpinner(11)
        Text(group, color = groupTone(group), maxLines = 1,
            style = Rove.mono(11, if (group == "waiting-on-you") FontWeight.Bold else FontWeight.Medium))
    }
}

/** Mono label on a surface tile: the idle-button grammar. */
@Composable fun TileLabel(text: String, modifier: Modifier = Modifier, tint: Color = Rove.c.ink, size: Int = 13,
                          fill: Color = Rove.c.surface, onClick: (() -> Unit)? = null) {
    val base = modifier.heightIn(min = 36.dp).tile(fill)
    Box(if (onClick != null) base.pressable(onClick = onClick) else base, contentAlignment = Alignment.Center) {
        Text(text, Modifier.padding(horizontal = 12.dp), color = tint, style = Rove.mono(size, FontWeight.Medium), maxLines = 1)
    }
}

/** Mono single-line field on a surface tile, at least 44 tall (iOS `FieldBox`). */
@Composable fun FieldBox(value: String, onValue: (String) -> Unit, placeholder: String, modifier: Modifier = Modifier,
                         style: TextStyle = Rove.mono(14), singleLine: Boolean = true,
                         visual: VisualTransformation = VisualTransformation.None,
                         keyboard: KeyboardOptions = KeyboardOptions.Default, actions: KeyboardActions = KeyboardActions.Default) {
    BasicTextField(value, onValue, modifier.fillMaxWidth().heightIn(min = 44.dp).tile(),
        textStyle = style.copy(color = Rove.c.ink), singleLine = singleLine, cursorBrush = SolidColor(Rove.c.accent),
        visualTransformation = visual, keyboardOptions = keyboard, keyboardActions = actions,
        decorationBox = { inner ->
            Box(Modifier.padding(horizontal = 12.dp, vertical = 11.dp), contentAlignment = Alignment.CenterStart) {
                if (value.isEmpty()) Text(placeholder, color = Rove.c.muted, style = style, maxLines = 1, overflow = TextOverflow.Ellipsis)
                inner()
            }
        })
}

/** Multi-line prompt editor on a surface tile, system face 16 (iOS `PromptEditor`). */
@Composable fun PromptEditor(value: String, onValue: (String) -> Unit, placeholder: String, minHeight: Dp = 120.dp,
                             modifier: Modifier = Modifier) {
    BasicTextField(value, onValue, modifier.fillMaxWidth().heightIn(min = minHeight).tile(),
        textStyle = Rove.face(16).copy(color = Rove.c.ink), cursorBrush = SolidColor(Rove.c.accent),
        decorationBox = { inner ->
            Box(Modifier.padding(horizontal = 13.dp, vertical = 12.dp)) {
                if (value.isEmpty()) Text(placeholder, color = Rove.c.muted, style = Rove.face(16))
                inner()
            }
        })
}

/** Paper header replacing the system bar: optional back chevron, leading title, trailing controls. */
@Composable fun ScreenHeader(back: (() -> Unit)? = null, trailing: @Composable RowScope.() -> Unit = {},
                             title: @Composable () -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = 52.dp).background(Rove.c.paper)
        .padding(start = if (back == null) 20.dp else 10.dp, end = if (back == null) 20.dp else 10.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        if (back != null) Box(Modifier.size(36.dp).pressable(onClick = back).semantics { contentDescription = "Back" },
            contentAlignment = Alignment.Center) {
            Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, null, tint = Rove.c.ink, modifier = Modifier.size(28.dp))
        }
        Box(Modifier.weight(1f)) { title() }
        trailing()
    }
}

/** Kicker label over its content: one field or group of a form. */
@Composable fun FormSection(label: String, trailing: String? = null, content: @Composable ColumnScope.() -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(Modifier.fillMaxWidth()) { Kicker(label, Modifier.weight(1f)); if (trailing != null) Kicker(trailing) }
        content()
    }
}

@Composable fun Hint(text: String) { Text(text, color = Rove.c.muted, style = Rove.face(14)) }

@Composable fun ErrorLine(text: String) { Text(text, Modifier.fillMaxWidth(), color = Rove.c.error, style = Rove.mono(12)) }

/** Two mono lines: what is empty, and what fills it. */
@Composable fun EmptyState(title: String, detail: String, modifier: Modifier = Modifier) {
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(title, color = Rove.c.ink, style = Rove.mono(13, FontWeight.Medium))
        Text(detail, color = Rove.c.muted, style = Rove.mono(12))
    }
}

/** Choose-one row of mono tiles; the selected one takes the accent wash. */
@Composable fun <T> ChoiceTiles(options: List<T>, selection: T, label: (T) -> String, onSelect: (T) -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        options.forEach { option ->
            val on = option == selection
            Box(Modifier.weight(1f).heightIn(min = 40.dp).selectableTile(on).pressable { onSelect(option) },
                contentAlignment = Alignment.Center) {
                Text(label(option), Modifier.padding(horizontal = 12.dp), color = if (on) Rove.c.accent else Rove.c.ink,
                    style = Rove.mono(13, if (on) FontWeight.SemiBold else FontWeight.Normal), maxLines = 1)
            }
        }
    }
}

/** Full-width primary action, 56 tall, radius 14: accent when enabled, inset when not, error when destructive. */
@Composable fun PrimaryBar(label: String, enabled: Boolean = true, destructive: Boolean = false, busy: Boolean = false,
                           modifier: Modifier = Modifier, onClick: () -> Unit) {
    val fg = if (enabled) Rove.c.paper else Rove.c.muted
    Row(modifier.fillMaxWidth().height(56.dp)
        .background(if (!enabled) Rove.c.inset else if (destructive) Rove.c.error else Rove.c.accent, RoundedCornerShape(14.dp))
        .pressable(enabled && !busy, onClick).padding(horizontal = 18.dp),
        verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f), color = fg, style = Rove.mono(16, FontWeight.SemiBold))
        if (busy) BrailleSpinner(14, Rove.c.paper) else Text("→", color = fg, style = Rove.mono(16, FontWeight.SemiBold))
    }
}

/** One tappable list row: mono label, optional muted detail, no chevron. */
@Composable fun ActionRow(title: String, detail: String? = null, tint: Color = Rove.c.ink, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = 46.dp).pressable(onClick = onClick).padding(horizontal = 14.dp),
        verticalAlignment = Alignment.CenterVertically) {
        Text(title, Modifier.weight(1f), color = tint, style = Rove.mono(14, FontWeight.Medium))
        if (detail != null) Text(detail, color = Rove.c.muted, style = Rove.mono(12), maxLines = 1)
    }
}

/** Inset strip over every screen in demo mode (iOS `DemoStrip`). */
@Composable fun DemoStrip(onConnect: () -> Unit) {
    val line = Rove.c.line
    Row(Modifier.fillMaxWidth().background(Rove.c.inset).drawBehind {
        drawLine(line, androidx.compose.ui.geometry.Offset(0f, size.height), androidx.compose.ui.geometry.Offset(size.width, size.height), 1.dp.toPx())
    }.padding(horizontal = 20.dp), verticalAlignment = Alignment.CenterVertically) {
        Text("demo · not connected to a mac", Modifier.weight(1f), color = Rove.c.muted, style = Rove.mono(11, FontWeight.Medium), maxLines = 1)
        Box(Modifier.heightIn(min = 32.dp).pressable(onClick = onConnect), contentAlignment = Alignment.Center) {
            Text("connect a mac", color = Rove.c.accent, style = Rove.mono(11, FontWeight.SemiBold), maxLines = 1)
        }
    }
}

/**
 * Sheet chrome: kicker + 20pt title with a `close` text button, scrolling body, optional error and primary bar on paper
 * under the shared scrim (iOS `SheetScaffold` + `QuillSheetChrome`). A Material bottom sheet carries it on Android.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable fun SheetScaffold(title: String, onDismiss: () -> Unit, kicker: String? = null, error: String? = null,
                              demo: Boolean = false, onExitDemo: () -> Unit = {},
                              primary: (@Composable () -> Unit)? = null, content: @Composable ColumnScope.() -> Unit) {
    ModalBottomSheet(onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = Rove.c.paper, scrimColor = Rove.scrim, dragHandle = null,
        shape = RoundedCornerShape(topStart = 14.dp, topEnd = 14.dp)) {
        Column(Modifier.fillMaxWidth().imePadding()) {
            if (demo) DemoStrip(onExitDemo)
            Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, top = 18.dp, bottom = 8.dp), verticalAlignment = Alignment.Top) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    if (kicker != null) Kicker(kicker)
                    Text(title, color = Rove.c.ink, style = Rove.face(20, FontWeight.SemiBold))
                }
                Box(Modifier.heightIn(min = 36.dp).widthIn(min = 44.dp).pressable(onClick = onDismiss), contentAlignment = Alignment.Center) {
                    Text("close", color = Rove.c.muted, style = Rove.mono(14))
                }
            }
            Column(Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(22.dp), content = content)
            if (error != null || primary != null) Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (error != null) ErrorLine(error)
                primary?.invoke()
            }
            Spacer(Modifier.navigationBarsPadding())
        }
    }
}
