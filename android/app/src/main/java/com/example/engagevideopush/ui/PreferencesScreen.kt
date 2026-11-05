package com.example.engagevideopush.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.example.engagevideopush.EngageApplication
import com.example.engagevideopush.data.FeedCategories
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
fun PreferencesScreen() {
    val app = LocalContext.current.applicationContext as EngageApplication
    val options = FeedCategories.all.mapNotNull { item -> item.query?.let { it to item.label } }
    var selected by remember { mutableStateOf(setOf<String>()) }
    var message by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(Unit) {
        try {
            selected = withContext(Dispatchers.IO) { app.backend.videoPreferences().toSet() }
        } catch (reason: Exception) {
            error = reason.message
        }
    }

    Column(Modifier.fillMaxSize().padding(20.dp)) {
        Text("Preferences", style = MaterialTheme.typography.headlineSmall)
        Text("Choose the kinds of videos to show first. Saving does not send a notification.", modifier = Modifier.padding(vertical = 8.dp))
        Column(
            Modifier.weight(1f).verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            options.forEach { (category, label) ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(checked = category in selected, onCheckedChange = { checked ->
                        selected = if (checked) selected + category else selected - category
                    })
                    Text(label)
                }
            }
        }
        Button(onClick = {
            scope.launch {
                error = null
                message = null
                try {
                    withContext(Dispatchers.IO) { app.backend.saveVideoPreferences(selected.toList()) }
                    message = "Preferences saved."
                } catch (reason: Exception) {
                    error = reason.message ?: "Preferences could not be saved."
                }
            }
        }, modifier = Modifier.padding(top = 12.dp)) { Text("Save") }
        message?.let { Text(it, modifier = Modifier.padding(top = 12.dp)) }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 12.dp)) }
    }
}
