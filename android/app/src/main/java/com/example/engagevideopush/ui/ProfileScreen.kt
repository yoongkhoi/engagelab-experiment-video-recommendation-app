package com.example.engagevideopush.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.example.engagevideopush.EngageApplication
import com.example.engagevideopush.data.AccountProfile
import com.example.engagevideopush.data.VideoItem
import com.example.engagevideopush.push.PushState
import com.example.engagevideopush.ui.theme.EngageColors
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
fun ProfileScreen(
    onSignIn: () -> Unit,
    onCreateAccount: () -> Unit,
    onFavorites: () -> Unit,
    onWatched: () -> Unit,
    onInterests: () -> Unit,
    onSettings: () -> Unit,
    onDevices: () -> Unit,
    onEditProfile: () -> Unit,
    onNotifications: () -> Unit,
) {
    val app = LocalContext.current.applicationContext as EngageApplication
    val signedIn by PushState.authenticated.collectAsStateWithLifecycle()
    var profile by remember { mutableStateOf<AccountProfile?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(signedIn) {
        profile = null
        error = null
        if (!signedIn) return@LaunchedEffect
        try {
            profile = withContext(Dispatchers.IO) { app.backend.profile() }
        } catch (reason: Exception) {
            error = reason.message
        }
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp)) {
        Text("Profile", style = MaterialTheme.typography.headlineMedium, color = EngageColors.text)
        if (!signedIn) {
            Text("Browse as a guest, then sign in to save favorites and interests.", color = EngageColors.muted, modifier = Modifier.padding(vertical = 12.dp))
            Button(onClick = onSignIn, modifier = Modifier.fillMaxWidth()) { Text("Sign In") }
            Button(onClick = onCreateAccount, modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) { Text("Create Account") }
            ProfileRow("Settings", onSettings)
            return@Column
        }
        val name = profile?.displayName ?: "Add a nickname"
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(vertical = 16.dp)) {
            Avatar(profile?.displayName ?: profile?.email ?: "You") {}
            Column(Modifier.padding(start = 12.dp)) {
                Text(name, style = MaterialTheme.typography.titleLarge, color = EngageColors.text)
                Text(profile?.email ?: "Signed in", color = EngageColors.muted)
            }
        }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        ProfileRow("My Favorites", onFavorites)
        ProfileRow("Recently Watched", onWatched)
        ProfileRow("My Interests", onInterests)
        ProfileRow("Notification Settings", onNotifications)
        ProfileRow("Edit Profile", onEditProfile)
        ProfileRow("Settings", onSettings)
        ProfileRow("My Devices", onDevices)
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
        }, modifier = Modifier.padding(top = 16.dp)) { Text("Logout") }
    }
}

@Composable
fun ProfileRow(label: String, onClick: () -> Unit) {
    Text(
        label,
        color = EngageColors.text,
        style = MaterialTheme.typography.titleMedium,
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick).padding(vertical = 14.dp),
    )
}

@Composable
fun LibraryListScreen(title: String, empty: String, favorite: Boolean, onPlay: (VideoItem, List<VideoItem>) -> Unit, onSignIn: () -> Unit) {
    val app = LocalContext.current.applicationContext as EngageApplication
    val signedIn by PushState.authenticated.collectAsStateWithLifecycle()
    var videos by remember { mutableStateOf<List<VideoItem>>(emptyList()) }
    var loaded by remember { mutableStateOf(false) }
    LaunchedEffect(signedIn, favorite) {
        if (favorite && !signedIn) {
            videos = emptyList()
            loaded = true
            return@LaunchedEffect
        }
        val ids = if (favorite) app.library.favorites() else app.library.watched()
        videos = withContext(Dispatchers.IO) { ids.mapNotNull { id -> runCatching { app.repository.resolve(id) }.getOrNull() } }
        loaded = true
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
        Text(title, style = MaterialTheme.typography.headlineMedium, color = EngageColors.text)
        if (favorite && !signedIn) {
            Text("Sign in to see favorites saved on this device.", color = EngageColors.muted, modifier = Modifier.padding(vertical = 12.dp))
            Button(onClick = onSignIn) { Text("Sign In") }
            return@Column
        }
        if (!loaded) {
            StatusBlock("Loading", title)
        } else if (videos.isEmpty()) {
            Text(empty, color = EngageColors.muted, modifier = Modifier.padding(top = 12.dp))
        } else {
            videos.forEach { video ->
                VideoPosterCard(video, onPlay = { onPlay(video, videos) }, compact = false, modifier = Modifier.padding(top = 12.dp))
            }
        }
    }
}
