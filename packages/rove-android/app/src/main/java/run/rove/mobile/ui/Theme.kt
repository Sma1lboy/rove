package run.rove.mobile.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.sp

// quill DESIGN.md tokens. Every container slot is set: M3's defaults are lavender and leak into chips, dialogs and menus.
private fun quill(dark: Boolean, paper: Long, surface: Long, inset: Long, line: Long, ink: Long, muted: Long,
                  accent: Long, error: Long): ColorScheme {
    val base = if (dark) darkColorScheme() else lightColorScheme()
    val accentSoft = Color(accent).copy(alpha = if (dark) 0.14f else 0.10f)
    return base.copy(
        primary = Color(accent), onPrimary = Color(paper), primaryContainer = accentSoft, onPrimaryContainer = Color(ink),
        secondary = Color(muted), onSecondary = Color(paper), secondaryContainer = accentSoft, onSecondaryContainer = Color(ink),
        tertiary = Color(accent), onTertiary = Color(paper), tertiaryContainer = accentSoft, onTertiaryContainer = Color(ink),
        background = Color(paper), onBackground = Color(ink), surface = Color(surface), onSurface = Color(ink),
        surfaceVariant = Color(inset), onSurfaceVariant = Color(muted), surfaceTint = Color.Transparent,
        surfaceBright = Color(surface), surfaceDim = Color(paper),
        surfaceContainerLowest = Color(surface), surfaceContainerLow = Color(surface), surfaceContainer = Color(surface),
        surfaceContainerHigh = Color(surface), surfaceContainerHighest = Color(inset),
        inverseSurface = Color(ink), inverseOnSurface = Color(paper), inversePrimary = Color(accent),
        outline = Color(line), outlineVariant = Color(line), error = Color(error), onError = Color(paper),
    )
}

@Composable fun RoveTheme(dark: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    val colors = if (dark) quill(true, 0xff141413, 0xff1a1917, 0xff2b2a27, 0xff3a3835, 0xffeae7df, 0xffa9a39a, 0xffcc785c, 0xffd47563)
    else quill(false, 0xfff6f3ec, 0xfffdfcf9, 0xffefeae0, 0xffdfd8cb, 0xff3b322a, 0xff7c7266, 0xffc46b48, 0xffb65742)
    MaterialTheme(colorScheme = colors, typography = Typography(
        labelLarge = TextStyle(fontFamily = FontFamily.Monospace, fontSize = 14.sp),
        labelMedium = TextStyle(fontFamily = FontFamily.Monospace, fontSize = 12.sp),
        titleLarge = TextStyle(fontFamily = FontFamily.Monospace, fontSize = 22.sp),
    ), content = content)
}

/** `[ rove ]`: accent brackets, ink word, mono bold (quill DESIGN.md wordmark). */
@Composable fun Wordmark(size: TextUnit = 17.sp, modifier: Modifier = Modifier) {
    val accent = MaterialTheme.colorScheme.primary
    Text(buildAnnotatedString {
        withStyle(SpanStyle(color = accent)) { append("[") }
        append(" rove ")
        withStyle(SpanStyle(color = accent)) { append("]") }
    }, modifier.semantics { contentDescription = "rove" }, color = MaterialTheme.colorScheme.onBackground,
        fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold, fontSize = size)
}
