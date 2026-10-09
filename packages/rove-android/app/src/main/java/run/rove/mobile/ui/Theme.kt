package run.rove.mobile.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.sp

@Composable fun RoveTheme(dark: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    val colors = if (dark) darkColorScheme(
        primary = Color(0xffcc785c), background = Color(0xff141413), surface = Color(0xff1a1917),
        onBackground = Color(0xffeae7df), onSurface = Color(0xffeae7df),
        surfaceVariant = Color(0xff2b2a27), onSurfaceVariant = Color(0xffa9a39a),
        outline = Color(0xff3a3835), error = Color(0xffd47563),
    ) else lightColorScheme(
        primary = Color(0xffc46b48), background = Color(0xfff6f3ec), surface = Color(0xfffdfcf9),
        onBackground = Color(0xff3b322a), onSurface = Color(0xff3b322a),
        surfaceVariant = Color(0xffefeae0), onSurfaceVariant = Color(0xff7c7266),
        outline = Color(0xffdfd8cb), error = Color(0xffb65742),
    )
    MaterialTheme(colorScheme = colors, typography = Typography(
        labelLarge = TextStyle(fontFamily = FontFamily.Monospace, fontSize = 14.sp),
        labelMedium = TextStyle(fontFamily = FontFamily.Monospace, fontSize = 12.sp),
        titleLarge = TextStyle(fontFamily = FontFamily.Monospace, fontSize = 22.sp),
    ), content = content)
}
