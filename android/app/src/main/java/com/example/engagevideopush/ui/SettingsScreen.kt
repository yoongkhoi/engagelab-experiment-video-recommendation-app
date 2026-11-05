package com.example.engagevideopush.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Checkbox
import androidx.compose.ui.Alignment
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
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
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.example.engagevideopush.BuildConfig
import com.example.engagevideopush.EngageApplication
import com.example.engagevideopush.push.PushState
import com.example.engagevideopush.ui.theme.EngageColors
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
fun SettingsScreen(
    onAccount: () -> Unit,
    onInterests: () -> Unit,
    onNotifications: () -> Unit,
    onPlayback: () -> Unit,
    onDevices: () -> Unit,
    onPrivacy: () -> Unit,
    onAbout: () -> Unit,
) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp)) {
        Text("Settings", style = MaterialTheme.typography.headlineMedium, color = EngageColors.text)
        ProfileRow("Account Settings", onAccount)
        ProfileRow("Interests", onInterests)
        ProfileRow("Notification Preferences", onNotifications)
        ProfileRow("Playback Settings", onPlayback)
        ProfileRow("My Devices", onDevices)
        ProfileRow("Privacy", onPrivacy)
        ProfileRow("About", onAbout)
    }
}

@Composable
fun AccountSettingsScreen(onSignIn: () -> Unit) {
    val app = LocalContext.current.applicationContext as EngageApplication
    val signedIn by PushState.authenticated.collectAsStateWithLifecycle()
    var name by remember { mutableStateOf("") }
    var message by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(signedIn) {
        if (!signedIn) return@LaunchedEffect
        val profile = runCatching { withContext(Dispatchers.IO) { app.backend.profile() } }.getOrNull()
        name = profile?.displayName.orEmpty()
    }
    Column(Modifier.fillMaxSize().padding(20.dp)) {
        Text("Account Settings", style = MaterialTheme.typography.headlineMedium, color = EngageColors.text)
        if (!signedIn) {
            Text("Sign in to edit the nickname stored on your account.", color = EngageColors.muted, modifier = Modifier.padding(vertical = 12.dp))
            Button(onClick = onSignIn) { Text("Sign In") }
            return@Column
        }
        Text("Nickname", color = EngageColors.muted, modifier = Modifier.padding(top = 12.dp))
        OutlinedTextField(name, { name = it }, modifier = Modifier.fillMaxWidth(), singleLine = true)
        Button(onClick = {
            app.scope.launch {
                error = null
                message = null
                try {
                    val saved = withContext(Dispatchers.IO) { app.backend.updateDisplayName(name.trim()) }
                    name = saved.displayName.orEmpty()
                    message = "Nickname saved."
                } catch (reason: Exception) {
                    error = reason.message ?: "The nickname could not be saved."
                }
            }
        }, enabled = name.isNotBlank(), modifier = Modifier.padding(top = 12.dp)) { Text("Save") }
        Button(onClick = {
            app.scope.launch {
                error = null
                try {
                    withContext(Dispatchers.IO) { app.backend.clearConversations() }
                    message = "Conversation history cleared."
                } catch (reason: Exception) {
                    error = reason.message ?: "Conversation history could not be cleared."
                }
            }
        }, modifier = Modifier.padding(top = 12.dp)) { Text("Clear conversation history") }
        var confirmDelete by remember { mutableStateOf(false) }
        Button(onClick = { confirmDelete = true }, modifier = Modifier.padding(top = 8.dp)) { Text("Delete account") }
        if (confirmDelete) {
            Button(onClick = {
                app.scope.launch {
                    error = null
                    try {
                        withContext(Dispatchers.IO) { app.backend.deleteAccount() }
                        app.session.clear()
                        app.backend.sessionToken = null
                        PushState.authenticated.value = false
                        message = "Account deleted."
                    } catch (reason: Exception) {
                        error = reason.message ?: "The account could not be deleted."
                    }
                }
            }, modifier = Modifier.padding(top = 8.dp)) { Text("Confirm delete") }
        }
        message?.let { Text(it, color = EngageColors.text, modifier = Modifier.padding(top = 12.dp)) }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 12.dp)) }
    }
}

@Composable
fun NotificationSettingsScreen(onDevices: () -> Unit, onSignIn: () -> Unit) {
    val app = LocalContext.current.applicationContext as EngageApplication
    val permission by PushState.permissionGranted.collectAsStateWithLifecycle()
    val signedIn by PushState.authenticated.collectAsStateWithLifecycle()
    var pushEnabled by remember { mutableStateOf(true) }
    var interests by remember { mutableStateOf(true) }
    var ai by remember { mutableStateOf(false) }
    var trending by remember { mutableStateOf(false) }
    var digest by remember { mutableStateOf(false) }
    var frequency by remember { mutableStateOf("instant") }
    var quietStart by remember { mutableStateOf("") }
    var quietEnd by remember { mutableStateOf("") }
    var message by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(signedIn) {
        if (!signedIn) return@LaunchedEffect
        val prefs = runCatching { withContext(Dispatchers.IO) { app.backend.notificationPreferences() } }.getOrNull() ?: return@LaunchedEffect
        pushEnabled = prefs.optBoolean("pushEnabled", true)
        interests = prefs.optBoolean("newInInterests", true)
        ai = prefs.optBoolean("aiRecommendations", false)
        trending = prefs.optBoolean("trending", false)
        digest = prefs.optBoolean("dailyDigest", false)
        frequency = prefs.optString("frequency", "instant")
        quietStart = prefs.optString("quietStart")
        quietEnd = prefs.optString("quietEnd")
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp)) {
        Text("Notification Preferences", style = MaterialTheme.typography.headlineMedium, color = EngageColors.text)
        Text(
            when (permission) {
                true -> "Android notification permission is granted."
                false -> "Android notification permission is denied, so pushes cannot appear."
                null -> "Notification permission has not been checked yet."
            },
            color = EngageColors.muted,
            modifier = Modifier.padding(vertical = 12.dp),
        )
        if (!signedIn) {
            Button(onClick = onSignIn) { Text("Sign in to save preferences") }
            return@Column
        }
        PreferenceToggle("Push notifications", pushEnabled) { pushEnabled = it }
        PreferenceToggle("New videos in my interests", interests) { interests = it }
        PreferenceToggle("AI recommendations", ai) { ai = it }
        PreferenceToggle("Trending videos", trending) { trending = it }
        PreferenceToggle("Daily digest", digest) { digest = it }
        Text("Frequency", color = EngageColors.muted, modifier = Modifier.padding(top = 8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("instant", "daily", "weekly").forEach { option ->
                Button(onClick = { frequency = option }) { Text(option) }
            }
        }
        OutlinedTextField(quietStart, { quietStart = it }, label = { Text("Quiet hours start HH:mm") }, modifier = Modifier.fillMaxWidth().padding(top = 8.dp))
        OutlinedTextField(quietEnd, { quietEnd = it }, label = { Text("Quiet hours end HH:mm") }, modifier = Modifier.fillMaxWidth())
        Text("Quiet hours use the server site timezone. Daily and weekly choices are queued instead of sent immediately.", color = EngageColors.muted)
        Button(onClick = {
            app.scope.launch {
                error = null
                try {
                    val payload = org.json.JSONObject()
                        .put("pushEnabled", pushEnabled)
                        .put("newInInterests", interests)
                        .put("aiRecommendations", ai)
                        .put("trending", trending)
                        .put("dailyDigest", digest)
                        .put("frequency", frequency)
                        .put("quietStart", quietStart.ifBlank { org.json.JSONObject.NULL })
                        .put("quietEnd", quietEnd.ifBlank { org.json.JSONObject.NULL })
                        .put("categories", org.json.JSONArray())
                    withContext(Dispatchers.IO) { app.backend.saveNotificationPreferences(payload) }
                    message = "Notification preferences saved."
                } catch (reason: Exception) {
                    error = reason.message
                }
            }
        }, modifier = Modifier.padding(top = 12.dp)) { Text("Save") }
        message?.let { Text(it, modifier = Modifier.padding(top = 8.dp)) }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 8.dp)) }
        Button(onClick = onDevices, modifier = Modifier.padding(top = 16.dp)) { Text("Open device details") }
    }
}

@Composable
private fun PreferenceToggle(label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
        Checkbox(checked = checked, onCheckedChange = onChange)
        Text(label, color = EngageColors.text)
    }
}

@Composable
fun PlaybackSettingsScreen() {
    Column(Modifier.fillMaxSize().padding(20.dp)) {
        Text("Playback Settings", style = MaterialTheme.typography.headlineMedium, color = EngageColors.text)
        Text(
            "Videos use the existing player. Portrait clips fit inside the frame, and one fullscreen control is available. Playback position is kept while you pause the same video.",
            color = EngageColors.muted,
            modifier = Modifier.padding(top = 12.dp),
        )
    }
}

@Composable
fun MyDevicesScreen(onDetails: () -> Unit) {
    Column(Modifier.fillMaxSize().padding(20.dp)) {
        Text("My Devices", style = MaterialTheme.typography.headlineMedium, color = EngageColors.text)
        Text(
            "This installation is registered only after EngageLab returns a real Registration ID. No ID is invented here.",
            color = EngageColors.muted,
            modifier = Modifier.padding(vertical = 12.dp),
        )
        Button(onClick = onDetails) { Text("Device details") }
    }
}

@Composable
fun PrivacyScreen() {
    Column(Modifier.fillMaxSize().padding(20.dp)) {
        Text("Privacy", style = MaterialTheme.typography.headlineMedium, color = EngageColors.text)
        Text(
            "Sign-in uses a one-time email code. The app stores the session token in encrypted storage and does not keep the code. The EngageLab Master Secret stays on the server.",
            color = EngageColors.muted,
            modifier = Modifier.padding(top = 12.dp),
        )
    }
}

@Composable
fun AboutScreen() {
    Column(Modifier.fillMaxSize().padding(20.dp)) {
        Text("About", style = MaterialTheme.typography.headlineMedium, color = EngageColors.text)
        Text("EngageVideo AI", color = EngageColors.text, modifier = Modifier.padding(top = 12.dp))
        Text("Version ${BuildConfig.APP_VERSION_NAME}", color = EngageColors.muted)
        Text("Package ${BuildConfig.APPLICATION_ID}", color = EngageColors.muted, modifier = Modifier.padding(top = 8.dp))
        Text("Video thumbnails and files come from Pixabay through the existing backend.", color = EngageColors.muted, modifier = Modifier.padding(top = 8.dp))
    }
}
