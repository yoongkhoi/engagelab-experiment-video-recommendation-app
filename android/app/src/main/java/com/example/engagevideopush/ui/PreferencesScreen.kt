package com.example.engagevideopush.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.example.engagevideopush.EngageApplication
import com.example.engagevideopush.push.PushState
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private val categories = listOf("tech", "funny", "lifestyle")

@Composable
fun PreferencesScreen() {
    val app = LocalContext.current.applicationContext as EngageApplication
    var selected by remember { mutableStateOf(setOf("tech", "funny", "lifestyle")) }
    var message by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        selected = app.preferences.categories().toSet()
    }

    Column(Modifier.padding(20.dp)) {
        Text("Preferred categories", style = MaterialTheme.typography.headlineSmall)
        Text("Saved on this device and sent to the backend. Tag synchronization is reported separately.", modifier = Modifier.padding(vertical = 8.dp))
        categories.forEach { category ->
            androidx.compose.foundation.layout.Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                Checkbox(checked = category in selected, onCheckedChange = { checked ->
                    selected = if (checked) selected + category else selected - category
                })
                Text(category)
            }
        }
        Button(onClick = {
            app.scope.launch {
                if (selected.isEmpty()) {
                    message = "Choose at least one category."
                    return@launch
                }
                app.preferences.setCategories(selected.toList())
                val registrationId = PushState.registrationId.value
                val token = app.preferences.deviceToken()
                message = if (registrationId.isBlank() || token == null) {
                    "Saved on this device. They will sync after a Registration ID is available."
                } else {
                    try {
                        withContext(Dispatchers.IO) { app.backend.updatePreferences(registrationId, token, selected.toList()) }
                        "Preferences saved and tag synchronization was requested."
                    } catch (error: Exception) {
                        "Saved locally. Backend sync failed: ${error.message}"
                    }
                }
            }
        }, modifier = Modifier.padding(top = 12.dp)) { Text("Save") }
        message?.let { Text(it, modifier = Modifier.padding(top = 12.dp)) }
    }
}
