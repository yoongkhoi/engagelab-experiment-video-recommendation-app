package com.example.engagevideopush.ui

import android.app.Application
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.example.engagevideopush.EngageApplication
import com.example.engagevideopush.data.DiscoverRails
import com.example.engagevideopush.data.FeedCategories
import com.example.engagevideopush.data.FeedResult
import com.example.engagevideopush.data.VideoItem
import com.example.engagevideopush.push.PushState
import com.example.engagevideopush.ui.theme.EngageColors
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class HomeViewModel(application: Application) : AndroidViewModel(application) {
    private val app = application as EngageApplication
    private val _popular = MutableStateFlow<FeedUiState>(FeedUiState.Loading)
    val popular: StateFlow<FeedUiState> = _popular
    private val _madeForYou = MutableStateFlow<Pair<String, FeedUiState>>("Popular" to FeedUiState.Loading)
    val madeForYou: StateFlow<Pair<String, FeedUiState>> = _madeForYou
    private val _rails = MutableStateFlow<Map<String, FeedUiState>>(emptyMap())
    val rails: StateFlow<Map<String, FeedUiState>> = _rails
    private val _watched = MutableStateFlow<List<VideoItem>>(emptyList())
    val watched: StateFlow<List<VideoItem>> = _watched
    private val _sections = MutableStateFlow<List<Pair<String, List<VideoItem>>>>(emptyList())
    val sections: StateFlow<List<Pair<String, List<VideoItem>>>> = _sections

    fun load(signedIn: Boolean) {
        viewModelScope.launch {
            _popular.value = FeedUiState.Loading
            val popularResult = withContext(Dispatchers.IO) { app.repository.loadFeed(FeedCategories.all.first(), 1) }
            _popular.value = readyOrFailed(popularResult, "Popular videos could not be loaded.")
            _sections.value = if (signedIn) {
                runCatching { withContext(Dispatchers.IO) { app.backend.personalizedSections() } }.getOrDefault(emptyList())
            } else {
                emptyList()
            }
            val preference = if (signedIn) {
                runCatching { withContext(Dispatchers.IO) { app.backend.videoPreferences() } }.getOrNull().orEmpty()
            } else {
                emptyList()
            }
            val match = DiscoverRails.playlists.firstOrNull { it.query in preference }
            if (match == null) {
                _madeForYou.value = "Popular picks" to _popular.value
            } else {
                _madeForYou.value = match.title to FeedUiState.Loading
                val personal = withContext(Dispatchers.IO) { app.repository.loadFeed(FeedCategories.Item(match.title, match.query), 1) }
                _madeForYou.value = match.title to readyOrFailed(personal, "Personalized videos could not be loaded.")
            }
            _rails.value = DiscoverRails.playlists.associate { it.query to FeedUiState.Loading }
            coroutineScope {
                DiscoverRails.playlists.map { rail ->
                    async(Dispatchers.IO) {
                        val result = app.repository.loadFeed(FeedCategories.Item(rail.title, rail.query), 1)
                        _rails.update { current -> current + (rail.query to readyOrFailed(result, "This playlist could not be loaded.")) }
                    }
                }.awaitAll()
            }
            refreshWatched()
        }
    }

    fun refreshWatched() {
        viewModelScope.launch {
            val ids = app.library.watched()
            val videos = withContext(Dispatchers.IO) {
                ids.mapNotNull { id -> runCatching { app.repository.resolve(id) }.getOrNull() }
            }
            _watched.value = videos
        }
    }
}

private fun readyOrFailed(result: FeedResult, fallback: String): FeedUiState {
    return when {
        result.videos.isNotEmpty() -> FeedUiState.Ready(result)
        result.offline -> FeedUiState.Failed(result.message ?: fallback)
        else -> FeedUiState.Empty
    }
}

@Composable
fun HomeScreen(
    onPlay: (VideoItem, List<VideoItem>) -> Unit,
    onOpenRail: (DiscoverRails.Rail) -> Unit,
    onProfile: () -> Unit,
    viewModel: HomeViewModel = viewModel(),
) {
    val signedIn by PushState.authenticated.collectAsStateWithLifecycle()
    val popular by viewModel.popular.collectAsStateWithLifecycle()
    val made by viewModel.madeForYou.collectAsStateWithLifecycle()
    val rails by viewModel.rails.collectAsStateWithLifecycle()
    val watched by viewModel.watched.collectAsStateWithLifecycle()
    val sections by viewModel.sections.collectAsStateWithLifecycle()
    val context = LocalContext.current
    LaunchedEffect(signedIn) { viewModel.load(signedIn) }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(bottom = 24.dp)) {
        Row(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.SpaceBetween) {
            Column {
                Text(greeting(), color = EngageColors.muted)
                Text(if (signedIn) "Welcome back" else "Welcome", style = MaterialTheme.typography.headlineMedium, color = EngageColors.text)
            }
            Avatar(if (signedIn) "You" else "Guest", onProfile)
        }
        when (val current = popular) {
            FeedUiState.Loading -> StatusBlock("Loading", "Finding videos from Pixabay.")
            FeedUiState.Empty -> StatusBlock("No videos yet", "The catalogue is empty right now.") { viewModel.load(signedIn) }
            is FeedUiState.Failed -> StatusBlock("Videos could not be loaded", current.message) { viewModel.load(signedIn) }
            is FeedUiState.Ready -> {
                val featured = current.result.videos.first()
                SectionTitle("Featured")
                Column(Modifier.padding(horizontal = 16.dp)) {
                    Poster(featured.thumbnailUrl, featured.title, Modifier.fillMaxWidth().height(210.dp))
                    Text(featured.title, style = MaterialTheme.typography.titleLarge, color = EngageColors.text, modifier = Modifier.padding(top = 12.dp))
                    if (featured.description.isNotBlank()) {
                        Text(featured.description, color = EngageColors.muted, maxLines = 3, modifier = Modifier.padding(top = 4.dp))
                    }
                    Button(onClick = { onPlay(featured, current.result.videos) }, modifier = Modifier.padding(top = 12.dp)) { Text("Watch Now") }
                    TextButton(onClick = { openHttps(context, current.result.attributionUrl ?: "https://pixabay.com") }) {
                        Text("Videos provided by Pixabay")
                    }
                }
            }
        }
        if (sections.isEmpty()) {
            SectionTitle("Made For You", if (signedIn) made.first else "Popular videos for guests")
            VideoStrip(made.second, onPlay)
        } else {
            sections.forEach { (title, videos) ->
                SectionTitle(title)
                VideoStrip(FeedUiState.Ready(FeedResult(videos, false, null)), onPlay)
            }
        }
        DiscoverRails.playlists.forEach { rail ->
            SectionTitle(rail.title, action = "See all") { onOpenRail(rail) }
            VideoStrip(rails[rail.query] ?: FeedUiState.Loading, onPlay)
        }
        SectionTitle("Trending Videos")
        VideoStrip(popular, onPlay)
        if (watched.isNotEmpty()) {
            SectionTitle("Recently Watched")
            VideoStrip(FeedUiState.Ready(com.example.engagevideopush.data.FeedResult(watched, false, null)), onPlay)
        }
    }
}

@Composable
private fun VideoStrip(state: FeedUiState, onPlay: (VideoItem, List<VideoItem>) -> Unit) {
    when (state) {
        FeedUiState.Loading -> Text("Loading…", color = EngageColors.muted, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
        FeedUiState.Empty -> Text("No videos in this row.", color = EngageColors.muted, modifier = Modifier.padding(horizontal = 16.dp))
        is FeedUiState.Failed -> Text(state.message, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(horizontal = 16.dp))
        is FeedUiState.Ready -> Row(
            Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            state.result.videos.take(10).forEach { video ->
                VideoPosterCard(video, onPlay = { onPlay(video, state.result.videos) })
            }
        }
    }
}
