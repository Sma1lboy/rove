package run.rove.mobile.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import run.rove.mobile.R

// The iOS `Theme` (packages/rove-ios/Sources/RoveMobile/Shared/Theme.swift), token for token. Colors are spelled
// only here; screens read `Rove.c`. Sizes are iOS points as sp/dp, so Larger Text scales them the same way.

@Immutable data class RovePalette(
    val paper: Color, val surface: Color, val inset: Color, val line: Color, val ink: Color, val muted: Color,
    val accent: Color, val accentSoft: Color, val success: Color, val error: Color, val warning: Color,
)

private val Light = RovePalette(
    paper = Color(0xFFF6F3EC), surface = Color(0xFFFDFCF9), inset = Color(0xFFEFEAE0), line = Color(0xFFDFD8CB),
    ink = Color(0xFF3B322A), muted = Color(0xFF7C7266), accent = Color(0xFFC46B48), accentSoft = Color(0x1AC46B48),
    success = Color(0xFF5F8C49), error = Color(0xFFB65742), warning = Color(0xFFB08A2F),
)
private val Dark = RovePalette(
    paper = Color(0xFF141413), surface = Color(0xFF1A1917), inset = Color(0xFF2B2A27), line = Color(0xFF3A3835),
    ink = Color(0xFFEAE7DF), muted = Color(0xFFA9A39A), accent = Color(0xFFCC785C), accentSoft = Color(0x24CC785C),
    success = Color(0xFF9ACA86), error = Color(0xFFD47563), warning = Color(0xFFE8C96B),
)

private val LocalPalette = staticCompositionLocalOf { Light }

// iOS mono is SF Mono, which Android cannot ship; quill's non-Apple mono is JetBrains Mono (no-ligature cut, like SF Mono).
private val MonoFamily = FontFamily(
    Font(R.font.jetbrains_mono_regular, FontWeight.Normal), Font(R.font.jetbrains_mono_medium, FontWeight.Medium),
    Font(R.font.jetbrains_mono_semibold, FontWeight.SemiBold), Font(R.font.jetbrains_mono_bold, FontWeight.Bold),
)

object Rove {
    val c: RovePalette @Composable get() = LocalPalette.current
    /** The one modal scrim, both themes: espresso ink at a fixed opacity. */
    val scrim = Color(0x523B322A)
    val shadow = Color(0x143B322A)
    val radius = 8.dp
    val smallRadius = 6.dp

    fun mono(size: Int, weight: FontWeight = FontWeight.Normal) =
        TextStyle(fontFamily = MonoFamily, fontWeight = weight, fontSize = size.sp)
    fun face(size: Int, weight: FontWeight = FontWeight.Normal) = TextStyle(fontWeight = weight, fontSize = size.sp)
    /** Uppercase mono medium, +1.2pt tracking at 11pt. */
    val kicker = TextStyle(fontFamily = MonoFamily, fontWeight = FontWeight.Medium, fontSize = 11.sp, letterSpacing = 0.11.em)

    /** Espresso in both themes, on the dark tokens (iOS `Theme.Terminal`). */
    object Terminal {
        val background = Color(0xFF141413)
        val foreground = Color(0xFFEAE7DF)
        val caret = Color(0xFFCC785C)
        val control = Color(0xFF2B2A27)
        val controlLine = Color(0xFF3A3835)
    }
}

@Composable fun RoveTheme(dark: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    val p = if (dark) Dark else Light
    // Material components (ripples, text selection, dialogs) read these; every slot maps to a token so no M3 default leaks.
    val base = if (dark) darkColorScheme() else lightColorScheme()
    val colors = base.copy(
        primary = p.accent, onPrimary = p.paper, primaryContainer = p.accentSoft, onPrimaryContainer = p.ink,
        secondary = p.muted, onSecondary = p.paper, secondaryContainer = p.accentSoft, onSecondaryContainer = p.ink,
        tertiary = p.success, onTertiary = p.paper, tertiaryContainer = p.accentSoft, onTertiaryContainer = p.ink,
        background = p.paper, onBackground = p.ink, surface = p.paper, onSurface = p.ink,
        surfaceVariant = p.inset, onSurfaceVariant = p.muted, surfaceTint = Color.Transparent,
        surfaceBright = p.surface, surfaceDim = p.paper,
        surfaceContainerLowest = p.surface, surfaceContainerLow = p.paper, surfaceContainer = p.paper,
        surfaceContainerHigh = p.paper, surfaceContainerHighest = p.inset,
        inverseSurface = p.ink, inverseOnSurface = p.paper, inversePrimary = p.accent,
        outline = p.line, outlineVariant = p.line, error = p.error, onError = p.paper, scrim = Rove.scrim,
    )
    CompositionLocalProvider(LocalPalette provides p) {
        MaterialTheme(colorScheme = colors, typography = Typography(bodyLarge = Rove.face(16)), content = content)
    }
}
