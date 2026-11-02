package com.example.engagevideopush.ui

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import com.example.engagevideopush.data.VideoItem

@Composable
fun FeedScreen(viewModel: FeedViewModel, onPlay: (String) -> Unit) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val category by viewModel.category.collectAsStateWithLifecycle()
    val context = LocalContext.current
    Column(Modifier.fillMaxSize()) {
        Row(
            Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            com.example.engagevideopush.data.FeedCategories.all.forEach { item ->
                FilterChip(
                    selected = item == category,
                    onClick = { viewModel.select(item) },
                    label = { Text(item.label) },
                )
            }
        }
        when (val current = state) {
            FeedUiState.Loading -> Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center) {
                CircularProgressIndicator()
                Text("Loading videos…", modifier = Modifier.padding(top = 12.dp))
            }
            FeedUiState.Empty -> Column(Modifier.padding(24.dp)) {
                Text("No videos for ${category.label}", style = MaterialTheme.typography.headlineSmall)
                Button(onClick = viewModel::load, modifier = Modifier.padding(top = 12.dp)) { Text("Retry") }
            }
            is FeedUiState.Failed -> Column(Modifier.padding(24.dp)) {
                Text("Videos could not be loaded", style = MaterialTheme.typography.headlineSmall)
                Text(current.message, modifier = Modifier.padding(top = 8.dp))
                Button(onClick = viewModel::load, modifier = Modifier.padding(top = 12.dp)) { Text("Retry") }
            }
            is FeedUiState.Ready -> LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                item {
                    Text(category.label, style = MaterialTheme.typography.headlineMedium)
                    if (current.result.offline) {
                        Text(current.result.message ?: "Showing the bundled catalogue.", color = MaterialTheme.colorScheme.secondary)
                    } else {
                        TextButton(onClick = {
                            openHttps(context, current.result.attributionUrl ?: "https://pixabay.com")
                        }) { Text("Videos provided by Pixabay") }
                    }
                }
                items(current.result.videos, key = { it.id }) { video -> VideoCard(video, onPlay) }
                if (!current.result.offline && (current.result.totalResults ?: 0) > current.result.page * 10) {
                    item { Button(onClick = viewModel::nextPage, modifier = Modifier.fillMaxWidth()) { Text("More") } }
                }
            }
        }
    }
}

@Composable
private fun VideoCard(video: VideoItem, onPlay: (String) -> Unit) {
    val context = LocalContext.current
    Card(Modifier.fillMaxWidth()) {
        if (!video.thumbnailUrl.isNullOrBlank()) {
            AsyncImage(model = video.thumbnailUrl, contentDescription = video.title, modifier = Modifier.fillMaxWidth(), contentScale = ContentScale.Crop)
        }
        Column(Modifier.padding(16.dp)) {
            Text(video.category.uppercase(), color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelMedium)
            Text(video.title, style = MaterialTheme.typography.titleLarge)
            video.durationSeconds?.let { Text("${it}s", modifier = Modifier.padding(top = 4.dp)) }
            Text(video.description, modifier = Modifier.padding(top = 6.dp))
            if (!video.creatorName.isNullOrBlank()) {
                TextButton(onClick = { openHttps(context, video.creatorProfileUrl ?: video.sourceUrl) }) {
                    Text("Video by ${video.creatorName} on Pixabay")
                }
            }
            Row(Modifier.padding(top = 12.dp)) {
                Button(onClick = { onPlay(video.id) }) {
                    Icon(Icons.Default.PlayArrow, contentDescription = null)
                    Text("Play")
                }
            }
        }
    }
}

internal fun openHttps(context: android.content.Context, url: String?) {
    if (url.isNullOrBlank() || !url.startsWith("https://")) return
    runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
}
