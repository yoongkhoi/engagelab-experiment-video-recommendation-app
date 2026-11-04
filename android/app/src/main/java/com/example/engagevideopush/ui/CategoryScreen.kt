package com.example.engagevideopush.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
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
import com.example.engagevideopush.data.DiscoverRails
import com.example.engagevideopush.data.FeedCategories
import com.example.engagevideopush.data.VideoItem
import com.example.engagevideopush.ui.theme.EngageColors
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

@Composable
fun CategoryScreen(query: String, onPlay: (VideoItem, List<VideoItem>) -> Unit) {
    val app = LocalContext.current.applicationContext as EngageApplication
    val rail = DiscoverRails.rail(query) ?: DiscoverRails.Rail(query.replaceFirstChar { it.uppercase() }, query, "Videos matching this search.")
    var state by remember(query) { mutableStateOf<FeedUiState>(FeedUiState.Loading) }
    LaunchedEffect(query) {
        state = FeedUiState.Loading
        val result = withContext(Dispatchers.IO) { app.repository.loadFeed(FeedCategories.Item(rail.title, rail.query), 1) }
        state = when {
            result.videos.isNotEmpty() -> FeedUiState.Ready(result)
            result.offline -> FeedUiState.Failed(result.message ?: "This category could not be loaded.")
            else -> FeedUiState.Empty
        }
    }
    Column(Modifier.fillMaxSize()) {
        when (val current = state) {
            FeedUiState.Loading -> StatusBlock("Loading", rail.title)
            FeedUiState.Empty -> StatusBlock("No videos", "No Pixabay videos matched ${rail.title}.")
            is FeedUiState.Failed -> StatusBlock("Could not load ${rail.title}", current.message)
            is FeedUiState.Ready -> {
                val cover = current.result.videos.firstOrNull()?.thumbnailUrl
                LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    item {
                        Poster(cover, rail.title, Modifier.fillMaxWidth().height(220.dp))
                        Column(Modifier.padding(16.dp)) {
                            Text(rail.title, style = MaterialTheme.typography.headlineMedium, color = EngageColors.text)
                            Text(rail.description, color = EngageColors.muted, modifier = Modifier.padding(top = 6.dp))
                        }
                    }
                    items(current.result.videos, key = { it.id }) { video ->
                        VideoPosterCard(video, onPlay = { onPlay(video, current.result.videos) }, modifier = Modifier.padding(horizontal = 16.dp), compact = false)
                    }
                }
            }
        }
    }
}
