package com.example.engagevideopush.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

object EngageColors {
    val background = Color(0xFF121212)
    val surface = Color(0xFF242424)
    val text = Color.White
    val muted = Color(0xFFB3B3B3)
    val accent = Color(0xFFFF5A36)
}

private val colors = darkColorScheme(
    primary = EngageColors.accent,
    onPrimary = Color.White,
    background = EngageColors.background,
    surface = EngageColors.surface,
    surfaceVariant = Color(0xFF2A2A2A),
    onBackground = EngageColors.text,
    onSurface = EngageColors.text,
    onSurfaceVariant = EngageColors.muted,
    secondary = EngageColors.muted,
    error = Color(0xFFFFB4A8),
)

@Composable
fun EngageTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = colors, content = content)
}
