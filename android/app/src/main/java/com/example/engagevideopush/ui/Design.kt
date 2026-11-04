package com.example.engagevideopush.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import com.example.engagevideopush.EngageApplication
import com.example.engagevideopush.data.VideoItem
import com.example.engagevideopush.push.PushState
import com.example.engagevideopush.ui.theme.EngageColors
import kotlinx.coroutines.launch
import java.util.Calendar

object PendingLibrary {
    var videoId: String? = null

    suspend fun apply(app: EngageApplication) {
        val id = videoId ?: return
        videoId = null
        if (!app.library.isFavorite(id)) app.library.toggleFavorite(id)
    }
}

fun greeting(hour: Int = Calendar.getInstance().get(Calendar.HOUR_OF_DAY)): String {
    return when (hour) {
        in 5..11 -> "Good morning"
        in 12..16 -> "Good afternoon"
        in 17..21 -> "Good evening"
        else -> "Good night"
    }
}

@Composable
fun Avatar(label: String, onClick: () -> Unit) {
    val letter = label.trim().firstOrNull()?.uppercase() ?: "G"
    Box(
        Modifier
            .size(40.dp)
            .clip(CircleShape)
            .background(EngageColors.accent)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(letter, color = EngageColors.text, style = MaterialTheme.typography.titleMedium)
    }
}

@Composable
fun SectionTitle(title: String, subtitle: String? = null, action: String? = null, onAction: (() -> Unit)? = null) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleLarge, color = EngageColors.text)
            if (!subtitle.isNullOrBlank()) Text(subtitle, color = EngageColors.muted, style = MaterialTheme.typography.bodyMedium)
        }
        if (action != null && onAction != null) TextButton(onClick = onAction) { Text(action) }
    }
}

@Composable
fun Poster(url: String?, title: String, modifier: Modifier = Modifier) {
    Box(modifier.clip(RoundedCornerShape(16.dp)).background(EngageColors.surface)) {
        if (!url.isNullOrBlank()) {
            AsyncImage(model = url, contentDescription = title, modifier = Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
        }
    }
}

@Composable
fun VideoPosterCard(video: VideoItem, onPlay: () -> Unit, modifier: Modifier = Modifier, compact: Boolean = true) {
    val card = if (compact) modifier.width(168.dp) else modifier.fillMaxWidth()
    Column(card.clickable(onClick = onPlay)) {
        Poster(video.thumbnailUrl, video.title, Modifier.fillMaxWidth().height(if (compact) 104.dp else 180.dp))
        Text(video.title, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 8.dp), color = EngageColors.text)
        val meta = listOfNotNull(video.durationSeconds?.let { "${it}s" }, video.creatorName).joinToString(" · ")
        if (meta.isNotBlank()) Text(meta, color = EngageColors.muted, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
fun StatusBlock(title: String, body: String, onRetry: (() -> Unit)? = null) {
    Column(Modifier.fillMaxWidth().padding(24.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (title == "Loading") CircularProgressIndicator(color = EngageColors.accent)
        Text(title, style = MaterialTheme.typography.titleMedium, color = EngageColors.text)
        Text(body, color = EngageColors.muted)
        if (onRetry != null) Button(onClick = onRetry) { Text("Retry") }
    }
}

@Composable
fun FavoriteButton(videoId: String, onSignIn: () -> Unit) {
    val app = LocalContext.current.applicationContext as EngageApplication
    val signedIn by PushState.authenticated.collectAsStateWithLifecycle()
    var saved by remember(videoId) { mutableStateOf(false) }
    LaunchedEffect(videoId, signedIn) {
        saved = signedIn && app.library.isFavorite(videoId)
    }
    TextButton(onClick = {
        if (!signedIn) {
            PendingLibrary.videoId = videoId
            onSignIn()
            return@TextButton
        }
        app.scope.launch {
            saved = app.library.toggleFavorite(videoId)
            val video = app.repository.resolve(videoId)
            if (video != null && app.backend.sessionToken != null) {
                runCatching {
                    if (saved) app.backend.saveFavorite(video) else app.backend.deleteFavorite(videoId)
                }
            }
        }
    }) {
        Text(if (saved) "Saved" else "Save")
    }
}
