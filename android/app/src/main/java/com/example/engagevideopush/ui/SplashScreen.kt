package com.example.engagevideopush.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import com.example.engagevideopush.ui.theme.EngageColors

@Composable
fun SplashScreen() {
    Column(
        Modifier.fillMaxSize().background(EngageColors.background),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("EngageVideo", style = MaterialTheme.typography.displaySmall, color = EngageColors.text)
        Text("AI", style = MaterialTheme.typography.headlineMedium, color = EngageColors.accent)
    }
}
