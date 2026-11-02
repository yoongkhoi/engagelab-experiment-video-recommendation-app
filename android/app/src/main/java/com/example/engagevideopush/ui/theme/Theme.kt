package com.example.engagevideopush.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val colors = darkColorScheme(
    primary = Color(0xFFFF5A36),
    onPrimary = Color.White,
    background = Color(0xFF0E1116),
    surface = Color(0xFF171C24),
    onBackground = Color(0xFFF4EFE6),
    onSurface = Color(0xFFF4EFE6),
    secondary = Color(0xFFE7C27A),
)

@Composable
fun EngageTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = colors, content = content)
}
