package com.example.engagevideopush.ui

import android.app.Application
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.example.engagevideopush.EngageApplication
import com.example.engagevideopush.data.DiscoverRails
import com.example.engagevideopush.data.FeedCategories
import com.example.engagevideopush.data.VideoItem
import com.example.engagevideopush.ui.theme.EngageColors
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class SearchViewModel(application: Application) : AndroidViewModel(application) {
    private val app = application as EngageApplication
    private val _query = MutableStateFlow("")
    val query: StateFlow<String> = _query
    private val _state = MutableStateFlow<FeedUiState?>(null)
    val state: StateFlow<FeedUiState?> = _state

    fun update(value: String) {
        _query.value = value
    }

    fun search(value: String = _query.value) {
        val term = value.trim()
        _query.value = term
        if (term.isBlank()) {
            _state.value = null
            return
        }
        _state.value = FeedUiState.Loading
        viewModelScope.launch {
            val result = withContext(Dispatchers.IO) { app.repository.loadFeed(FeedCategories.Item(term, term), 1) }
            _state.value = when {
                result.videos.isNotEmpty() -> FeedUiState.Ready(result)
                result.offline -> FeedUiState.Failed(result.message ?: "Search is unavailable.")
                else -> FeedUiState.Empty
            }
        }
    }
}

@Composable
fun SearchScreen(onPlay: (VideoItem, List<VideoItem>) -> Unit, onOpenRail: (DiscoverRails.Rail) -> Unit, viewModel: SearchViewModel = viewModel()) {
    val query by viewModel.query.collectAsStateWithLifecycle()
    val state by viewModel.state.collectAsStateWithLifecycle()
    val suggestions = DiscoverRails.searchKeywords.filter { query.isBlank() || it.contains(query.trim(), ignoreCase = true) }
    LazyColumn(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        item {
            OutlinedTextField(
                value = query,
                onValueChange = viewModel::update,
                label = { Text("Search videos") },
                modifier = Modifier.fillMaxWidth().padding(16.dp),
                singleLine = true,
            )
            Button(onClick = { viewModel.search() }, modifier = Modifier.padding(horizontal = 16.dp), enabled = query.isNotBlank()) { Text("Search") }
            Text("Popular searches", color = EngageColors.muted, modifier = Modifier.padding(start = 16.dp, top = 16.dp))
            Row(Modifier.horizontalScroll(rememberScrollState()).padding(16.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                suggestions.forEach { keyword ->
                    Text(
                        keyword.replaceFirstChar { it.uppercase() },
                        color = EngageColors.accent,
                        modifier = Modifier.clickable { viewModel.search(keyword) },
                    )
                }
            }
            Text("Categories", color = EngageColors.muted, modifier = Modifier.padding(horizontal = 16.dp))
        }
        items(DiscoverRails.playlists, key = { it.query }) { rail ->
            Text(rail.title, color = EngageColors.text, modifier = Modifier.fillMaxWidth().clickable { onOpenRail(rail) }.padding(horizontal = 16.dp, vertical = 10.dp))
        }
        item {
            when (val current = state) {
                null -> Text("Search Pixabay through the existing video API.", color = EngageColors.muted, modifier = Modifier.padding(16.dp))
                FeedUiState.Loading -> StatusBlock("Loading", "Searching videos.")
                FeedUiState.Empty -> StatusBlock("No results", "Nothing matched ${query.ifBlank { "that search" }}.")
                is FeedUiState.Failed -> StatusBlock("Search failed", current.message) { viewModel.search() }
                is FeedUiState.Ready -> Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    current.result.videos.forEach { video ->
                        VideoPosterCard(video, onPlay = { onPlay(video, current.result.videos) }, compact = false)
                    }
                }
            }
        }
    }
}
