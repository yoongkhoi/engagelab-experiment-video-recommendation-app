package com.example.engagevideopush.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.example.engagevideopush.BuildConfig
import com.example.engagevideopush.EngageApplication
import com.example.engagevideopush.push.PushState
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
fun DeviceScreen() {
    val app = LocalContext.current.applicationContext as EngageApplication
    val sdk by PushState.sdkStatus.collectAsState()
    val callback by PushState.sdkCallback.collectAsState()
    val connected by PushState.connected.collectAsState()
    val health by PushState.backendHealth.collectAsState()
    val registrationId by PushState.registrationId.collectAsState()
    val deviceType by PushState.deviceType.collectAsState()
    val backend by PushState.backendStatus.collectAsState()
    val tags by PushState.tagSyncStatus.collectAsState()
    val permission by PushState.permissionGranted.collectAsState()
    val error by PushState.lastError.collectAsState()
    val note by PushState.note.collectAsState()
    var backendUrl by remember { mutableStateOf(app.backend.baseUrl) }

    Column(Modifier.verticalScroll(rememberScrollState()).padding(20.dp)) {
        Text("Device", style = MaterialTheme.typography.headlineSmall)
        StatusRow("SDK", sdk)
        StatusRow("SDK callback", callback)
        StatusRow("Data center site", BuildConfig.ENGAGELAB_APP_SITE.ifBlank { "not set" })
        StatusRow("Connection", if (connected) "connected" else "not connected")
        StatusRow("Device type", deviceType)
        StatusRow("Registration ID", registrationId.ifBlank { "Not available yet. This is not simulated." })
        StatusRow("Backend health", health)
        StatusRow("Backend", backend)
        StatusRow("Tag sync", tags)
        StatusRow("Notifications", when (permission) { true -> "granted"; false -> "denied"; null -> "unknown" })
        StatusRow("App version", BuildConfig.APP_VERSION_NAME)
        error?.let { Text(it, color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(top = 8.dp)) }
        note?.let { Text(it, modifier = Modifier.padding(top = 8.dp)) }
        Button(onClick = { app.refreshRegistrationId() }, modifier = Modifier.padding(top = 16.dp)) { Text("Refresh Registration ID") }
        Button(onClick = {
            app.scope.launch {
                val installationId = app.preferences.installationId()
                withContext(Dispatchers.IO) {
                    runCatching { app.backend.detachInstallation(installationId) }
                    runCatching { app.backend.logout() }
                }
                app.session.clear()
                app.backend.sessionToken = null
                PushState.authenticated.value = false
            }
        }, modifier = Modifier.padding(top = 8.dp)) { Text("Sign out") }
        OutlinedTextField(
            value = backendUrl,
            onValueChange = { backendUrl = it },
            label = { Text("Backend URL") },
            modifier = Modifier.fillMaxWidth().padding(top = 16.dp),
        )
        Button(onClick = {
            app.backend.baseUrl = backendUrl.trimEnd('/')
            app.scope.launch { app.preferences.saveBackendUrl(app.backend.baseUrl) }
            app.refreshRegistrationId()
        }, modifier = Modifier.padding(top = 8.dp)) { Text("Save backend URL") }
        Text(
            "The Master Secret is not on this device. An emulator uses http://10.0.2.2 and the backend port. A phone or tablet uses this computer's LAN address. Saving a LAN address here overrides the build-time address on a physical device.",
            modifier = Modifier.padding(top = 12.dp),
        )
    }
}

@Composable
private fun StatusRow(label: String, value: String) {
    Text(label, style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(top = 12.dp))
    Text(value)
}
